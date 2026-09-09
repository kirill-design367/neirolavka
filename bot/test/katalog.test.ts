import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tovary, tarif, kopeyki, rubli, rubliIli } from '../src/lib/katalog.js';
import { getCatalog } from '../../src/lib/catalog.js';
import { otkrytBazu } from '../src/db/index.js';

/** Свежая база: каталог в ней уже засеян из файла сайта. */
const baza = () => otkrytBazu(':memory:');

test('каталог бота засевается из файла сайта слово в слово', () => {
  // Прайс живёт в базе — его правит панель, — но начинается он файлом
  // сайта. Если однажды кто-то СКОПИРУЕТ прайс в бот вместо засева,
  // эта проверка упадёт.
  const db = baza();
  const iz = getCatalog().products;
  const stalo = tovary(db);
  assert.deepEqual(
    stalo.map((p) => p.id),
    iz.map((p) => p.id),
  );
  assert.deepEqual(
    stalo.map((p) => p.plans.map((u) => u.id)),
    iz.map((p) => p.plans.map((u) => u.id)),
  );
  assert.deepEqual(
    stalo.map((p) => p.name),
    iz.map((p) => p.name),
  );
});

test('в лавке шесть товаров', () => {
  assert.deepEqual(
    tovary(baza()).map((t) => t.id),
    ['kling', 'suno', 'gemini', 'chatgpt', 'claude', 'seedance'],
  );
});

test('у Seedance уровней подписки нет вовсе, и дорисовывать их нельзя', () => {
  // Не «один уровень», а НИ ОДНОГО: подписка одна, и это свойство
  // продукта. Пустой список — то, по чему сайт и бот отличают такой
  // продукт от продукта с уровнями.
  const s = tovary(baza()).find((t) => t.id === 'seedance');
  assert.equal(s?.plans.length, 0);
});

test('цена в копейках — целое число, а её отсутствие — ноль', () => {
  for (const t of tovary(baza())) {
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
  const n = tarif(baza(), 'kling-pro');
  assert.equal(n?.product.id, 'kling');
  assert.equal(n?.plan.short, 'Pro');
  assert.equal(tarif(baza(), 'nesushchestvuyushchiy'), null);
});

test('рубли печатаются без дробной части, когда её нет', () => {
  assert.equal(rubli(199000).replace(/ /g, ' '), '1 990 ₽');
  assert.equal(rubli(100), '1 ₽');
});
