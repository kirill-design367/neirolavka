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

export type Stroka = Chelovek & { zakazov: number; vydano: number; balans_kop: number };

/** Кого показывать: все, только с заказами, только с деньгами на балансе. */
export type Otbor = 'vse' | 's_zakazami' | 'bez_zakazov' | 's_balansom';

export type Poisk = {
  /** Строка поиска: имя, username или идентификатор. */
  q?: string;
  otbor?: Otbor;
};

const OSNOVA = `SELECT l.*,
              (SELECT COUNT(*) FROM zakazy z WHERE z.tg_id = l.tg_id) AS zakazov,
              (SELECT COUNT(*) FROM zakazy z WHERE z.tg_id = l.tg_id AND z.status = 'vydan') AS vydano,
              (SELECT COALESCE(SUM(d.kop), 0) FROM dvizheniya d WHERE d.tg_id = l.tg_id) AS balans_kop
         FROM lyudi l`;

/**
 * Люди с числом заказов и балансом — для владельца.
 *
 * ПОИСК ПО ИМЕНИ ИДЁТ НЕ В SQL, и это вынужденно: `LIKE` и `lower()`
 * в SQLite приводят регистр только у латиницы, поэтому «анна»
 * не нашла бы «Анну». Строка сравнивается в JavaScript через
 * `toLocaleLowerCase`, а ради этого при поиске выбираются все строки:
 * в `lyudi` по одной записи на человека, который хоть раз написал
 * боту, — это десятки, а не миллионы. Отбор по заказам и балансу
 * остаётся в SQL, где считать его дешевле.
 */
export function spisok(db: Baza, skolko: number, poisk: Poisk = {}): Stroka[] {
  const gde: string[] = [];
  if (poisk.otbor === 's_zakazami') gde.push('zakazov > 0');
  if (poisk.otbor === 'bez_zakazov') gde.push('zakazov = 0');
  if (poisk.otbor === 's_balansom') gde.push('balans_kop > 0');
  const uslovie = gde.length ? ` WHERE ${gde.join(' AND ')}` : '';
  const q = (poisk.q ?? '').trim().toLocaleLowerCase('ru');

  // Без строки поиска отбор и предел делает база; со строкой предел
  // ставится ПОСЛЕ отсева, иначе найденный человек мог бы не попасть
  // в выборку только потому, что писал боту давно.
  const zapros = `SELECT * FROM (${OSNOVA})${uslovie} ORDER BY poslednee DESC${q ? '' : ' LIMIT ?'}`;
  const vse = (q ? db.prepare(zapros).all() : db.prepare(zapros).all(skolko)) as Stroka[];
  if (!q) return vse;
  const bezSobaki = q.startsWith('@') ? q.slice(1) : q;
  return vse
    .filter(
      (c) =>
        (c.imya ?? '').toLocaleLowerCase('ru').includes(q) ||
        (c.username ?? '').toLocaleLowerCase('ru').includes(bezSobaki) ||
        String(c.tg_id).includes(bezSobaki),
    )
    .slice(0, skolko);
}

export type Svodka = { vsego: number; zaNedelyu: number; zaMesyac: number; zaGod: number };

/**
 * Сколько людей и сколько из них пришло недавно.
 *
 * Считается по `vpervye` — по первому разу, когда человек написал
 * боту. Это единственная дата появления, которая у нас есть, и она же
 * единственная, которую можно назвать «пришёл»: `poslednee`
 * обновляется на каждом сообщении и отвечал бы на другой вопрос.
 */
export function svodka(db: Baza, seychas = Date.now()): Svodka {
  const skolko = (dney: number): number => {
    const ot = new Date(seychas - dney * 24 * 3600_000).toISOString();
    return (db.prepare('SELECT COUNT(*) n FROM lyudi WHERE vpervye >= ?').get(ot) as { n: number }).n;
  };
  return {
    vsego: skolkoVsego(db),
    zaNedelyu: skolko(7),
    zaMesyac: skolko(30),
    zaGod: skolko(365),
  };
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
