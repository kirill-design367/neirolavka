/**
 * Доступы: логин, пароль и заметка к заказу.
 *
 * В базе лежит только шифротекст. Расшифровка происходит в момент
 * показа владельцу доступа — то есть покупателю, открывшему свой
 * заказ, — и результат нигде не сохраняется.
 *
 * В журнал пароли не попадают ни при какой ошибке: этот модуль
 * журнал вообще не подключает, а любое случайное вхождение секретов
 * в чужие сообщения вырезает lib/zhurnal.ts.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import { zashifrovat, rasshifrovat } from '../lib/shifr.js';

export type Dostup = {
  login: string;
  parol: string;
  zametka: string | null;
  kogda: string;
};

export function polozhit(
  db: Baza,
  zakazId: number,
  d: { login: string; parol: string; zametka?: string | null },
  kto: number,
  klyuch: Buffer,
): void {
  db.prepare(
    `INSERT INTO dostupy (zakaz_id, login_sh, parol_sh, zametka_sh, kto, kogda)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(zakaz_id) DO UPDATE SET login_sh = excluded.login_sh,
                                         parol_sh = excluded.parol_sh,
                                         zametka_sh = excluded.zametka_sh,
                                         kto = excluded.kto,
                                         kogda = excluded.kogda`,
  ).run(
    zakazId,
    zashifrovat(d.login, klyuch),
    zashifrovat(d.parol, klyuch),
    d.zametka ? zashifrovat(d.zametka, klyuch) : null,
    kto,
    seychasISO(),
  );
}

export function est(db: Baza, zakazId: number): boolean {
  return db.prepare('SELECT 1 FROM dostupy WHERE zakaz_id = ?').get(zakazId) !== undefined;
}

/** Расшифровать. Вызывается только там, где доступ показывают. */
export function vzyat(db: Baza, zakazId: number, klyuch: Buffer): Dostup | null {
  const r = db.prepare('SELECT * FROM dostupy WHERE zakaz_id = ?').get(zakazId) as
    | { login_sh: string; parol_sh: string; zametka_sh: string | null; kogda: string }
    | undefined;
  if (!r) return null;
  return {
    login: rasshifrovat(r.login_sh, klyuch),
    parol: rasshifrovat(r.parol_sh, klyuch),
    zametka: r.zametka_sh ? rasshifrovat(r.zametka_sh, klyuch) : null,
    kogda: r.kogda,
  };
}
