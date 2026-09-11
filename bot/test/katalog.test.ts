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

test('продукт без уровней в каталоге есть, и уровней у него НИ ОДНОГО', () => {
  // Не «один уровень», а НИ ОДНОГО: подписка одна, и это свойство
  // продукта. Пустой список — то, по чему сайт и бот отличают такой
  // продукт от продукта с уровнями.
  //
  // ИМЯ ПРОДУКТА СЮДА НЕ ВПИСЫВАЕТСЯ. Здесь стояло «у Seedance
  // уровней нет», и в день, когда владелец завёл Seedance два
  // уровня, проверка покраснела — притом что каталог был исправен,
  // а путь покупки без уровней жив и работает на Claude Pro.
  // Проверка падала не по той причине, ради которой написана.
  // Тот же закон, что у ZHIVOY_PLAN: живой продукт берут из каталога.
  const bez = tovary(baza()).filter((t) => t.plans.length === 0);
  assert.ok(
    bez.length > 0,
    'в каталоге не осталось ни одного продукта без уровней — путь покупки с карточки больше нечем проверить',
  );
  for (const t of bez) assert.equal(t.plans.length, 0, `${t.id}: уровни дорисовались`);
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
