/**
 * Уровни подписки идут по возрастанию цены — и на витрине, и в боте.
 *
 * Проверяется НЕ «функция сортирует» (это видно и так), а три вещи,
 * каждая из которых ломается молча:
 *
 *   1. порядок одинаков у САЙТА и у БОТА. Они читают из разных мест —
 *      сайт из файла, бот из базы, — и разъехаться им проще простого:
 *      человек, выбравший уровень на витрине, ищет его в боте на том
 *      же месте;
 *   2. уровень БЕЗ ЦЕНЫ уходит в КОНЕЦ, а не в начало. В ряду по
 *      возрастанию место читается ценой, и «уточняется» сверху
 *      прочтётся как «дешевле всех» — та же неправда, что рубль
 *      вместо отсутствующей цены;
 *   3. появление цены ставит уровень на место САМО, без правок кода.
 *
 * Проверено на способность падать: обратный порядок, уровень без цены
 * в начале и рассинхрон сайта с ботом краснеют по отдельности.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCatalog, poCene } from '../src/lib/katalog.js';
import type { Plan } from '../src/lib/katalog.js';
import * as bdKatalog from '../src/db/katalog.js';
import { stend } from './stend.js';

/** Цены подряд; у уровня без цены — null. */
const ceny = (plans: Plan[]) => plans.map((p) => p.priceRub);

/** Ряд неубывающий, а все null — сплошным хвостом в конце. */
function poryadokVeren(spisok: (number | null)[]): boolean {
  const bezCeny = spisok.findIndex((c) => c === null);
  const est = bezCeny === -1 ? spisok : spisok.slice(0, bezCeny);
  const hvost = bezCeny === -1 ? [] : spisok.slice(bezCeny);
  if (hvost.some((c) => c !== null)) return false; // цена после «нет цены»
  return est.every((c, i) => i === 0 || (c as number) >= (est[i - 1] as number));
}

test('poCene: по возрастанию, без цены — в конец, порядок каталога при равных', () => {
  const p = (id: string, priceRub: number | null): Plan => ({ id, short: id, title: id, priceRub });

  assert.deepEqual(
    poCene([p('b', 300), p('a', 100), p('c', 200)]).map((x: Plan) => x.id),
    ['a', 'c', 'b'],
  );

  // Без цены — В КОНЕЦ. Это главное утверждение всей затеи.
  assert.deepEqual(
    poCene([p('net', null), p('deshevyy', 100), p('dorogoy', 900)]).map((x: Plan) => x.id),
    ['deshevyy', 'dorogoy', 'net'],
  );

  // Несколько без цены — между собой в порядке каталога.
  assert.deepEqual(
    poCene([p('n1', null), p('n2', null), p('est', 50)]).map((x: Plan) => x.id),
    ['est', 'n1', 'n2'],
  );

  // Равные цены — тоже в порядке каталога: сортировка устойчивая.
  assert.deepEqual(
    poCene([p('pervyy', 100), p('vtoroy', 100)]).map((x: Plan) => x.id),
    ['pervyy', 'vtoroy'],
  );

  // Исходный список не портится: в него смотрят и другие.
  const ishodnyy = [p('b', 2), p('a', 1)];
  poCene(ishodnyy);
  assert.deepEqual(ishodnyy.map((x) => x.id), ['b', 'a'], 'poCene поменял переданный список');
});

test('на витрине уровни каждого продукта идут по возрастанию цены', () => {
  const tovarov = getCatalog().products.filter((p) => p.plans.length > 0);
  assert.ok(tovarov.length > 0, 'в каталоге не осталось продуктов с уровнями — проверять нечего');
  for (const t of tovarov) {
    assert.ok(
      poryadokVeren(ceny(t.plans)),
      `${t.id}: порядок не по возрастанию — ${JSON.stringify(ceny(t.plans))}`,
    );
  }
});

test('в боте тот же порядок, что на витрине — даже когда в базе он другой', async () => {
  const s = await stend();
  try {
    /* ХРАНИМЫЙ ПОРЯДОК СНАЧАЛА ЛОМАЕТСЯ, и без этого проверка
       не проверяет ничего. Засев идёт из файла, файл уже отсортирован
       по цене — значит и `poryadok` в базе совпадает с ценовым,
       и бот, ВОВСЕ не сортирующий, вернул бы тот же ряд. Проверено:
       с убранной сортировкой у бота проверка оставалась зелёной.
       Переворачиваем `poryadok` — теперь совпадение возможно только
       если бот сортирует сам. */
    s.l.db.prepare('UPDATE urovni SET poryadok = -poryadok').run();

    const sayt = getCatalog().products;
    const bot = bdKatalog.produkty(s.l.db, true);
    for (const t of sayt) {
      const tot = bot.find((b) => b.id === t.id);
      if (!tot) continue; // продукт мог быть спрятан — это не про порядок
      assert.deepEqual(
        tot.plans.map((p) => p.id),
        t.plans.map((p) => p.id),
        `${t.id}: у бота и витрины разный порядок уровней`,
      );
    }
  } finally {
    await s.zakryt();
  }
});

test('уровень без цены стоит в конце, а с появлением цены встаёт на место', async () => {
  const s = await stend();
  try {
    const tovar = bdKatalog.produkty(s.l.db, true).find((p) => p.plans.length >= 2);
    assert.ok(tovar, 'нужен продукт хотя бы с двумя уровнями');

    // Снимаем цену у САМОГО ДЕШЁВОГО — значит он обязан уехать в конец.
    const deshevyy = tovar!.plans[0]!;
    bdKatalog.pravitUroven(s.l.db, deshevyy.id, { cenaKop: null });
    const bezCeny = bdKatalog.produkt(s.l.db, tovar!.id, true)!.plans;
    assert.equal(
      bezCeny[bezCeny.length - 1]!.id,
      deshevyy.id,
      'уровень без цены не ушёл в конец — а место в ряду читается ценой',
    );
    assert.ok(poryadokVeren(ceny(bezCeny)), JSON.stringify(ceny(bezCeny)));

    // Ставим цену дороже всех — уровень обязан встать последним
    // по цене, и сделать это САМ, без единой правки кода.
    const samyyDorogoy = Math.max(...bezCeny.map((p) => p.priceRub ?? 0));
    bdKatalog.pravitUroven(s.l.db, deshevyy.id, { cenaKop: (samyyDorogoy + 100) * 100 });
    const sCenoy = bdKatalog.produkt(s.l.db, tovar!.id, true)!.plans;
    assert.equal(sCenoy[sCenoy.length - 1]!.id, deshevyy.id, 'самый дорогой уровень не стал последним');
    assert.ok(poryadokVeren(ceny(sCenoy)), JSON.stringify(ceny(sCenoy)));

    // И обратно: цена ниже всех — уровень первый.
    bdKatalog.pravitUroven(s.l.db, deshevyy.id, { cenaKop: 100 });
    const snova = bdKatalog.produkt(s.l.db, tovar!.id, true)!.plans;
    assert.equal(snova[0]!.id, deshevyy.id, 'самый дешёвый уровень не стал первым');
  } finally {
    await s.zakryt();
  }
});
