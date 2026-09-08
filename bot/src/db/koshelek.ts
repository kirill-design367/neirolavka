/**
 * Кошелёк покупателя.
 *
 * БАЛАНС — ЭТО СУММА ДВИЖЕНИЙ, а не отдельное число. Колонка с числом
 * рядом с историей — два источника правды об одних деньгах: они
 * разъезжаются на первой же правке мимо одного из них, и разъезд
 * не виден, пока кто-нибудь не пересчитает вручную. Сумма по индексу
 * на нашем потоке стоит доли миллисекунды.
 *
 * ВЫВОДА СРЕДСТВ НЕТ. Здесь нет функции, которая уменьшает баланс
 * иначе как оплатой заказа, и заводить её нельзя: баланс — это способ
 * заплатить в лавке, а не счёт, с которого забирают деньги.
 *
 * Деньги — целыми копейками, как и цены. Дробное число рублей рано
 * или поздно даёт 1989.9999999 в отчёте, и объяснять это придётся
 * живому человеку.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';

export type VidDvizheniya = 'popolnenie' | 'spisanie' | 'vozvrat';

export type Dvizhenie = {
  id: number;
  tg_id: number;
  /** Со знаком: плюс — деньги пришли, минус — ушли. */
  kop: number;
  vid: VidDvizheniya;
  zakaz_id: number | null;
  za_chto: string;
  kto: number | null;
  kogda: string;
};

export function balans(db: Baza, tgId: number): number {
  const r = db.prepare('SELECT COALESCE(SUM(kop), 0) s FROM dvizheniya WHERE tg_id = ?').get(tgId) as {
    s: number;
  };
  return r.s;
}

export function dvizheniya(db: Baza, tgId: number, skolko = 10): Dvizhenie[] {
  return db
    .prepare('SELECT * FROM dvizheniya WHERE tg_id = ? ORDER BY id DESC LIMIT ?')
    .all(tgId, skolko) as Dvizhenie[];
}

function zapisat(
  db: Baza,
  tgId: number,
  kop: number,
  vid: VidDvizheniya,
  zaChto: string,
  zakazId: number | null,
  kto: number | null,
): void {
  db.prepare(
    'INSERT INTO dvizheniya (tg_id, kop, vid, zakaz_id, za_chto, kto, kogda) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(tgId, kop, vid, zakazId, zaChto, kto, seychasISO());
}

/**
 * Пополнение. Сейчас его делает владелец руками; когда появится
 * оплата, в эту же дверь будет стучаться подтверждение платежа.
 *
 * Ноль и отрицательное не проходят: «пополнил на минус» — это списание
 * в обход учёта, и такой ошибке лучше падать сразу.
 */
export function popolnit(db: Baza, tgId: number, kop: number, zaChto: string, kto: number | null): number {
  if (!Number.isInteger(kop) || kop <= 0) throw new Error('пополнение должно быть целым числом копеек больше нуля');
  return db.transaction(() => {
    zapisat(db, tgId, kop, 'popolnenie', zaChto, null, kto);
    return balans(db, tgId);
  })();
}

/**
 * Списать за заказ СКОЛЬКО ЕСТЬ, но не больше нужного.
 *
 * Балансом можно оплатить и целиком, и частично — поэтому функция
 * возвращает списанное, а не «получилось / не получилось». Проверка
 * остатка и запись идут одной транзакцией: better-sqlite3 работает
 * синхронно и пишущий процесс один, так что уйти в минус между
 * чтением и записью невозможно.
 */
export function spisatSkolkoEst(
  db: Baza,
  tgId: number,
  hotim: number,
  zakazId: number,
  zaChto: string,
): number {
  if (!Number.isInteger(hotim) || hotim <= 0) return 0;
  return db.transaction(() => {
    const est = balans(db, tgId);
    const skolko = Math.min(est, hotim);
    if (skolko <= 0) return 0;
    zapisat(db, tgId, -skolko, 'spisanie', zaChto, zakazId, null);
    return skolko;
  })();
}

/**
 * Возврат на баланс. Отдельный вид движения, а не «пополнение»:
 * в выписке человек обязан видеть, что это его же деньги вернулись
 * по отменённому заказу, а не подарок лавки.
 */
export function vernut(db: Baza, tgId: number, kop: number, zakazId: number, zaChto: string): void {
  if (!Number.isInteger(kop) || kop <= 0) return;
  zapisat(db, tgId, kop, 'vozvrat', zaChto, zakazId, null);
}
