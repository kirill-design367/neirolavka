/**
 * Отзывы на сайте.
 *
 * Переехали в базу по той же причине, что и прайс: правит их живой
 * человек из панели, а править файл в репозитории из браузера нельзя.
 * `src/lib/catalog.ts` остаётся ЗАСЕВОМ — при первом запуске кусок
 * между метками «НАЧАЛО ОТЗЫВОВ ПАНЕЛИ» переносится сюда один раз,
 * и дальше правда здесь.
 *
 * ВАЖНОЕ СЛЕДСТВИЕ, то же, что у каталога: сайт статический и базы
 * не видит. Отзыв, поправленный в панели, попадёт на витрину только
 * после выкладки — той же самой кнопкой, что и цены.
 *
 * УДАЛЕНИЕ ЗДЕСЬ НАСТОЯЩЕЕ, и это не недосмотр. У продукта вместо
 * удаления есть «скрыть»: на него ссылаются заказы, и стереть строку
 * значило бы переписать их историю. У отзыва такой истории нет —
 * на него не ссылается ничто, — поэтому владелец, попросивший
 * «удалить», получает удаление, а не вечно спрятанную строку.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import { getCatalog } from '../../../src/lib/catalog.js';
import type { Review } from '../../../src/lib/catalog.js';

export type StrokaOtzyva = {
  id: string;
  avtor: string;
  tovar: string;
  text: string;
  poryadok: number;
  izmenen: string;
};

/**
 * Засев из файла. Идёт ровно один раз — при пустой таблице.
 *
 * Проверяется ПУСТОТА, а не отсутствие миграции: миграция создаёт
 * таблицу, а данные кладёт код — в SQL их не написать, они лежат
 * в TypeScript. Повторный запуск ничего не перетирает: правки
 * владельца дороже файла.
 */
export function zaseyat(db: Baza): void {
  const est = (db.prepare('SELECT COUNT(*) n FROM otzyvy').get() as { n: number }).n;
  if (est > 0) return;
  const seychas = seychasISO();
  const vstavit = db.prepare(
    'INSERT INTO otzyvy (id, avtor, tovar, text, poryadok, izmenen) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    getCatalog().reviews.forEach((o, i) => vstavit.run(o.id, o.author, o.bought, o.text, i, seychas));
  })();
}

/** Отзывы в том порядке, в каком они лягут на витрину. */
export function vse(db: Baza): Review[] {
  return (db.prepare('SELECT * FROM otzyvy ORDER BY poryadok, id').all() as StrokaOtzyva[]).map((o) => ({
    id: o.id,
    author: o.avtor,
    bought: o.tovar,
    text: o.text,
  }));
}

export function odin(db: Baza, id: string): StrokaOtzyva | null {
  return (db.prepare('SELECT * FROM otzyvy WHERE id = ?').get(id) as StrokaOtzyva | undefined) ?? null;
}

export type OtkazOtzyva = 'pusto' | 'zanyat';

/**
 * Завести отзыв.
 *
 * Идентификатор придумывается САМ и не спрашивается у человека:
 * владельцу лавки нечего знать про `r7`, а два отзыва с одинаковым
 * id развалили бы и ключ строки в React, и выкладку. Берётся первый
 * свободный `oN`, где N — следующий за наибольшим числом среди уже
 * заведённых: «первый свободный по счётчику» после удаления
 * последнего дал бы тот же id второй раз.
 */
export function zavesti(
  db: Baza,
  p: { avtor: string; tovar: string; text: string },
): { otzyv: StrokaOtzyva } | { oshibka: OtkazOtzyva } {
  const avtor = p.avtor.trim();
  const tovar = p.tovar.trim();
  const text = p.text.trim();
  if (!avtor || !text) return { oshibka: 'pusto' };

  const id = svobodnyyId(db);
  const sled = (db.prepare('SELECT COALESCE(MAX(poryadok), -1) + 1 n FROM otzyvy').get() as { n: number }).n;
  try {
    db.prepare(
      'INSERT INTO otzyvy (id, avtor, tovar, text, poryadok, izmenen) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, avtor, tovar, text, sled, seychasISO());
  } catch {
    return { oshibka: 'zanyat' };
  }
  return { otzyv: odin(db, id) as StrokaOtzyva };
}

function svobodnyyId(db: Baza): string {
  const est = new Set((db.prepare('SELECT id FROM otzyvy').all() as { id: string }[]).map((x) => x.id));
  for (let n = 1; ; n++) {
    const id = `o${n}`;
    if (!est.has(id)) return id;
  }
}

export function pravit(
  db: Baza,
  id: string,
  p: { avtor: string; tovar: string; text: string },
): { ok: true } | { oshibka: OtkazOtzyva } {
  const bylo = odin(db, id);
  if (!bylo) return { oshibka: 'pusto' };
  const avtor = p.avtor.trim();
  const text = p.text.trim();
  if (!avtor || !text) return { oshibka: 'pusto' };
  db.prepare('UPDATE otzyvy SET avtor = ?, tovar = ?, text = ?, izmenen = ? WHERE id = ?').run(
    avtor,
    p.tovar.trim(),
    text,
    seychasISO(),
    id,
  );
  return { ok: true };
}

export function udalit(db: Baza, id: string): boolean {
  return db.prepare('DELETE FROM otzyvy WHERE id = ?').run(id).changes > 0;
}

/**
 * Переставить отзыв на одно место вверх или вниз.
 *
 * МЕНЯЮТСЯ МЕСТАМИ ДВА СОСЕДА, а не пересчитывается весь ряд: так
 * правка задевает ровно те строки, которые переехали, и порядок
 * не «уплывает» от повторных нажатий. Соседом считается ближайший
 * по `poryadok` в нужную сторону — если номера разошлись (а они
 * разойдутся после удаления), это по-прежнему верно.
 *
 * Обмен идёт ОДНОЙ транзакцией: два раздельных UPDATE на секунду
 * оставляют двух соседей с одинаковым номером, и в этот момент
 * порядок решает уже `id`, то есть случайность.
 */
export function peredvinut(db: Baza, id: string, kuda: 'vverh' | 'vniz'): boolean {
  return db.transaction(() => {
    const svoy = odin(db, id);
    if (!svoy) return false;
    const sosed = db
      .prepare(
        kuda === 'vverh'
          ? 'SELECT * FROM otzyvy WHERE poryadok < ? ORDER BY poryadok DESC, id DESC LIMIT 1'
          : 'SELECT * FROM otzyvy WHERE poryadok > ? ORDER BY poryadok ASC, id ASC LIMIT 1',
      )
      .get(svoy.poryadok) as StrokaOtzyva | undefined;
    if (!sosed) return false;
    const seychas = seychasISO();
    const stavit = db.prepare('UPDATE otzyvy SET poryadok = ?, izmenen = ? WHERE id = ?');
    stavit.run(sosed.poryadok, seychas, svoy.id);
    stavit.run(svoy.poryadok, seychas, sosed.id);
    return true;
  })();
}
