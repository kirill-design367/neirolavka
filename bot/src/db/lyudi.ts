/**
 * Люди.
 *
 * Хранится минимум: телеграм-идентификатор и то, что Telegram сам
 * прикладывает к каждому сообщению. Ни телефона, ни почты, ни имени
 * из паспорта — сайт и бот их не спрашивают.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';

export type Chelovek = {
  tg_id: number;
  imya: string;
  username: string | null;
  vpervye: string;
  poslednee: string;
};

export function zapomnit(db: Baza, tgId: number, imya: string, username: string | null): void {
  db.prepare(
    `INSERT INTO lyudi (tg_id, imya, username, vpervye, poslednee)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET imya = excluded.imya,
                                      username = excluded.username,
                                      poslednee = excluded.poslednee`,
  ).run(tgId, imya, username, seychasISO(), seychasISO());
}

export function chelovek(db: Baza, tgId: number): Chelovek | null {
  return (db.prepare('SELECT * FROM lyudi WHERE tg_id = ?').get(tgId) as Chelovek | undefined) ?? null;
}

/** Люди с числом заказов — для владельца. */
export function spisok(db: Baza, skolko: number): (Chelovek & { zakazov: number; vydano: number })[] {
  return db
    .prepare(
      `SELECT l.*,
              (SELECT COUNT(*) FROM zakazy z WHERE z.tg_id = l.tg_id) AS zakazov,
              (SELECT COUNT(*) FROM zakazy z WHERE z.tg_id = l.tg_id AND z.status = 'vydan') AS vydano
         FROM lyudi l
        ORDER BY l.poslednee DESC
        LIMIT ?`,
    )
    .all(skolko) as (Chelovek & { zakazov: number; vydano: number })[];
}

export function skolkoVsego(db: Baza): number {
  return (db.prepare('SELECT COUNT(*) n FROM lyudi').get() as { n: number }).n;
}

/** Как называть человека в служебных сообщениях. */
export function podpis(c: Chelovek | null, tgId: number): string {
  if (!c) return `id ${tgId}`;
  const hvost = c.username ? ` (@${c.username})` : '';
  return `${c.imya || `id ${tgId}`}${hvost}`;
}
