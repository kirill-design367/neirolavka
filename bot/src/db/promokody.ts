/**
 * Промокоды: создание, проверка, применение, возврат активации.
 *
 * Три вещи, которые здесь важнее всего, и все три — про базу.
 *
 * 1. АКТИВАЦИИ — ЭТО СТРОКИ, А НЕ СЧЁТЧИК. Колонка «использовано»
 *    рядом с таблицей применений была бы вторым источником правды
 *    об одном числе; они разъезжаются молча на первой правке мимо
 *    одного из них. Тот же довод, по которому баланс покупателя
 *    считается суммой движений.
 *
 * 2. ДВА ЧЕЛОВЕКА НА ПОСЛЕДНЮЮ АКТИВАЦИЮ РАЗНИМАЕТ БАЗА. У каждой
 *    активации есть НОМЕР МЕСТА от 1 до объявленного числа, и на
 *    занятые места стоит частичный уникальный индекс
 *    `promo_mesto_zanyato`. Вставка ищет свободный номер и занимает
 *    его ОДНИМ оператором: «прочитали, посчитали, записали» между
 *    двумя запросами переживает гонку, а индекс — нет.
 *
 * 3. ОТМЕНА ВОЗВРАЩАЕТ АКТИВАЦИЮ, НЕ СТИРАЯ ИСТОРИЮ. У строки
 *    проставляется `snyata_v`: она уходит из-под уникального индекса,
 *    место освобождается, а запись «кем и когда применялся» остаётся.
 *    Удалить строку значило бы сделать вид, что применения не было.
 */

import { randomBytes } from 'node:crypto';
import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import { kodPromo, skidkaKop } from '../lib/promokod.js';
import type { ItogPromo } from '../lib/promokod.js';

export type Promokod = {
  kod: string;
  skidka_proc: number;
  do_daty: string;
  aktivaciy: number;
  otklyuchen: number;
  sozdan: string;
  kto: number | null;
};

/** Промокод вместе с тем, что о нём надо знать в панели. */
export type Svodka = Promokod & {
  /** Сколько активаций занято прямо сейчас. */
  ispolzovano: number;
  /** Сколько осталось. */
  ostalos: number;
  /** Действует ли он в это мгновение. */
  deystvuet: boolean;
  /** Почему не действует, если не действует. */
  pochemu: 'istyok' | 'konchilis' | 'otklyuchen' | null;
};

/** Одно применение: кем, когда, к какому заказу и на сколько. */
export type Primenenie = {
  id: number;
  kod: string;
  mesto: number;
  zakaz_id: number;
  tg_id: number;
  skidka_kop: number;
  kogda: string;
  snyata_v: string | null;
};

/**
 * Алфавит для сгенерированного кода.
 *
 * Без `0`, `O`, `1`, `I` и `L`: код читают с экрана и набирают руками,
 * а эти знаки в большинстве шрифтов различаются плохо. Промокод,
 * который вводится с третьей попытки, — это не скидка, а раздражение.
 */
const ALFAVIT = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Потолок числа активаций у одного кода. Почему — см. `zavesti`. */
export const PREDEL_AKTIVACIY = 10_000;

/** Случайный код нужной длины. Крипто-случайность, а не Math.random. */
export function pridumatKod(dlina = 8, sluchaynye = defaultnyeSluchaynye): string {
  let s = '';
  for (const n of sluchaynye(dlina)) s += ALFAVIT[n % ALFAVIT.length];
  return s;
}

function defaultnyeSluchaynye(skolko: number): Uint8Array {
  return new Uint8Array(randomBytes(skolko));
}

export function po(db: Baza, syroe: string): Promokod | null {
  const kod = kodPromo(syroe);
  if (!kod) return null;
  return (db.prepare('SELECT * FROM promokody WHERE kod = ?').get(kod) as Promokod | undefined) ?? null;
}

/** Сколько мест занято прямо сейчас. Снятые активации не считаются. */
export function zanyato(db: Baza, kod: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) n FROM promo_aktivacii WHERE kod = ? AND snyata_v IS NULL')
      .get(kod) as { n: number }
  ).n;
}

/**
 * Завести промокод.
 *
 * Возвращает `null`, если код после чистки пуст: молча записать
 * промокод без кода значило бы завести скидку, которой никто никогда
 * не воспользуется. Совпадение с существующим — тоже `null`: тихо
 * переписать чужой действующий код новой скидкой нельзя, у него уже
 * могут быть применения.
 */
