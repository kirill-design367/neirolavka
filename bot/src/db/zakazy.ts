/**
 * Заказы.
 *
 * Весь путь заказа лежит в базе: создан → оплачен → взят в работу →
 * выдан. В памяти процесса не держится ничего, поэтому перезапуск
 * бота посреди работы ничего не теряет — а перезапуск случается
 * при каждом обновлении.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';

export type StatusZakaza = 'zhdet_oplaty' | 'oplachen' | 'v_rabote' | 'vydan' | 'otmenen';

export type Zakaz = {
  id: number;
  tg_id: number;
  produkt_id: string;
  plan_id: string;
  nazvanie: string;
  cena_kop: number;
  mesyacev: number;
  status: StatusZakaza;
  sozdan: string;
  oplachen: string | null;
  vzyat: string | null;
  ispolnitel: number | null;
  vydan: string | null;
  srok_do: string | null;
  dostup_do: string | null;
  napominany_raz: number;
  napominanie_v: string | null;
};

/** Статусы, в которых заказ ещё «живой». */
export const OTKRYTYE: StatusZakaza[] = ['zhdet_oplaty', 'oplachen', 'v_rabote'];

export function sobytie(db: Baza, zakazId: number | null, chto: string, kto: number | null, podrobnosti?: string): void {
  db.prepare('INSERT INTO sobytiya (zakaz_id, kogda, kto, chto, podrobnosti) VALUES (?, ?, ?, ?, ?)').run(
    zakazId,
    seychasISO(),
    kto,
    chto,
    podrobnosti ?? null,
  );
}

export function sobytiya(db: Baza, zakazId: number): { kogda: string; chto: string; kto: number | null }[] {
  return db
    .prepare('SELECT kogda, chto, kto FROM sobytiya WHERE zakaz_id = ? ORDER BY id')
    .all(zakazId) as { kogda: string; chto: string; kto: number | null }[];
}

export type Novy = {
  tgId: number;
  produktId: string;
  planId: string;
  nazvanie: string;
  cenaKop: number;
  mesyacev: number;
};

/**
 * Создать заказ — или вернуть уже существующий.
 *
 * Второе не менее важно первого. Человек жмёт кнопку дважды, Telegram
 * повторяет доставку, связь моргает — во всех этих случаях должен
 * получиться ОДИН заказ. Гарантию даёт уникальный индекс в базе:
 * попытка завести второй открытый заказ на тот же тариф не проходит,
 * и мы честно возвращаем первый, пометив, что он не новый.
 */
export function sozdatIliVernut(db: Baza, n: Novy): { zakaz: Zakaz; novy: boolean } {
  const est = db
    .prepare(
      `SELECT * FROM zakazy
        WHERE tg_id = ? AND plan_id = ? AND status IN ('zhdet_oplaty','oplachen','v_rabote')`,
    )
    .get(n.tgId, n.planId) as Zakaz | undefined;
  if (est) return { zakaz: est, novy: false };

  try {
    const r = db
      .prepare(
        `INSERT INTO zakazy (tg_id, produkt_id, plan_id, nazvanie, cena_kop, mesyacev, status, sozdan)
         VALUES (?, ?, ?, ?, ?, ?, 'zhdet_oplaty', ?)`,
      )
      .run(n.tgId, n.produktId, n.planId, n.nazvanie, n.cenaKop, n.mesyacev, seychasISO());
    const id = Number(r.lastInsertRowid);
    sobytie(db, id, 'заказ создан', n.tgId);
    return { zakaz: po(db, id) as Zakaz, novy: true };
  } catch (e) {
    // Гонка: между проверкой и вставкой заказ успел появиться.
    // Индекс нас поймал — значит заказ есть, отдаём его.
    const povtor = db
      .prepare(
        `SELECT * FROM zakazy
          WHERE tg_id = ? AND plan_id = ? AND status IN ('zhdet_oplaty','oplachen','v_rabote')`,
      )
      .get(n.tgId, n.planId) as Zakaz | undefined;
    if (povtor) return { zakaz: povtor, novy: false };
    throw e;
  }
}

/**
 * Завести платёж рядом с заказом.
 *
 * Пока поставщик — заглушка, сюда не попадает ничего. Функция есть
 * затем, чтобы следующим заходом запись платежа не пришлось изобретать
 * посреди обработчика нажатия.
 */
export function zavestiPlatezh(
  db: Baza,
  zakazId: number,
  postavshchik: string,
  vneshnyId: string | null,
  summaKop: number,
): void {
  db.prepare(
    `INSERT INTO platezhi (zakaz_id, postavshchik, vneshny_id, summa_kop, valyuta, status, sozdan)
     VALUES (?, ?, ?, ?, 'RUB', 'sozdan', ?)`,
  ).run(zakazId, postavshchik, vneshnyId, summaKop, seychasISO());
}

export function po(db: Baza, id: number): Zakaz | null {
  return (db.prepare('SELECT * FROM zakazy WHERE id = ?').get(id) as Zakaz | undefined) ?? null;
}

export function cheloveka(db: Baza, tgId: number, skolko = 20): Zakaz[] {
  return db.prepare('SELECT * FROM zakazy WHERE tg_id = ? ORDER BY id DESC LIMIT ?').all(tgId, skolko) as Zakaz[];
}

/** Очередь на выдачу: оплаченные и взятые в работу, старые сверху. */
export function ochered(db: Baza): Zakaz[] {
  return db
    .prepare("SELECT * FROM zakazy WHERE status IN ('oplachen','v_rabote') ORDER BY id")
    .all() as Zakaz[];
}

export function neoplachennye(db: Baza): Zakaz[] {
  return db.prepare("SELECT * FROM zakazy WHERE status = 'zhdet_oplaty' ORDER BY id").all() as Zakaz[];
}

