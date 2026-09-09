/**
 * Каталог в базе.
 *
 * Прайс правит живой человек из панели, а не выкладка — поэтому
 * продукты и уровни подписки лежат в базе. Файл `src/lib/catalog.ts`
 * из корня репозитория остаётся ЗАСЕВОМ: при первом запуске его
 * содержимое переносится сюда один раз, и дальше правда здесь.
 *
 * ВАЖНОЕ СЛЕДСТВИЕ, которое надо знать: сайт статический и базы
 * не видит. Цена, проставленная в панели, немедленно действует
 * в боте и НЕ появляется на витрине, пока каталог не вернут в файл
 * и не выложат сайт. Панель поэтому умеет выгружать себя обратно
 * в текст `catalog.ts` — это и есть способ свести две стороны.
 *
 * Формы данных те же, что у сайта (`Product`, `Plan`), чтобы бот
 * и панель работали с одним типом, а не с двумя похожими.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import { getCatalog } from '../../../src/lib/catalog.js';
import type { Plan, Product } from '../../../src/lib/catalog.js';

export type StrokaProdukta = {
  id: string;
  imya: string;
  tagline: string;
  note: string;
  cena_kop: number | null;
  poryadok: number;
  skryt: number;
};

export type StrokaUrovnya = {
  id: string;
  produkt_id: string;
  short: string;
  title: string;
  cena_kop: number | null;
  poryadok: number;
  skryt: number;
};

/** Копейки → рубли каталога. Ноль здесь — настоящий ноль, а не «нет». */
const vRubli = (kop: number | null): number | null => (kop === null ? null : kop / 100);

/**
 * Засев из файла. Идёт ровно один раз — при пустых таблицах.
 *
 * Проверяется ПУСТОТА, а не отсутствие миграции: миграция создаёт
 * таблицы, а данные кладёт код (в SQL их не написать — они лежат
 * в TypeScript). Повторный запуск ничего не перетирает: правки
 * владельца дороже файла.
 */