export function zavesti(
  db: Baza,
  z: { kod: string; skidkaProc: number; doDaty: string; aktivaciy: number },
  kto: number | null,
): { promokod: Promokod } | { oshibka: 'net_koda' | 'zanyat' | 'nevernaya_skidka' | 'net_sroka' | 'nevernye_aktivacii' } {
  const kod = kodPromo(z.kod);
  if (!kod) return { oshibka: 'net_koda' };
  if (!Number.isInteger(z.skidkaProc) || z.skidkaProc < 1 || z.skidkaProc > 100) {
    return { oshibka: 'nevernaya_skidka' };
  }
  /* Потолок числа активаций не от вкуса: свободное место ищется
     рекурсивным перебором номеров, и миллион активаций означал бы
     миллион строк на каждое применение кода. Десять тысяч — заведомо
     больше, чем бывает у ручной лавки. */
  if (!Number.isInteger(z.aktivaciy) || z.aktivaciy < 1 || z.aktivaciy > PREDEL_AKTIVACIY) {
    return { oshibka: 'nevernye_aktivacii' };
  }
  if (!z.doDaty || Number.isNaN(Date.parse(z.doDaty))) return { oshibka: 'net_sroka' };
  if (po(db, kod)) return { oshibka: 'zanyat' };
  db.prepare(
    `INSERT INTO promokody (kod, skidka_proc, do_daty, aktivaciy, otklyuchen, sozdan, kto)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).run(kod, z.skidkaProc, z.doDaty, z.aktivaciy, seychasISO(), kto);
  return { promokod: po(db, kod) as Promokod };
}

/** Отключить или включить обратно. Удаления нет: на код ссылаются заказы. */
export function otklyuchit(db: Baza, syroe: string, otklyuchen: boolean): boolean {
  const kod = kodPromo(syroe);
  if (!kod) return false;
  return (
    db.prepare('UPDATE promokody SET otklyuchen = ? WHERE kod = ?').run(otklyuchen ? 1 : 0, kod).changes > 0
  );
}

function svodkaIz(db: Baza, p: Promokod, seychas: Date): Svodka {
  const ispolzovano = zanyato(db, p.kod);
  const ostalos = Math.max(0, p.aktivaciy - ispolzovano);
  const istyok = Date.parse(p.do_daty) <= seychas.getTime();
  const pochemu = p.otklyuchen ? 'otklyuchen' : istyok ? 'istyok' : ostalos <= 0 ? 'konchilis' : null;
  return { ...p, ispolzovano, ostalos, deystvuet: pochemu === null, pochemu };
}

/** Все промокоды, свежие сверху. */
export function vse(db: Baza, seychas = new Date()): Svodka[] {
  return (db.prepare('SELECT * FROM promokody ORDER BY sozdan DESC').all() as Promokod[]).map((p) =>
    svodkaIz(db, p, seychas),
  );
}

/** Применения одного кода: кем и когда. Свежие сверху. */
export function primeneniya(db: Baza, kod: string, skolko = 50): Primenenie[] {
  return db
    .prepare('SELECT * FROM promo_aktivacii WHERE kod = ? ORDER BY id DESC LIMIT ?')
    .all(kodPromo(kod), skolko) as Primenenie[];
}

/**
 * Годится ли код прямо сейчас.
 *
 * Отвечает на вопрос сайта и вопрос бота ОДНИМ способом. Ответ
 * предварительный по своей природе: между «сайт спросил» и «бот
 * оформил заказ» проходит время, за которое код может кончиться
 * у кого-то другого. Настоящее решение принимается один раз —
 * при вставке активации, и принимает его база.
 */
export function proverit(db: Baza, syroe: string, seychas = new Date()): ItogPromo {
  const kod = kodPromo(syroe);
  if (!kod) return { godit: false, pochemu: 'net' };
  const p = po(db, kod);
  if (!p) return { godit: false, pochemu: 'net' };
  const s = svodkaIz(db, p, seychas);
  if (s.pochemu) return { godit: false, pochemu: s.pochemu };
  return { godit: true, kod: p.kod, skidkaProc: p.skidka_proc };
}

/**
 * Занять активацию под заказ.
 *
 * ВСЯ ГОНКА РЕШАЕТСЯ ЗДЕСЬ, и решается она одним оператором SQL.
 * Номера мест от 1 до `aktivaciy` порождает рекурсивное выражение,
 * занятые вычитаются подзапросом, берётся наименьший свободный —
 * и он же сразу вставляется. Между «нашли свободное» и «заняли»
 * нет ни мгновения, в которое кто-то другой мог бы влезть, а если
 * бы и было, вставку не пустил бы частичный уникальный индекс.
 *
 * Ноль вставленных строк значит ровно одно: свободных мест нет.
 */
export function zanyat(
  db: Baza,
  kod: string,
  zakazId: number,
  tgId: number,
  cenaKop: number,
  seychas = new Date(),
): { zanyali: true; skidkaKop: number; skidkaProc: number } | { zanyali: false; pochemu: ItogPromo } {
  const itog = proverit(db, kod, seychas);
  if (!itog.godit) return { zanyali: false, pochemu: itog };
  // Скидка считается ОТ ЦЕНЫ ТАРИФА. Цены нет — активацию не тратим:
  // сжечь её ради нулевой скидки было бы то же самое, что показать
  // рубль вместо неизвестной цены.
  const skidka = skidkaKop(cenaKop, itog.skidkaProc);
  if (skidka <= 0) return { zanyali: false, pochemu: { godit: false, pochemu: 'net_ceny' } };

  const p = po(db, itog.kod) as Promokod;
  const r = db
    .prepare(
      `WITH RECURSIVE mesta(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM mesta WHERE n < ?
       )
       INSERT INTO promo_aktivacii (kod, mesto, zakaz_id, tg_id, skidka_kop, kogda)
       SELECT ?, n, ?, ?, ?, ?
         FROM mesta
        WHERE n NOT IN (SELECT mesto FROM promo_aktivacii WHERE kod = ? AND snyata_v IS NULL)
        ORDER BY n
        LIMIT 1`,
    )
    .run(p.aktivaciy, p.kod, zakazId, tgId, skidka, seychasISO(), p.kod);
  if (r.changes === 0) return { zanyali: false, pochemu: { godit: false, pochemu: 'konchilis' } };
  return { zanyali: true, skidkaKop: skidka, skidkaProc: p.skidka_proc };
}

/**
 * Вернуть активацию коду.
 *
 * Зовётся ИЗ ТОЙ ЖЕ транзакции, что возвращает деньги на баланс
 * при отмене заказа. Раздельные «отменить» и «вернуть активацию»
 * дали бы состояние «заказ отменён, активация сгорела»: разбираться
 * с ним пришлось бы вручную, а узнать о нём — только от человека,
 * которому код не подошёл во второй раз.
 */
export function vernut(db: Baza, zakazId: number, kogda = new Date()): number {
  return db
    .prepare('UPDATE promo_aktivacii SET snyata_v = ? WHERE zakaz_id = ? AND snyata_v IS NULL')
    .run(kogda.toISOString(), zakazId).changes;
}

// ── промокод, принесённый человеком по ссылке ───────────────────────

/**
 * Запомнить принесённый код.
 *
 * В ОТЛИЧИЕ ОТ МЕТКИ КАНАЛА перезаписывается. Метка отвечает на
 * вопрос «кто привёл» — у него один ответ навсегда; промокод
 * отвечает на «чем платим сейчас», и человек, пришедший по новой
 * ссылке, имеет в виду новый код.
 */
export function zapomnitCheloveku(db: Baza, tgId: number, syroe: string): boolean {
  const kod = kodPromo(syroe);
  if (!kod) return false;
  return db.prepare('UPDATE lyudi SET promo = ? WHERE tg_id = ?').run(kod, tgId).changes > 0;
}

/** Что человек принёс. Пусто — ничего не приносил. */
export function chelovekPrines(db: Baza, tgId: number): string {
  const r = db.prepare('SELECT promo FROM lyudi WHERE tg_id = ?').get(tgId) as
    | { promo: string | null }
    | undefined;
  return kodPromo(r?.promo ?? '');
}

/**
 * Забыть принесённый код.
 *
 * Зовётся СРАЗУ ПОСЛЕ применения. Иначе человек, однажды открывший
 * ссылку с промокодом, получал бы скидку на каждый следующий заказ
 * молча и до скончания активаций — то есть код с десятью активациями
 * разбирал бы один покупатель. Нужен второй раз — открывается ссылка
 * второй раз, и это видимое действие, а не приписка навсегда.
 */
export function zabytUCheloveka(db: Baza, tgId: number): void {
  db.prepare('UPDATE lyudi SET promo = NULL WHERE tg_id = ?').run(tgId);
}