/**
 * Отметить оплаченным.
 *
 * Единственная дверь, через которую заказ становится оплаченным.
 * Сейчас в неё стучится администратор кнопкой, следующим заходом
 * будет стучаться уведомление от платёжной системы — и больше
 * ничего менять не придётся.
 *
 * Возвращает false, если заказ уже оплачен: повторное уведомление
 * от платёжной системы не должно поднимать вторую волну сообщений.
 */
export function otmetitOplachennym(db: Baza, id: number, srokDo: Date, kto: number | null): boolean {
  const r = db
    .prepare("UPDATE zakazy SET status = 'oplachen', oplachen = ?, srok_do = ? WHERE id = ? AND status = 'zhdet_oplaty'")
    .run(seychasISO(), srokDo.toISOString(), id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'оплата подтверждена', kto);
  return true;
}

/** Взять в работу. false — если кто-то уже взял. */
export function vzyat(db: Baza, id: number, kto: number): boolean {
  const r = db
    .prepare("UPDATE zakazy SET status = 'v_rabote', vzyat = ?, ispolnitel = ? WHERE id = ? AND status = 'oplachen'")
    .run(seychasISO(), kto, id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'взят в работу', kto);
  return true;
}

/** Вернуть в очередь: взял и передумал. */
export function vernutVOchered(db: Baza, id: number, kto: number): boolean {
  const r = db
    .prepare("UPDATE zakazy SET status = 'oplachen', vzyat = NULL, ispolnitel = NULL WHERE id = ? AND status = 'v_rabote'")
    .run(id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'возвращён в очередь', kto);
  return true;
}

export function otmetitVydannym(db: Baza, id: number, dostupDo: Date, kto: number): boolean {
  const r = db
    .prepare("UPDATE zakazy SET status = 'vydan', vydan = ?, dostup_do = ?, ispolnitel = ? WHERE id = ? AND status IN ('oplachen','v_rabote')")
    .run(seychasISO(), dostupDo.toISOString(), kto, id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'доступ выдан', kto);
  return true;
}

export function otmenit(db: Baza, id: number, kto: number | null, pochemu: string): boolean {
  // Перечисляем статусы явно, а не «всё, кроме выданного»: с отрицанием
  // повторная отмена проходила бы второй раз и слала бы человеку второе
  // извинение за одно и то же.
  const r = db
    .prepare("UPDATE zakazy SET status = 'otmenen' WHERE id = ? AND status IN ('zhdet_oplaty','oplachen','v_rabote')")
    .run(id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'заказ отменён', kto, pochemu);
  return true;
}

/**
 * Просроченные: обещали выдать раньше, а всё ещё не выдали.
 *
 * Второе условие — «давно не напоминали»: напоминание не должно
 * приходить каждую минуту, иначе на него перестанут смотреть.
 */
export function prosrochennye(db: Baza, seychas: Date, pauzaMinut: number, predelRaz: number): Zakaz[] {
  const porog = new Date(seychas.getTime() - pauzaMinut * 60_000).toISOString();
  return db
    .prepare(
      `SELECT * FROM zakazy
        WHERE status IN ('oplachen','v_rabote')
          AND srok_do IS NOT NULL
          AND srok_do < ?
          AND napominany_raz < ?
          AND (napominanie_v IS NULL OR napominanie_v < ?)
        ORDER BY id`,
    )
    .all(seychas.toISOString(), predelRaz, porog) as Zakaz[];
}

export function otmetitNapominanie(db: Baza, id: number, kogda = new Date()): void {
  db.prepare('UPDATE zakazy SET napominany_raz = napominany_raz + 1, napominanie_v = ? WHERE id = ?').run(
    kogda.toISOString(),
    id,
  );
}

export type Statistika = {
  vsego: number;
  poStatusam: Record<string, number>;
  vyruchkaKop: number;
  poTovaram: { produkt_id: string; skolko: number; summa_kop: number }[];
  zaSutki: number;
  srednyayaVydachaMinut: number | null;
};

export function statistika(db: Baza): Statistika {
  const poStatusam: Record<string, number> = {};
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM zakazy GROUP BY status').all() as {
    status: string;
    n: number;
  }[]) {
    poStatusam[r.status] = r.n;
  }
  const vsego = (db.prepare('SELECT COUNT(*) n FROM zakazy').get() as { n: number }).n;
  const vyruchka = (
    db.prepare("SELECT COALESCE(SUM(cena_kop), 0) s FROM zakazy WHERE status = 'vydan'").get() as { s: number }
  ).s;
  const poTovaram = db
    .prepare(
      `SELECT produkt_id, COUNT(*) skolko, COALESCE(SUM(cena_kop),0) summa_kop
         FROM zakazy WHERE status = 'vydan' GROUP BY produkt_id ORDER BY skolko DESC`,
    )
    .all() as { produkt_id: string; skolko: number; summa_kop: number }[];
  const sutki = new Date(Date.now() - 24 * 3600_000).toISOString();
  const zaSutki = (db.prepare('SELECT COUNT(*) n FROM zakazy WHERE sozdan > ?').get(sutki) as { n: number }).n;
  const sredn = db
    .prepare(
      `SELECT AVG((julianday(vydan) - julianday(oplachen)) * 24 * 60) m
         FROM zakazy WHERE status = 'vydan' AND oplachen IS NOT NULL AND vydan IS NOT NULL`,
    )
    .get() as { m: number | null };
  return {
    vsego,
    poStatusam,
    vyruchkaKop: vyruchka,
    poTovaram,
    zaSutki,
    srednyayaVydachaMinut: sredn.m === null ? null : Math.round(sredn.m),
  };
}
