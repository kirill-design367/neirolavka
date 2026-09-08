/**
 * Коды двухфакторной аутентификации.
 *
 * Отдельная таблица, а не поле заказа: код запрашивают по нескольку
 * раз — первый не подошёл, письмо пришло с задержкой, помощник вернул
 * заказ в очередь и взял снова, — и порядок попыток нужен, когда
 * потом разбираются, что пошло не так.
 *
 * Сам код лежит шифротекстом. Живёт он минуты, но пока он лежит
 * открытым в базе, он открытый: файл базы уносят целиком.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import { zashifrovat, rasshifrovat } from '../lib/shifr.js';

export type Zapros = {
  id: number;
  zakaz_id: number;
  zapros_v: string;
  poluchen_v: string | null;
  kto_zaprosil: number | null;
};

/** Запрос кода: помощник дошёл до шага входа. */
export function zaprosit(db: Baza, zakazId: number, kto: number): number {
  const r = db
    .prepare('INSERT INTO kody (zakaz_id, zapros_v, kto_zaprosil) VALUES (?, ?, ?)')
    .run(zakazId, seychasISO(), kto);
  return Number(r.lastInsertRowid);
}

/** Последний запрос по заказу. */
export function posledniy(db: Baza, zakazId: number): Zapros | null {
  return (
    (db
      .prepare('SELECT id, zakaz_id, zapros_v, poluchen_v, kto_zaprosil FROM kody WHERE zakaz_id = ? ORDER BY id DESC LIMIT 1')
      .get(zakazId) as Zapros | undefined) ?? null
  );
}

/**
 * Записать пришедший код. Пишем в ПОСЛЕДНИЙ незакрытый запрос —
 * тот, на который человек и отвечает.
 */
export function zapisat(db: Baza, zakazId: number, kod: string, klyuch: Buffer): boolean {
  const z = posledniy(db, zakazId);
  if (!z || z.poluchen_v) return false;
  db.prepare('UPDATE kody SET kod_sh = ?, poluchen_v = ? WHERE id = ?').run(
    zashifrovat(kod, klyuch),
    seychasISO(),
    z.id,
  );
  return true;
}

/** Показать код помощнику. Расшифровка — только здесь. */
export function vzyat(db: Baza, zakazId: number, klyuch: Buffer): { kod: string; kogda: string } | null {
  const r = db
    .prepare('SELECT kod_sh, poluchen_v FROM kody WHERE zakaz_id = ? AND kod_sh IS NOT NULL ORDER BY id DESC LIMIT 1')
    .get(zakazId) as { kod_sh: string; poluchen_v: string } | undefined;
  if (!r) return null;
  return { kod: rasshifrovat(r.kod_sh, klyuch), kogda: r.poluchen_v };
}
