/**
 * Метки рекламных каналов: откуда пришли покупатели.
 *
 * ДВЕ РАЗНЫЕ ВЕЩИ, и путать их нельзя.
 *
 * Первая — метка НА ЧЕЛОВЕКЕ (`lyudi.metka`). Ставится при первом
 * касании и больше не меняется: вопрос «какой канал привёл этого
 * покупателя» имеет ровно один ответ. Последний клик перезаписал бы
 * его на ссылку, по которой человек вернулся уже своим, и вся
 * статистика каналов начала бы врать в пользу ретаргетинга.
 *
 * Вторая — запись В ТАБЛИЦЕ `metki`. Она НЕ обязательна: человек,
 * пришедший по чужой ссылке с `utm_source=vk`, посчитается под кодом
 * `vk` и без всякой записи. Таблица нужна затем, чтобы у канала было
 * человеческое имя и готовые ссылки, а не голый код.
 *
 * Отсюда главное для статистики: список источников строится ПО ЛЮДЯМ,
 * а имена подтягиваются из таблицы. Строй его по таблице — и весь
 * неразмеченный нами трафик исчез бы с экрана.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import { kodMetki } from '../lib/metka.js';

export type Metka = {
  kod: string;
  nazvanie: string;
  istochnik: string;
  kanal: string;
  kampaniya: string;
  sozdana: string;
  kto: number | null;
};

/** Строка сводки: один источник. */
export type Stroka = {
  kod: string;
  /** Имя из таблицы, если метка заведена; иначе сам код. */
  nazvanie: string;
  /** Заведена ли она в панели — от этого зависит, есть ли ссылки. */
  svoya: boolean;
  lyudey: number;
  zakazov: number;
  vydano: number;
};

export function zavesti(
  db: Baza,
  m: { kod: string; nazvanie: string; istochnik?: string; kanal?: string; kampaniya?: string },
  kto: number | null,
): Metka | null {
  const kod = kodMetki(m.kod);
  if (!kod) return null;
  db.prepare(
    `INSERT INTO metki (kod, nazvanie, istochnik, kanal, kampaniya, sozdana, kto)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kod) DO UPDATE SET nazvanie = excluded.nazvanie,
                                    istochnik = excluded.istochnik,
                                    kanal = excluded.kanal,
                                    kampaniya = excluded.kampaniya`,
  ).run(
    kod,
    m.nazvanie.trim() || kod,
    (m.istochnik ?? '').trim(),
    (m.kanal ?? '').trim(),
    (m.kampaniya ?? '').trim(),
    seychasISO(),
    kto,
  );
  return po(db, kod);
}

export function po(db: Baza, kod: string): Metka | null {
  return (db.prepare('SELECT * FROM metki WHERE kod = ?').get(kod) as Metka | undefined) ?? null;
}

export function vse(db: Baza): Metka[] {
  return db.prepare('SELECT * FROM metki ORDER BY sozdana DESC').all() as Metka[];
}

export function ubrat(db: Baza, kod: string): boolean {
  /* Убирается только ИМЯ канала, а не люди: `lyudi.metka` остаётся
     как была, и источник продолжает считаться — просто под голым
     кодом. Стирать метку у людей значило бы переписывать историю. */
  return db.prepare('DELETE FROM metki WHERE kod = ?').run(kod).changes > 0;
}

/**
 * Записать метку человеку — ТОЛЬКО если её ещё нет.
 *
 * `WHERE metka IS NULL` стоит в самом запросе, а не проверкой в коде:
 * человек может открыть две ссылки подряд, и проверка «прочитали,
 * потом записали» между ними разъедется.
 */
export function zapisatCheloveku(db: Baza, tgId: number, kod: string): boolean {
  const chistyy = kodMetki(kod);
  if (!chistyy) return false;
  return (
    db.prepare('UPDATE lyudi SET metka = ? WHERE tg_id = ? AND metka IS NULL').run(chistyy, tgId)
      .changes > 0
  );
}

/**
 * Сводка по источникам за период.
 *
 * Люди режутся по `vpervye` — по первому касанию, тому же самому,
 * которым ставится метка. Резать их по дате заказа значило бы
 * отвечать на другой вопрос: не «сколько привёл канал», а «сколько
 * из приведённых купили в эти дни».
 *
 * Заказы и выдачи считаются по ВСЕМ заказам этих людей, без второго
 * окна: строка отвечает «что вышло из людей, пришедших в этот
 * период», и обрезать их заказы тем же окном значило бы терять всех,
 * кто пришёл в конце месяца и купил в начале следующего.
 */
export function svodka(db: Baza, ot: string | null, po_: string | null): Stroka[] {
  const gde = ot && po_ ? 'WHERE l.vpervye >= ? AND l.vpervye < ?' : '';
  const args = ot && po_ ? [ot, po_] : [];
  const syrye = db
    .prepare(
      `SELECT COALESCE(l.metka, '') AS kod,
              COUNT(DISTINCT l.tg_id) AS lyudey,
              COUNT(z.id) AS zakazov,
              SUM(CASE WHEN z.status = 'vydan' THEN 1 ELSE 0 END) AS vydano
         FROM lyudi l
         LEFT JOIN zakazy z ON z.tg_id = l.tg_id
         ${gde}
        GROUP BY COALESCE(l.metka, '')
        ORDER BY lyudey DESC, kod`,
    )
    .all(...args) as { kod: string; lyudey: number; zakazov: number; vydano: number | null }[];

  const imena = new Map(vse(db).map((m) => [m.kod, m.nazvanie]));
  return syrye.map((r) => ({
    kod: r.kod,
    nazvanie: imena.get(r.kod) ?? r.kod,
    svoya: imena.has(r.kod),
    lyudey: r.lyudey,
    zakazov: r.zakazov,
    vydano: r.vydano ?? 0,
  }));
}
