/**
 * Отклонённые уведомления об оплате.
 *
 * ЗАЧЕМ ИХ ВООБЩЕ ХРАНИТЬ. Уведомление, которое мы не взяли, — это
 * деньги, которые пришли, а заказ остался неоплаченным. Робокасса
 * повторяет его раз в минуту, пока не получит «OK», и в журнале
 * от этого одна строка в минуту без единой подробности. Разобраться
 * по такой строке нельзя, а повторить уведомление руками нечем:
 * второй раз его не пришлют, и подпись, посчитанная не нами,
 * взять больше неоткуда.
 *
 * Записанный отказ разбирается потом — пробой подписи, не тратя
 * ни копейки и не дожидаясь новой оплаты.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Ни пароля, ни ожидаемой подписи, ни чего-либо
 * ещё, посчитанного из пароля: ожидаемую подпись проба считает сама,
 * в своём процессе, из файла окружения. База лежит с правами 700,
 * пароли — в `/etc` под root с правами 600; переносить производное
 * от них в место послабее нельзя.
 *
 * И НЕТ ПЕРСОНАЛЬНЫХ ДАННЫХ. Робокасса кладёт в уведомление почту
 * плательщика (`EMail`) и способ оплаты; хранятся только подписные
 * поля, а от остальных — ИМЕНА. Имя поля персональными данными
 * не является, а для разбора подписи знать, что поле пришло,
 * необходимо.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';

/**
 * Сколько отказов держим.
 *
 * Двадцати хватает: отказы приходят пачками по одному поводу,
 * и одинаковые склеиваются в строку со счётчиком. Без предела
 * ежеминутный повтор за сутки положил бы в базу полторы тысячи
 * строк об одной и той же беде.
 */
export const SKOLKO_DERZHIM = 20;

export type Otkaz = {
  id: number;
  postavshchik: string;
  pochemu: string;
  /** Подписные поля как пришли. */
  pary: Record<string, string>;
  /** Имена ВСЕХ пришедших полей. */
  imena: string[];
  povtorov: number;
  vpervye: string;
  poslednee: string;
};

function izStroki(r: Record<string, unknown>): Otkaz {
  return {
    id: Number(r['id']),
    postavshchik: String(r['postavshchik']),
    pochemu: String(r['pochemu']),
    pary: razobratJson(String(r['pary'])) as Record<string, string>,
    imena: razobratJson(String(r['imena'])) as string[],
    povtorov: Number(r['povtorov']),
    vpervye: String(r['vpervye']),
    poslednee: String(r['poslednee']),
  };
}

/**
 * Разбор своего же JSON.
 *
 * Своего, но всё равно с `catch`: строку в базе могли поправить
 * руками, а упавшая проба подписи — это человек, оставшийся без
 * единственного способа разобраться с потерянными деньгами.
 */
function razobratJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/**
 * Записать отказ.
 *
 * ОДИНАКОВЫЕ СКЛЕИВАЮТСЯ. Робокасса повторяет уведомление ежеминутно,
 * и двадцать одинаковых строк вместо одной со счётчиком вытеснили бы
 * предыдущий отказ — тот самый, который и надо посмотреть. Признак
 * «то же самое» — тот же поставщик, та же причина и те же подписные
 * поля: подпись входит в них, значит и она та же.
 */
export function zapisat(
  db: Baza,
  o: { postavshchik: string; pochemu: string; pary: Record<string, string>; imena: string[] },
): void {
  const pary = JSON.stringify(o.pary);
  const seychas = seychasISO();
  const est = db
    .prepare(
      'SELECT id FROM otkazy_uvedomleniy WHERE postavshchik = ? AND pochemu = ? AND pary = ? LIMIT 1',
    )
    .get(o.postavshchik, o.pochemu, pary) as { id: number } | undefined;
  if (est) {
    db.prepare(
      'UPDATE otkazy_uvedomleniy SET povtorov = povtorov + 1, poslednee = ? WHERE id = ?',
    ).run(seychas, est.id);
    return;
  }
  db.prepare(
    `INSERT INTO otkazy_uvedomleniy (postavshchik, pochemu, pary, imena, povtorov, vpervye, poslednee)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  ).run(o.postavshchik, o.pochemu, pary, JSON.stringify(o.imena), seychas, seychas);
  db.prepare(
    `DELETE FROM otkazy_uvedomleniy
      WHERE id NOT IN (SELECT id FROM otkazy_uvedomleniy ORDER BY id DESC LIMIT ?)`,
  ).run(SKOLKO_DERZHIM);
}

/** Свежие отказы, новые сверху. */
export function svezhie(db: Baza, skolko = SKOLKO_DERZHIM): Otkaz[] {
  return (
    db
      .prepare('SELECT * FROM otkazy_uvedomleniy ORDER BY poslednee DESC, id DESC LIMIT ?')
      .all(skolko) as Record<string, unknown>[]
  ).map(izStroki);
}

/** Последний отказ. Его и разбирает проба подписи. */
export function posledniy(db: Baza): Otkaz | null {
  return svezhie(db, 1)[0] ?? null;
}
