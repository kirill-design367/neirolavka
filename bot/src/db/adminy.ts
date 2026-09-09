/**
 * Вход в админ-панель: учётки, сессии, защита от перебора.
 *
 * Три правила, каждое куплено чужой болью, а не выдумано:
 *
 * 1. ПАРОЛЬ НЕ ХРАНИТСЯ. В базе лежит scrypt-хеш со своей солью.
 *    Утёкшая база не даёт войти, а подобрать пароль по хешу стоит
 *    времени: scrypt намеренно медленный и жадный до памяти.
 * 2. В КУКЕ ЖИВЁТ ТОКЕН, В БАЗЕ — ЕГО ОТПЕЧАТОК. Иначе утёкшая база
 *    равносильна открытой сессии у каждого администратора.
 * 3. СЧЁТЧИК НЕУДАЧ — В БАЗЕ. В памяти процесса он обнулялся бы при
 *    каждой выкладке, то есть защита от перебора отключалась бы
 *    ровно тогда, когда её проще всего обойти.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Baza } from './index.js';
import { seychasISO } from './index.js';

/** Сколько живёт сессия с ПОСЛЕДНЕГО действия. */
export const SROK_SESSII_MS = 8 * 3600_000;

/** Сколько неудач подряд до запирания. */
export const NEUDACH_DO_ZAMKA = 5;
/** Первая пауза после запирания; дальше удваивается до потолка. */
export const PAUZA_MS = 60_000;
export const PREDEL_PAUZY_MS = 15 * 60_000;

// Параметры scrypt. Не «покрепче, чем у всех», а те, что рекомендованы
// и укладываются в память маленькой машины: 16 МБ на проверку пароля.
const N = 16_384;
const R = 8;
const P = 1;
const DLINA = 64;

export function zashifrovatParol(parol: string): string {
  const sol = randomBytes(16);
  const hash = scryptSync(parol.normalize('NFKC'), sol, DLINA, { N, r: R, p: P });
  return ['s1', sol.toString('base64'), hash.toString('base64')].join('.');
}

/** Сравнение постоянного времени: по времени ответа пароль не подбирают. */
export function parolPodhodit(parol: string, zapis: string): boolean {
  const chasti = zapis.split('.');
  if (chasti.length !== 3 || chasti[0] !== 's1') return false;
  try {
    const sol = Buffer.from(chasti[1] as string, 'base64');
    const dolzhno = Buffer.from(chasti[2] as string, 'base64');
    const est = scryptSync(parol.normalize('NFKC'), sol, dolzhno.length, { N, r: R, p: P });
    return timingSafeEqual(est, dolzhno);
  } catch {
    return false;
  }
}

export type Uchetka = {
  login: string;
  parol_hash: string;
  tg_id: number;
  sozdan: string;
  poslednii_vhod: string | null;
};

export function uchetka(db: Baza, login: string): Uchetka | null {
  return (db.prepare('SELECT * FROM admin_uchetki WHERE login = ?').get(login) as Uchetka | undefined) ?? null;
}

export function vseUchetki(db: Baza): Uchetka[] {
  return db.prepare('SELECT * FROM admin_uchetki ORDER BY login').all() as Uchetka[];
}

/**
 * Завести или переписать учётку.
 *
 * `tgId` обязателен и должен быть в команде: роль берётся оттуда,
 * а не хранится здесь. Одно место — одна правда, и панель не может
 * выдать прав больше, чем у человека в боте.
 */
export function zavesti(db: Baza, login: string, parol: string, tgId: number): void {
  db.prepare(
    `INSERT INTO admin_uchetki (login, parol_hash, tg_id, sozdan)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(login) DO UPDATE SET parol_hash = excluded.parol_hash, tg_id = excluded.tg_id`,
  ).run(login, zashifrovatParol(parol), tgId, seychasISO());
}

export function ubratUchetku(db: Baza, login: string): void {
  db.prepare('DELETE FROM admin_uchetki WHERE login = ?').run(login);
}

// ── защита от перебора ───────────────────────────────────────────────

export type Zamok = { zaperto: boolean; doMs: number };

