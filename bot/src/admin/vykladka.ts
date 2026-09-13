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
import * as bdOtzyvy from '../db/otzyvy.js';
import * as vykladki from '../db/vykladki.js';
import { OshibkaHranilishcha, polozhitFayl, sborka, vzyatFayl } from '../lib/hranilishche.js';
import { zhurnal } from '../lib/zhurnal.js';

const NACHALO = '  // ── НАЧАЛО ДАННЫХ ПАНЕЛИ ──';
const KONEC = '  // ── КОНЕЦ ДАННЫХ ПАНЕЛИ ──';
const NACHALO_OTZ = '  // ── НАЧАЛО ОТЗЫВОВ ПАНЕЛИ ──';
const KONEC_OTZ = '  // ── КОНЕЦ ОТЗЫВОВ ПАНЕЛИ ──';

/**
 * Кусок файла как JSON.
 *
 * Отступ у продолжающих строк — два пробела: ровно так лежит нынешний
 * файл, и благодаря этому «выложить, ничего не поменяв» честно
 * отвечает «на сайте уже такие же», а не отправляет пустую правку.
 */
function kusok(nachalo: string, konec: string, imya: string, dannye: unknown): string {
  const json = JSON.stringify(dannye, null, 2)
    .split('\n')
    .map((s, i) => (i === 0 ? s : `  ${s}`))
    .join('\n');
  return `${nachalo}\n  ${imya}: ${json},\n${konec}`;
}

/** Кусок файла с продуктами и ценами. */
export function teloCen(db: Baza): string {
  return kusok(NACHALO, KONEC, 'products', bdKatalog.produkty(db));
}

/** Кусок файла с отзывами. */
export function teloOtzyvov(db: Baza): string {
  return kusok(NACHALO_OTZ, KONEC_OTZ, 'reviews', bdOtzyvy.vse(db));
}

/**
 * Всё, что панель пишет в файл, — одной строкой.
 *
 * Отсюда считается ОТПЕЧАТОК, по которому видно, разошлись ли панель
 * и сайт. Кусков два (цены и отзывы), а выкладка одна: сайт собирается
 * целиком, и две выкладки подряд дали бы две сборки ради одного
 * изменения. Общий отпечаток означает ровно то, что нужно: «на сайте
 * стоит ровно это».
 */
export function telo(db: Baza): string {
  return `${teloCen(db)}\n${teloOtzyvov(db)}`;
}

/** Подставить один размеченный кусок. Метки обязаны быть на месте. */
function zamenit(fayl: string, nachalo: string, konec: string, novyy: string, chto: string): string {
  const a = fayl.indexOf(nachalo);
  const b = fayl.indexOf(konec);
  if (a < 0 || b < 0 || b < a) {
    throw new OshibkaHranilishcha(
      `В файле каталога не нашлось меток, между которыми панель пишет ${chto}. Похоже, файл правили руками.`,
    );
  }
  return fayl.slice(0, a) + novyy + fayl.slice(b + konec.length);
}

/**
 * Подставить новые куски в файл: и цены, и отзывы.
 *
 * ОБА или НИ ОДНОГО: `zamenit` бросает на пропавших метках, и заход
 * обрывается до отправки. Половинчатая правка — та самая «затёрли
 * чужую работу вслепую», от которой метки и защищают.
 */
export function podstavit(fayl: string, db: Baza): string {
  const s = zamenit(fayl, NACHALO, KONEC, teloCen(db), 'цены');
  return zamenit(s, NACHALO_OTZ, KONEC_OTZ, teloOtzyvov(db), 'отзывы');
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

  const otp = vykladki.otpechatok(telo(db));

  let fayl;
  try {
    fayl = await vzyatFayl(l.n, l.n.faylKataloga);
  } catch (e) {
    return { vid: 'otkaz', pochemu: pochemu(e) };
  }

  let novyy: string;
  try {
    novyy = podstavit(fayl.text, db);
  } catch (e) {
    return { vid: 'otkaz', pochemu: pochemu(e) };
  }
  if (novyy === fayl.text) {
    // Отправлять нечего — но мы только что сверились с хранилищем,
    // и это ответ на вопрос «совпадает ли витрина»: записываем.
    vykladki.zapisatSovpadenie(db, otp, kto, 'На сайте уже стояло ровно это.');
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
      'Витрина: цены и отзывы выложены из админ-панели',
    );
    vykladki.otmetitOtpravlennoy(db, v.id, metka);
    zhurnal.info(`панель: витрина отправлена в хранилище, выкладка № ${v.id}`);
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
 * Разошлись ли панель и сайт — по ценам ИЛИ по отзывам.
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
