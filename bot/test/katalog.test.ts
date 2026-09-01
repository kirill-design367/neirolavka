import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tovary, tarif, kopeyki, rubli } from '../src/lib/katalog.js';
import { getCatalog } from '../../src/lib/catalog.js';

test('каталог бота — тот же объект, что у сайта', () => {
  // Если однажды кто-то скопирует прайс в бот, эта проверка упадёт.
  assert.equal(tovary(), getCatalog().products);
});

test('в лавке три товара', () => {
  assert.deepEqual(
    tovary().map((t) => t.id),
    ['claude', 'chatgpt', 'seedance'],
  );
});

test('у Seedance годового тарифа нет, и дорисовывать его нельзя', () => {
  const s = tovary().find((t) => t.id === 'seedance');
  assert.equal(s?.plans.length, 1);
  assert.equal(s?.plans[0]?.months, 1);
});

test('цена в копейках — целое число', () => {
  for (const t of tovary()) {
    for (const p of t.plans) {
      const k = kopeyki(p);
      assert.equal(Number.isInteger(k), true, `${p.id}: ${k}`);
      assert.equal(k, p.priceRub * 100);
    }
  }
});

test('тариф ищется по идентификатору вместе с товаром', () => {
  const n = tarif('claude-pro-1m');
  assert.equal(n?.product.id, 'claude');
  assert.equal(n?.plan.months, 1);
  assert.equal(tarif('nesushchestvuyushchiy'), null);
});

test('рубли печатаются без дробной части, когда её нет', () => {
  assert.equal(rubli(199000).replace(/ /g, ' '), '1 990 ₽');
  assert.equal(rubli(100), '1 ₽');
});