export function zamok(db: Baza, login: string, seychas = Date.now()): Zamok {
  const r = db.prepare('SELECT do FROM admin_popytki WHERE login = ?').get(login) as
    | { do: string | null }
    | undefined;
  const do_ = r?.do ? Date.parse(r.do) : 0;
  return { zaperto: do_ > seychas, doMs: do_ };
}

export function otmetitNeudachu(db: Baza, login: string, seychas = Date.now()): Zamok {
  const r = db.prepare('SELECT neudach FROM admin_popytki WHERE login = ?').get(login) as
    | { neudach: number }
    | undefined;
  const neudach = (r?.neudach ?? 0) + 1;
  let do_: string | null = null;
  if (neudach >= NEUDACH_DO_ZAMKA) {
    // Пауза удваивается с каждой лишней неудачей: перебор становится
    // бессмысленным, а живой человек, ошибшийся пятый раз подряд,
    // ждёт минуту, а не сутки.
    const shag = Math.min(PAUZA_MS * 2 ** (neudach - NEUDACH_DO_ZAMKA), PREDEL_PAUZY_MS);
    do_ = new Date(seychas + shag).toISOString();
  }
  db.prepare(
    `INSERT INTO admin_popytki (login, neudach, do) VALUES (?, ?, ?)
     ON CONFLICT(login) DO UPDATE SET neudach = excluded.neudach, do = excluded.do`,
  ).run(login, neudach, do_);
  return zamok(db, login, seychas);
}

export function zabytNeudachi(db: Baza, login: string): void {
  db.prepare('DELETE FROM admin_popytki WHERE login = ?').run(login);
}

// ── сессии ───────────────────────────────────────────────────────────

export type Sessiya = { login: string; tgId: number; zashchita: string };

const otpechatok = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Завести сессию. Возвращает токен для куки — в базе его нет. */
export function nachatSessiyu(db: Baza, login: string, seychas = Date.now()): { token: string; zashchita: string } {
  const token = randomBytes(32).toString('base64url');
  const zashchita = randomBytes(24).toString('base64url');
  db.prepare(
    'INSERT INTO admin_sessii (token_hash, login, sozdana, do, zashchita) VALUES (?, ?, ?, ?, ?)',
  ).run(otpechatok(token), login, new Date(seychas).toISOString(), new Date(seychas + SROK_SESSII_MS).toISOString(), zashchita);
  db.prepare('UPDATE admin_uchetki SET poslednii_vhod = ? WHERE login = ?').run(seychasISO(), login);
  return { token, zashchita };
}

/**
 * Найти живую сессию и продлить её.
 *
 * Срок считается от ПОСЛЕДНЕГО действия: рабочий день не должен
 * прерываться повторным входом, а забытая на ночь вкладка не должна
 * оставаться открытой дверью.
 */
export function sessiya(db: Baza, token: string, seychas = Date.now()): Sessiya | null {
  const h = otpechatok(token);
  const r = db.prepare('SELECT * FROM admin_sessii WHERE token_hash = ?').get(h) as
    | { login: string; do: string; zashchita: string }
    | undefined;
  if (!r) return null;
  if (Date.parse(r.do) <= seychas) {
    db.prepare('DELETE FROM admin_sessii WHERE token_hash = ?').run(h);
    return null;
  }
  const u = uchetka(db, r.login);
  if (!u) return null;
  db.prepare('UPDATE admin_sessii SET do = ? WHERE token_hash = ?').run(
    new Date(seychas + SROK_SESSII_MS).toISOString(),
    h,
  );
  return { login: r.login, tgId: u.tg_id, zashchita: r.zashchita };
}

export function zakonchitSessiyu(db: Baza, token: string): void {
  db.prepare('DELETE FROM admin_sessii WHERE token_hash = ?').run(otpechatok(token));
}

/** Убрать протухшие сессии. Зовётся при входе: отдельный таймер тут лишний. */
export function ubratStarye(db: Baza, seychas = Date.now()): void {
  db.prepare('DELETE FROM admin_sessii WHERE do <= ?').run(new Date(seychas).toISOString());
}