export function zaseyat(db: Baza): void {
  const est = (db.prepare('SELECT COUNT(*) n FROM produkty').get() as { n: number }).n;
  if (est > 0) return;
  const seychas = seychasISO();
  const vstavitProdukt = db.prepare(
    `INSERT INTO produkty (id, imya, tagline, note, cena_kop, poryadok, skryt, izmenen)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  const vstavitUroven = db.prepare(
    `INSERT INTO urovni (id, produkt_id, short, title, cena_kop, poryadok, skryt, izmenen)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  db.transaction(() => {
    getCatalog().products.forEach((p, i) => {
      vstavitProdukt.run(
        p.id,
        p.name,
        p.tagline,
        p.note,
        p.priceRub === null ? null : Math.round(p.priceRub * 100),
        i,
        seychas,
      );
      p.plans.forEach((u, j) => {
        vstavitUroven.run(
          u.id,
          p.id,
          u.short,
          u.title,
          u.priceRub === null ? null : Math.round(u.priceRub * 100),
          j,
          seychas,
        );
      });
    });
  })();
}

/**
 * Каталог целиком.
 *
 * `sVsemi` — показать и спрятанное: панели это нужно, покупателю нет.
 * Спрятанный продукт не удаляется никогда: на него ссылаются прежние
 * заказы, и снятие строки сделало бы их безымянными.
 */
export function produkty(db: Baza, sVsemi = false): Product[] {
  const usloviye = sVsemi ? '' : 'WHERE skryt = 0';
  const stroki = db
    .prepare(`SELECT * FROM produkty ${usloviye} ORDER BY poryadok, id`)
    .all() as StrokaProdukta[];
  const vseUrovni = db
    .prepare(`SELECT * FROM urovni ${sVsemi ? '' : 'WHERE skryt = 0'} ORDER BY poryadok, id`)
    .all() as StrokaUrovnya[];
  return stroki.map((p) => ({
    id: p.id,
    name: p.imya,
    tagline: p.tagline,
    note: p.note,
    priceRub: vRubli(p.cena_kop),
    plans: vseUrovni
      .filter((u) => u.produkt_id === p.id)
      .map(
        (u): Plan => ({
          id: u.id,
          short: u.short,
          title: u.title,
          priceRub: vRubli(u.cena_kop),
        }),
      ),
  }));
}

export function produkt(db: Baza, id: string, sVsemi = false): Product | null {
  return produkty(db, sVsemi).find((p) => p.id === id) ?? null;
}

/** Уровень подписки вместе с его продуктом. */
export function uroven(db: Baza, id: string): { product: Product; plan: Plan } | null {
  for (const p of produkty(db, true)) {
    const plan = p.plans.find((u) => u.id === id);
    if (plan) return { product: p, plan };
  }
  return null;
}

// ── правки из панели ─────────────────────────────────────────────────

export type PravkaProdukta = {
  imya?: string;
  tagline?: string;
  note?: string;
  cenaKop?: number | null;
  skryt?: boolean;
};

export function sozdatProdukt(db: Baza, id: string, imya: string): void {
  const sled = (db.prepare('SELECT COALESCE(MAX(poryadok), -1) + 1 n FROM produkty').get() as { n: number }).n;
  db.prepare(
    `INSERT INTO produkty (id, imya, tagline, note, cena_kop, poryadok, skryt, izmenen)
     VALUES (?, ?, '', '', NULL, ?, 0, ?)`,
  ).run(id, imya, sled, seychasISO());
}

export function pravitProdukt(db: Baza, id: string, p: PravkaProdukta): void {
  const bylo = db.prepare('SELECT * FROM produkty WHERE id = ?').get(id) as StrokaProdukta | undefined;
  if (!bylo) return;
  db.prepare(
    `UPDATE produkty SET imya = ?, tagline = ?, note = ?, cena_kop = ?, skryt = ?, izmenen = ?
      WHERE id = ?`,
  ).run(
    p.imya ?? bylo.imya,
    p.tagline ?? bylo.tagline,
    p.note ?? bylo.note,
    p.cenaKop === undefined ? bylo.cena_kop : p.cenaKop,
    p.skryt === undefined ? bylo.skryt : p.skryt ? 1 : 0,
    seychasISO(),
    id,
  );
}

export function sozdatUroven(db: Baza, produktId: string, short: string): void {
  const p = db.prepare('SELECT * FROM produkty WHERE id = ?').get(produktId) as StrokaProdukta | undefined;
  if (!p) return;
  const sled = (
    db.prepare('SELECT COALESCE(MAX(poryadok), -1) + 1 n FROM urovni WHERE produkt_id = ?').get(produktId) as {
      n: number;
    }
  ).n;
  // Тот же вид идентификатора, что у засева: «продукт-уровень».
  // На нём держится разбор кнопок покупки — см. `vybor` в lib/katalog.
  const id = `${produktId}-${short.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
  db.prepare(
    `INSERT INTO urovni (id, produkt_id, short, title, cena_kop, poryadok, skryt, izmenen)
     VALUES (?, ?, ?, ?, NULL, ?, 0, ?)`,
  ).run(id, produktId, short, `${p.imya}, ${short}`, sled, seychasISO());
}

export type PravkaUrovnya = { short?: string; title?: string; cenaKop?: number | null; skryt?: boolean };

export function pravitUroven(db: Baza, id: string, p: PravkaUrovnya): void {
  const bylo = db.prepare('SELECT * FROM urovni WHERE id = ?').get(id) as StrokaUrovnya | undefined;
  if (!bylo) return;
  db.prepare(
    'UPDATE urovni SET short = ?, title = ?, cena_kop = ?, skryt = ?, izmenen = ? WHERE id = ?',
  ).run(
    p.short ?? bylo.short,
    p.title ?? bylo.title,
    p.cenaKop === undefined ? bylo.cena_kop : p.cenaKop,
    p.skryt === undefined ? bylo.skryt : p.skryt ? 1 : 0,
    seychasISO(),
    id,
  );
}
