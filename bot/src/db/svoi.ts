/**
 * Аккаунт, который покупатель принёс свой.
 *
 * Логин почты, привязанной к нейросети, и пароль от аккаунта. Это
 * такие же секреты, как выдаваемые доступы, и лежат они так же —
 * только шифротекстом, ключ в /etc под root.
 *
 * Расшифровка происходит в одном месте: когда помощник открывает
 * заказ, чтобы войти в аккаунт. Результат нигде не сохраняется,
 * в журнал не попадает ни при какой ошибке — этот модуль журнал
 * вообще не подключает.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import { zashifrovat, rasshifrovat } from '../lib/shifr.js';

export type SvoyAkkaunt = { pochta: string; parol: string; kogda: string };

export function polozhit(db: Baza, zakazId: number, pochta: string, parol: string, klyuch: Buffer): void {
  db.prepare(
    `INSERT INTO svoi_akkaunty (zakaz_id, pochta_sh, parol_sh, kogda)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(zakaz_id) DO UPDATE SET pochta_sh = excluded.pochta_sh,
                                         parol_sh = excluded.parol_sh,
                                         kogda = excluded.kogda`,
  ).run(zakazId, zashifrovat(pochta, klyuch), zashifrovat(parol, klyuch), seychasISO());
}

export function est(db: Baza, zakazId: number): boolean {
  return db.prepare('SELECT 1 FROM svoi_akkaunty WHERE zakaz_id = ?').get(zakazId) !== undefined;
}

/** Расшифровать. Зовётся только там, где помощник входит в аккаунт. */
export function vzyat(db: Baza, zakazId: number, klyuch: Buffer): SvoyAkkaunt | null {
  const r = db.prepare('SELECT * FROM svoi_akkaunty WHERE zakaz_id = ?').get(zakazId) as
    | { pochta_sh: string; parol_sh: string; kogda: string }
    | undefined;
  if (!r) return null;
  return {
    pochta: rasshifrovat(r.pochta_sh, klyuch),
    parol: rasshifrovat(r.parol_sh, klyuch),
    kogda: r.kogda,
  };
}
