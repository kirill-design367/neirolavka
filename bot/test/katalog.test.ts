import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tovary, tarif, kopeyki, rubli, rubliIli } from '../src/lib/katalog.js';
import { getCatalog } from '../../src/lib/catalog.js';

test('каталог бота — тот же объект, что у сайта', () => {
  // Если однажды кто-то скопирует прайс в бот, эта проверка упадёт.
  assert.equal(tovary(), getCatalog().products);
});

test('в лавке шесть товаров', () => {
  assert.deepEqual(
    tovary().map((t) => t.id),
    ['kling', 'suno', 'gemini', 'chatgpt', 'claude', 'seedance'],
  );
});

test('у Seedance уровней подписки нет вовсе, и дорисовывать их нельзя', () => {
  // Не «один уровень», а НИ ОДНОГО: подписка одна, и это свойство
  // продукта. Пустой список — то, по чему сайт и бот отличают такой
  // продукт от продукта с уровнями.
  const s = tovary().find((t) => t.id === 'seedance');
  assert.equal(s?.plans.length, 0);
});

test('цена в копейках — целое число, а её отсутствие — ноль', () => {
  for (const t of tovary()) {
    for (const p of t.plans) {
      const k = kopeyki(p);
      assert.equal(Number.isInteger(k), true, `${p.id}: ${k}`);
      assert.equal(k, p.priceRub === null ? 0 : p.priceRub * 100);
    }
  }
});

test('ноль показывается словом, а не как «0 ₽»', () => {
  // Ноль в копейках значит «цены ещё нет». Напечатанный как «0 ₽»,
  // он читался бы «бесплатно» — ровно та ловушка, из-за которой
  // на сайте убрали рубль-заглушку.
  assert.equal(rubliIli(0), 'уточняется');
  assert.equal(rubliIli(199000).replace(/\u00a0/g, ' '), '1 990 ₽');
});

test('уровень ищется по идентификатору вместе с товаром', () => {
  const n = tarif('kling-pro');
  assert.equal(n?.product.id, 'kling');
  assert.equal(n?.plan.short, 'Pro');
  assert.equal(tarif('nesushchestvuyushchiy'), null);
});

test('рубли печатаются без дробной части, когда её нет', () => {
  assert.equal(rubli(199000).replace(/ /g, ' '), '1 990 ₽');
  assert.equal(rubli(100), '1 ₽');
});
