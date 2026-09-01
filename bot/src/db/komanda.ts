/**
 * Кто работает в лавке.
 *
 * Ролей две и они разные по смыслу, а не по объёму прав:
 *   владелец  — всё: заказы, выдача, люди, настройки, статистика;
 *   помощник  — только заказы и выдача.
 *
 * Помощник не видит ни списка людей, ни настроек, ни денег. Это
 * не недоверие, а объём: чтобы выдать доступ, знать выручку не нужно.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';

export type Rol = 'vladelec' | 'pomoshnik';

export type Sotrudnik = {
  tg_id: number;
  rol: Rol;
  imya: string;
  dobavlen: string;
};

/**
 * Засев из окружения при старте.
 *
 * Владельцы из NEIROLAVKA_VLADELCY попадают в базу всегда: список
 * в .env — источник правды на случай, если из базы случайно вычистили
 * всех администраторов и бот остался без хозяина.
 */
export function zaseyat(db: Baza, vladelcy: number[], pomoshniki: number[]): void {
  const vstavit = db.prepare(
    `INSERT INTO komanda (tg_id, rol, imya, dobavlen)
     VALUES (?, ?, '', ?)
     ON CONFLICT(tg_id) DO UPDATE SET rol = excluded.rol`,
  );
  db.transaction(() => {
    for (const id of vladelcy) vstavit.run(id, 'vladelec', seychasISO());
    for (const id of pomoshniki) {
      // Владелец, попавший заодно в список помощников, остаётся владельцем.
      if (!vladelcy.includes(id)) vstavit.run(id, 'pomoshnik', seychasISO());
    }
  })();
}

export function rol(db: Baza, tgId: number): Rol | null {
  const r = db.prepare('SELECT rol FROM komanda WHERE tg_id = ?').get(tgId) as { rol: Rol } | undefined;
  return r?.rol ?? null;
}

export function vladelec(db: Baza, tgId: number): boolean {
  return rol(db, tgId) === 'vladelec';
}

/** Владелец или помощник — тот, кто вообще видит служебную часть. */
export function svoy(db: Baza, tgId: number): boolean {
  return rol(db, tgId) !== null;
}

export function vsya(db: Baza): Sotrudnik[] {
  return db.prepare('SELECT tg_id, rol, imya, dobavlen FROM komanda ORDER BY rol, tg_id').all() as Sotrudnik[];
}

/** Кому уходят уведомления о заказах — всем, кто в команде. */
export function komuSoobshchat(db: Baza): number[] {
  return (db.prepare('SELECT tg_id FROM komanda').all() as { tg_id: number }[]).map((r) => r.tg_id);
}

export function dobavit(db: Baza, tgId: number, r: Rol, imya: string, kto: number): void {
  db.prepare(
    `INSERT INTO komanda (tg_id, rol, imya, dobavlen, dobavil)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET rol = excluded.rol, imya = excluded.imya`,
  ).run(tgId, r, imya, seychasISO(), kto);
}

/**
 * Убрать из команды.
 *
 * Последнего владельца убрать нельзя: лавка без хозяина — это лавка,
 * в которую никто не может войти.
 */
export function ubrat(db: Baza, tgId: number): { ok: boolean; pochemu?: string } {
  const eto = rol(db, tgId);
  if (!eto) return { ok: false, pochemu: 'такого в команде нет' };
  if (eto === 'vladelec') {
    const skolko = (db.prepare("SELECT COUNT(*) n FROM komanda WHERE rol = 'vladelec'").get() as { n: number }).n;
    if (skolko <= 1) return { ok: false, pochemu: 'это единственный владелец' };
  }
  db.prepare('DELETE FROM komanda WHERE tg_id = ?').run(tgId);
  return { ok: true };
}
