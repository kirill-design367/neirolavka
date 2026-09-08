/**
 * Кошелёк покупателя.
 *
 * Проверяется главное свойство: баланс — это сумма движений, и другого
 * способа его изменить, кроме записи движения, не существует.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otkrytBazu } from '../src/db/index.js';
import * as koshelek from '../src/db/koshelek.js';
import * as zakazy from '../src/db/zakazy.js';
import * as lyudi from '../src/db/lyudi.js';

const CHELOVEK = 42;

function baza() {
  const db = otkrytBazu(':memory:');
  lyudi.zapomnit(db, CHELOVEK, 'Покупатель', null);
  return db;
}

const OBRAZEC = {
  tgId: CHELOVEK,
  produktId: 'kling',
  planId: 'kling-pro',
  nazvanie: 'Kling AI, Pro',
  cenaKop: 199000,
  mesyacev: 0,
  vidAkkaunta: 'novy' as const,
};

test('пустой кошелёк — это ноль, а не отсутствие записи', () => {
  const db = baza();
  assert.equal(koshelek.balans(db, CHELOVEK), 0);
  assert.deepEqual(koshelek.dvizheniya(db, CHELOVEK), []);
});

test('баланс равен сумме движений', () => {
  const db = baza();
  koshelek.popolnit(db, CHELOVEK, 100_000, 'проба', 1);
  koshelek.popolnit(db, CHELOVEK, 50_000, 'проба', 1);
  assert.equal(koshelek.balans(db, CHELOVEK), 150_000);
  assert.equal(koshelek.dvizheniya(db, CHELOVEK).length, 2);
});

test('пополнение на ноль и на минус не проходит', () => {
  const db = baza();
  assert.throws(() => koshelek.popolnit(db, CHELOVEK, 0, 'проба', 1));
  assert.throws(() => koshelek.popolnit(db, CHELOVEK, -100, 'проба', 1));
  assert.equal(koshelek.balans(db, CHELOVEK), 0);
});

test('списывается СКОЛЬКО ЕСТЬ, и в минус баланс не уходит', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  koshelek.popolnit(db, CHELOVEK, 50_000, 'проба', 1);
  const spisano = koshelek.spisatSkolkoEst(db, CHELOVEK, 199_000, zakaz.id, 'заказ');
  assert.equal(spisano, 50_000);
  assert.equal(koshelek.balans(db, CHELOVEK), 0);
  // Второй раз брать нечего — и в минус не уходим.
  assert.equal(koshelek.spisatSkolkoEst(db, CHELOVEK, 199_000, zakaz.id, 'заказ'), 0);
  assert.equal(koshelek.balans(db, CHELOVEK), 0);
});

test('баланса хватило — заказ оплачен сразу и без администратора', () => {
  const db = baza();
  koshelek.popolnit(db, CHELOVEK, 300_000, 'проба', 1);
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  const itog = zakazy.oplatitSBalansa(db, zakaz.id, new Date());
  assert.equal(itog.spisano, 199_000);
  assert.equal(itog.hvatilo, true);
  const svezhy = zakazy.po(db, zakaz.id)!;
  assert.equal(svezhy.status, 'oplachen');
  assert.equal(svezhy.oplacheno_kop, 199_000);
  assert.equal(svezhy.s_balansa_kop, 199_000);
  assert.equal(koshelek.balans(db, CHELOVEK), 101_000);
});

test('баланса хватило частично — заказ ждёт оплаты, но деньги уже на нём', () => {
  const db = baza();
  koshelek.popolnit(db, CHELOVEK, 100_000, 'проба', 1);
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  const itog = zakazy.oplatitSBalansa(db, zakaz.id, new Date());
  assert.equal(itog.spisano, 100_000);
  assert.equal(itog.hvatilo, false);
  const svezhy = zakazy.po(db, zakaz.id)!;
  assert.equal(svezhy.status, 'zhdet_oplaty');
  assert.equal(svezhy.oplacheno_kop, 100_000);
  assert.equal(koshelek.balans(db, CHELOVEK), 0);
});

test('отмена возвращает на баланс ровно то, что заказ держал', () => {
  const db = baza();
  koshelek.popolnit(db, CHELOVEK, 300_000, 'проба', 1);
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  zakazy.oplatitSBalansa(db, zakaz.id, new Date());
  assert.equal(koshelek.balans(db, CHELOVEK), 101_000);

  const itog = zakazy.otmenit(db, zakaz.id, 1, 'ruchnaya');
  assert.equal(itog.otmenen, true);
  assert.equal(itog.vernuli, 199_000);
  assert.equal(koshelek.balans(db, CHELOVEK), 300_000, 'деньги вернулись целиком');

  // Держать заказу больше нечего: второй отмены не бывает,
  // и второго возврата тоже.
  assert.equal(zakazy.po(db, zakaz.id)!.oplacheno_kop, 0);
  assert.equal(zakazy.otmenit(db, zakaz.id, 1, 'ruchnaya').otmenen, false);
  assert.equal(koshelek.balans(db, CHELOVEK), 300_000);
});

test('возврат виден в выписке отдельным видом, а не «пополнением»', () => {
  const db = baza();
  koshelek.popolnit(db, CHELOVEK, 199_000, 'проба', 1);
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  zakazy.oplatitSBalansa(db, zakaz.id, new Date());
  zakazy.otmenit(db, zakaz.id, 1, 'net_koda');
  const vidy = koshelek.dvizheniya(db, CHELOVEK).map((d) => d.vid);
  assert.deepEqual(vidy, ['vozvrat', 'spisanie', 'popolnenie']);
});

test('отмена по неверному паролю не проходит, пока не отправлено письмо', () => {
  const db = baza();
  koshelek.popolnit(db, CHELOVEK, 199_000, 'проба', 1);
  const { zakaz } = zakazy.sozdatIliVernut(db, { ...OBRAZEC, vidAkkaunta: 'svoy' });
  zakazy.oplatitSBalansa(db, zakaz.id, new Date());
  zakazy.vzyat(db, zakaz.id, 1);

  const bez = zakazy.otmenit(db, zakaz.id, 1, 'nevernyy_parol');
  assert.equal(bez.otmenen, false);
  assert.equal(bez.pochemu, 'net_pisma');
  assert.equal(zakazy.po(db, zakaz.id)!.status, 'v_rabote', 'заказ на месте');
  assert.equal(koshelek.balans(db, CHELOVEK), 0, 'деньги не вернулись раньше времени');

  assert.equal(zakazy.otmetitPismo(db, zakaz.id, 1), true);
  const s = zakazy.otmenit(db, zakaz.id, 1, 'nevernyy_parol');
  assert.equal(s.otmenen, true);
  assert.equal(s.vernuli, 199_000);
  assert.equal(koshelek.balans(db, CHELOVEK), 199_000);
});

test('код спрашивают только у заказа со своим аккаунтом', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  zakazy.otmetitOplachennym(db, zakaz.id, new Date(), 1);
  zakazy.vzyat(db, zakaz.id, 1);
  assert.equal(zakazy.zaprositKod(db, zakaz.id, 1), false, 'у нового аккаунта кода не бывает');
  assert.equal(zakazy.po(db, zakaz.id)!.status, 'v_rabote');
});

test('возврат заказа в очередь снимает ожидание кода', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, { ...OBRAZEC, vidAkkaunta: 'svoy' });
  zakazy.otmetitOplachennym(db, zakaz.id, new Date(), 1);
  zakazy.vzyat(db, zakaz.id, 1);
  assert.equal(zakazy.zaprositKod(db, zakaz.id, 1), true);
  assert.equal(zakazy.po(db, zakaz.id)!.status, 'zhdem_kod');

  zakazy.vernutVOchered(db, zakaz.id, 1);
  const svezhy = zakazy.po(db, zakaz.id)!;
  assert.equal(svezhy.status, 'oplachen');
  // Час на ответ больше не идёт: иначе покупателя отменили бы за то,
  // что помощник ушёл.
  assert.equal(svezhy.kod_zapros_v, null);
  assert.equal(zakazy.prosrochennyeKody(db, new Date(Date.now() + 3 * 3600_000), 60).length, 0);
});
