/**
 * Незаконченные разговоры.
 *
 * Администратор вводит логин, потом пароль — между двумя сообщениями
 * бот должен помнить, что происходит и к какому заказу это относится.
 * Память процесса для этого не годится: бот перезапускается при каждом
 * обновлении, и начатый ввод пропал бы вместе с ней.
 *
 * Черновик (уже введённый логин) хранится ЗАШИФРОВАННЫМ: это часть
 * доступа, и лежать открытым в базе ему незачем даже полминуты.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import { zashifrovat, rasshifrovat } from '../lib/shifr.js';

/**
 * Шаг разговора.
 *
 * Первые — покупателя, остальные — служебные. Разделение важно
 * в разборе: покупательские шаги проходят до проверки роли, иначе
 * человек, начавший вводить пароль от своего аккаунта, упёрся бы
 * в «этот раздел только для владельца».
 */
export type Shag =
  // покупатель
  | 'zhdem_pochtu'
  | 'zhdem_parol_akkaunta'
  /* Введённое показано человеку, ждём «Всё верно» или «Исправить».
     Черновик на этом шаге держит и почту, и пароль: «исправить»
     не должно стирать то, что человек уже набрал. */
  | 'zhdem_svereniya'
  | 'zhdem_kod'
  | 'zhdem_svereniya_koda'
  | 'zhdem_vopros'
  // служебные
  | 'zhdem_login'
  | 'zhdem_parol'
  | 'zhdem_pomoshnika'
  | 'zhdem_chasy'
  | 'zhdem_popolnenie';

/**
 * Шаги покупателя: их разбирают ДО проверки роли.
 *
 * Список ЖИВОЙ, а не справочный: разбор текста сверяется с ним и,
 * не найдя обработчика покупательскому шагу, кричит в журнал. Пока
 * константа лежала без дела, добавленный шаг молча проваливался
 * в ветку «только служебные», где разговор покупателя забывается,
 * а человек получает «Не понял сообщение» на свой пароль.
 */
export const SHAGI_POKUPATELYA: Shag[] = [
  'zhdem_pochtu',
  'zhdem_parol_akkaunta',
  'zhdem_svereniya',
  'zhdem_kod',
  'zhdem_svereniya_koda',
  'zhdem_vopros',
];

export type Dialog = {
  shag: Shag;
  zakazId: number | null;
  chernovik: Record<string, string>;
};

export function postavit(
  db: Baza,
  tgId: number,
  shag: Shag,
  zakazId: number | null,
  chernovik: Record<string, string>,
  klyuch: Buffer,
): void {
  const telo = Object.keys(chernovik).length ? zashifrovat(JSON.stringify(chernovik), klyuch) : null;
  db.prepare(
    `INSERT INTO dialogi (tg_id, shag, zakaz_id, chernovik, izmenen)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET shag = excluded.shag,
                                      zakaz_id = excluded.zakaz_id,
                                      chernovik = excluded.chernovik,
                                      izmenen = excluded.izmenen`,
  ).run(tgId, shag, zakazId, telo, seychasISO());
}

export function vzyat(db: Baza, tgId: number, klyuch: Buffer): Dialog | null {
  const r = db.prepare('SELECT shag, zakaz_id, chernovik FROM dialogi WHERE tg_id = ?').get(tgId) as
    | { shag: Shag; zakaz_id: number | null; chernovik: string | null }
    | undefined;
  if (!r) return null;
  let chernovik: Record<string, string> = {};
  if (r.chernovik) {
    try {
      chernovik = JSON.parse(rasshifrovat(r.chernovik, klyuch)) as Record<string, string>;
    } catch {
      // Черновик не читается — начинаем разговор заново. Терять тут
      // нечего: это половина ввода, а не оплаченный заказ.
      chernovik = {};
    }
  }
  return { shag: r.shag, zakazId: r.zakaz_id, chernovik };
}

export function zabyt(db: Baza, tgId: number): void {
  db.prepare('DELETE FROM dialogi WHERE tg_id = ?').run(tgId);
}
