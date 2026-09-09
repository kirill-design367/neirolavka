/**
 * Выкладка прайса на сайт: состояние и история.
 *
 * Сайт статический. Цена, поставленная в панели, работает в боте
 * немедленно, а на витрину попадает только со сборкой — и всё, что
 * между нажатием и витриной, живёт здесь.
 *
 * СОСТОЯНИЕ В БАЗЕ, А НЕ В ПАМЯТИ ПРОЦЕССА. Выкладка идёт минуты,
 * а бот за это время может перезапуститься; в памяти от неё
 * не осталось бы ничего, и человек смотрел бы на вечное «идёт».
 */

import { createHash } from 'node:crypto';
import type { Baza } from './index.js';
import { seychasISO } from './index.js';

export type StatusVykladki = 'idet' | 'vylozheno' | 'ne_vyshlo';

export type Vykladka = {
  id: number;
  status: StatusVykladki;
  otpechatok: string;
  metka: string | null;
  kto: number | null;
  nachata: string;
  proverena: string | null;
  zavershena: string | null;
  soobshchenie: string | null;
};

/**
 * Отпечаток прайса. По нему видно, разошлись ли цены в панели и
 * на сайте: считается от того же текста, который уезжает в хранилище.
 */
export function otpechatok(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function poslednyaya(db: Baza): Vykladka | null {
  return (db.prepare('SELECT * FROM vykladki ORDER BY id DESC LIMIT 1').get() as Vykladka | undefined) ?? null;
}

export function idushchaya(db: Baza): Vykladka | null {
  return (
    (db.prepare("SELECT * FROM vykladki WHERE status = 'idet' ORDER BY id DESC LIMIT 1").get() as Vykladka | undefined) ??
    null
  );
}

/** Последняя УДАВШАЯСЯ: её отпечаток и есть то, что стоит на сайте. */
export function poslednyayaUdachnaya(db: Baza): Vykladka | null {
  return (
    (db.prepare("SELECT * FROM vykladki WHERE status = 'vylozheno' ORDER BY id DESC LIMIT 1").get() as
      | Vykladka
      | undefined) ?? null
  );
}

export function istoriya(db: Baza, skolko = 10): Vykladka[] {
  return db.prepare('SELECT * FROM vykladki ORDER BY id DESC LIMIT ?').all(skolko) as Vykladka[];
}

/**
 * Начать выкладку.
 *
 * Возвращает null, если одна уже идёт: вторая поверх первой запрещена
 * уникальным индексом в базе, и ловить исключение вместо ответа
 * здесь незачем — но индекс остаётся последним словом, потому что
 * два нажатия могут прийти одновременно.
 */
export function nachat(db: Baza, otp: string, kto: number | null): Vykladka | null {
  if (idushchaya(db)) return null;
  try {
    const r = db
      .prepare("INSERT INTO vykladki (status, otpechatok, kto, nachata) VALUES ('idet', ?, ?, ?)")
      .run(otp, kto, seychasISO());
    return po(db, Number(r.lastInsertRowid));
  } catch {
    // Индекс не пустил: значит выкладка началась вот только что,
    // в соседнем запросе. Это не поломка, это ответ «уже идёт».
    return null;
  }
}

/**
 * Записать, что сайт УЖЕ содержит этот прайс.
 *
 * Так бывает при первом нажатии, когда в панели ничего не меняли:
 * отправлять нечего, но мы только что сверились с хранилищем и знаем
 * это наверняка. Без записи указатель расхождения так и говорил бы
 * «ни разу не выкладывали», а кнопка отвечала бы «отправлять нечего» —
 * два разных ответа на один вопрос.
 */
export function zapisatSovpadenie(db: Baza, otp: string, kto: number | null, soobshchenie: string): void {
  const t = seychasISO();
  db.prepare(
    `INSERT INTO vykladki (status, otpechatok, kto, nachata, zavershena, soobshchenie)
     VALUES ('vylozheno', ?, ?, ?, ?, ?)`,
  ).run(otp, kto, t, t, soobshchenie);
}

export function po(db: Baza, id: number): Vykladka | null {
  return (db.prepare('SELECT * FROM vykladki WHERE id = ?').get(id) as Vykladka | undefined) ?? null;
}

/** Запомнить метку изменения: по ней ищется сборка. */
export function otmetitOtpravlennoy(db: Baza, id: number, metka: string): void {
  db.prepare('UPDATE vykladki SET metka = ?, proverena = ? WHERE id = ?').run(metka, seychasISO(), id);
}

/** Отметить, что проверяли только что: по этому решается, пора ли снова. */
export function otmetitProverku(db: Baza, id: number): void {
  db.prepare('UPDATE vykladki SET proverena = ? WHERE id = ?').run(seychasISO(), id);
}

export function zavershit(db: Baza, id: number, vyshlo: boolean, soobshchenie: string): void {
  db.prepare('UPDATE vykladki SET status = ?, zavershena = ?, soobshchenie = ? WHERE id = ?').run(
    vyshlo ? 'vylozheno' : 'ne_vyshlo',
    seychasISO(),
    soobshchenie,
    id,
  );
}

/**
 * Сколько выкладка уже идёт. Нужно ровно затем, чтобы не оставить
 * человека перед вечным «идёт»: сборка, не ответившая за это время,
 * считается не вышедшей.
 */
export const PREDEL_MINUT = 20;

export function zaviskla(v: Vykladka, seychas = Date.now()): boolean {
  return seychas - Date.parse(v.nachata) > PREDEL_MINUT * 60_000;
}
