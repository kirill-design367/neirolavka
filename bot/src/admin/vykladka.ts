/**
 * «Выложить цены на сайт» — от нажатия до витрины.
 *
 * Сайт статический и базу не видит: цена, поставленная в панели,
 * работает в боте немедленно, а на витрине появляется только после
 * сборки. Раньше панель показывала кусок кода, который владелец
 * вставлял в файл руками, — теперь она кладёт его в хранилище сама.
 *
 * ПАНЕЛЬ ПИШЕТ ДАННЫЕ, А НЕ КОД. В файле каталога размечен кусок между
 * метками, и заменяется он целиком на JSON, набранный машиной. JSON
 * экранирует строки сам: имя продукта с апострофом не превращается
 * в сломанную сборку. Форму при этом проверяет сама сборка сайта —
 * если панель однажды напишет не то, красным станет прогон, а не
 * витрина.
 */

import type { Lavka } from '../lavka.js';
import type { Baza } from '../db/index.js';
import * as bdKatalog from '../db/katalog.js';
import * as vykladki from '../db/vykladki.js';
import { OshibkaHranilishcha, polozhitFayl, sborka, vzyatFayl } from '../lib/hranilishche.js';
import { zhurnal } from '../lib/zhurnal.js';

const NACHALO = '  // ── НАЧАЛО ДАННЫХ ПАНЕЛИ ──';
const KONEC = '  // ── КОНЕЦ ДАННЫХ ПАНЕЛИ ──';

/**
 * Кусок файла с продуктами.
 *
 * Отступ у продолжающих строк — два пробела: ровно так лежит нынешний
 * файл, и благодаря этому «выложить, ничего не поменяв» честно
 * отвечает «на сайте уже такие же», а не отправляет пустую правку.
 */
export function telo(db: Baza): string {
  const produkty = bdKatalog.produkty(db);
  const json = JSON.stringify(produkty, null, 2)
    .split('\n')
    .map((s, i) => (i === 0 ? s : `  ${s}`))
    .join('\n');
  return `${NACHALO}\n  products: ${json},\n${KONEC}`;
}

/** Подставить новый кусок в файл. Метки обязаны быть на месте. */
export function podstavit(fayl: string, kusok: string): string {
  const a = fayl.indexOf(NACHALO);
  const b = fayl.indexOf(KONEC);
  if (a < 0 || b < 0 || b < a) {
    throw new OshibkaHranilishcha(
      'В файле каталога не нашлось меток, между которыми панель пишет цены. Похоже, файл правили руками.',
    );
  }
  return fayl.slice(0, a) + kusok + fayl.slice(b + KONEC.length);
}

export type Itog =
  | { vid: 'poshla'; id: number }
  | { vid: 'sovpadaet' }
  | { vid: 'uzhe_idet' }
  | { vid: 'otkaz'; pochemu: string };

/**
 * Отправить нынешний прайс в хранилище кода.
 *
 * Порядок важен: сначала строка выкладки в базе, потом отправка.
 * Наоборот — и два нажатия подряд отправили бы две правки, потому что
 * между отправкой и записью есть окно.
 */
export async function zapustit(l: Lavka, kto: number | null): Promise<Itog> {
  const db = l.db;
  if (vykladki.idushchaya(db)) return { vid: 'uzhe_idet' };

  const kusok = telo(db);
  const otp = vykladki.otpechatok(kusok);

  let fayl;
  try {
    fayl = await vzyatFayl(l.n, l.n.faylKataloga);
  } catch (e) {
    return { vid: 'otkaz', pochemu: pochemu(e) };
  }

  let novyy: string;
  try {
    novyy = podstavit(fayl.text, kusok);
  } catch (e) {
    return { vid: 'otkaz', pochemu: pochemu(e) };
  }
  if (novyy === fayl.text) {
    // Отправлять нечего — но мы только что сверились с хранилищем,
    // и это ответ на вопрос «совпадают ли цены»: записываем.
    vykladki.zapisatSovpadenie(db, otp, kto, 'На сайте уже были такие цены.');
    return { vid: 'sovpadaet' };
  }

  const v = vykladki.nachat(db, otp, kto);
  if (!v) return { vid: 'uzhe_idet' };

  try {
    const metka = await polozhitFayl(
      l.n,
      l.n.faylKataloga,
      novyy,
      fayl.metka,
      'Цены с витрины: выложено из админ-панели',
    );
    vykladki.otmetitOtpravlennoy(db, v.id, metka);
    zhurnal.info(`панель: цены отправлены в хранилище, выкладка № ${v.id}`);
    return { vid: 'poshla', id: v.id };
  } catch (e) {
    vykladki.zavershit(db, v.id, false, pochemu(e));
    return { vid: 'otkaz', pochemu: pochemu(e) };
  }
}

/** Сообщение, которое не стыдно показать человеку. */
function pochemu(e: unknown): string {
  if (e instanceof OshibkaHranilishcha) return e.message;
  zhurnal.oshibka('выкладка: непредвиденный отказ:', e);
  return 'Что-то пошло не так при отправке цен. Подробности — в журнале бота.';
}

/**
 * Посмотреть, чем кончилась сборка. Зовётся и со страницы панели,
 * и из присмотра: страницу могут закрыть, а состояние должно доехать
 * до конца само.
 */
export async function proverit(l: Lavka): Promise<void> {
  const db = l.db;
  const v = vykladki.idushchaya(db);
  if (!v) return;

  if (!v.metka) {
    // Отправить не успели, а строка есть: такое бывает, если бот
    // перезапустился ровно между записью и отправкой.
    if (vykladki.zaviskla(v)) {
      vykladki.zavershit(db, v.id, false, 'Отправка цен оборвалась. Нажмите «Выложить на сайт» ещё раз.');
    }
    return;
  }

  let s;
  try {
    s = await sborka(l.n, v.metka);
  } catch (e) {
    // Не дозвонились — это не приговор выкладке: попробуем на
    // следующем круге. Но если ждём слишком долго, честно закрываем.
    vykladki.otmetitProverku(db, v.id);
    if (vykladki.zaviskla(v)) {
      vykladki.zavershit(db, v.id, false, pochemu(e));
    }
    return;
  }

  vykladki.otmetitProverku(db, v.id);
  if (s.vid === 'vyshla') {
    vykladki.zavershit(db, v.id, true, 'Цены на сайте.');
    zhurnal.info(`панель: выкладка № ${v.id} дошла до сайта`);
    return;
  }
  if (s.vid === 'ne_vyshla') {
    vykladki.zavershit(db, v.id, false, s.pochemu);
    return;
  }
  // 'net' — сборка ещё не появилась, 'idet' — идёт. И то и другое
  // нормально ровно до предела ожидания.
  if (vykladki.zaviskla(v)) {
    vykladki.zavershit(
      db,
      v.id,
      false,
      'Сборка сайта не ответила за двадцать минут. Цены отправлены; загляните на сайт чуть позже.',
    );
  }
}

/**
 * Разошлись ли цены в панели и на сайте.
 *
 * Сравнивается с отпечатком последней УДАВШЕЙСЯ выкладки: это
 * единственное, про что мы знаем наверняка, что оно доехало
 * до витрины.
 */
export type Rashozhdenie = { est: boolean; nikogda: boolean };

export function rashozhdenie(db: Baza): Rashozhdenie {
  const bylo = vykladki.poslednyayaUdachnaya(db);
  if (!bylo) return { est: true, nikogda: true };
  return { est: bylo.otpechatok !== vykladki.otpechatok(telo(db)), nikogda: false };
}
