/**
 * Описание бота: то, что человек видит ДО нажатия «Старт».
 *
 * Проверяется не «вызвали метод», а четыре разных утверждения:
 *   1. текст доезжает до Telegram и совпадает с тем, что в `texty.ts`;
 *   2. второй запуск НЕ пишет заново — иначе каждая выкладка тратила
 *      бы два запроса впустую, а «проверить, что встало» было бы
 *      нечем;
 *   3. смена часов работы описание переставляет: час выдачи стоит
 *      внутри текста, и без этого оно разошлось бы с настройками;
 *   4. описание перечитывается после записи, и расхождение
 *      объявляется неудачей, а не тихим успехом.
 *
 * Подставной Telegram здесь СО СВОЕЙ ПАМЯТЬЮ: он запоминает, что ему
 * записали, и отдаёт это обратно на `getMy…`. Без памяти проверка
 * «второй раз не пишем» доказывала бы свойство заглушки, а не бота.
 *
 * Плюс пределы Telegram: 512 и 120 знаков. Текст правят руками,
 * и переполнение вылезло бы на боевом сервере строкой «400 Bad
 * Request», по которой не видно, что именно длинно.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postavitOpisanie, PREDEL_OPISANIYA, PREDEL_KRATKOGO } from '../src/bot/opisanie.js';
import { opisanieBota, KRATKOE_OPISANIE } from '../src/lib/texty.js';
import { raspisanie } from '../src/db/nastroyki.js';
import * as nastroykiBd from '../src/db/nastroyki.js';
import { stend, VLADELEC } from './stend.js';
import type { Stend } from './stend.js';
import type { Otvet } from './podstavnoy-telegram.js';

/** Подставной Telegram, который помнит поставленное, как настоящий. */
function spamyatyu(s: Stend): () => { o: string; k: string } {
  let o = '';
  let k = '';
  s.tg.otvechat = (metod, telo): Otvet => {
    if (metod === 'setMyDescription') {
      o = String(telo.description ?? '');
      return { vid: 'ok' };
    }
    if (metod === 'setMyShortDescription') {
      k = String(telo.short_description ?? '');
      return { vid: 'ok' };
    }
    if (metod === 'getMyDescription') return { vid: 'ok', rezultat: { description: o } };
    if (metod === 'getMyShortDescription') return { vid: 'ok', rezultat: { short_description: k } };
    return { vid: 'ok' };
  };
  return () => ({ o, k });
}

const skolkoPisali = (s: Stend): number =>
  s.tg.vyzovy.filter((v) => v.metod === 'setMyDescription' || v.metod === 'setMyShortDescription')
    .length;

test('описание и короткое описание доезжают до Telegram дословно', async () => {
  const s = await stend();
  const chto = spamyatyu(s);
  try {
    const itog = await postavitOpisanie(s.l);
    assert.equal(itog.opisanie, 'поставлено');
    assert.equal(itog.kratkoe, 'поставлено');

    assert.equal(chto().o, opisanieBota(raspisanie(s.l.db, s.l.n)));
    assert.equal(chto().k, KRATKOE_OPISANIE);

    // Именно те методы, а не «что-нибудь похожее», и по одному разу.
    assert.equal(s.tg.vyzovy.filter((v) => v.metod === 'setMyDescription').length, 1);
    assert.equal(s.tg.vyzovy.filter((v) => v.metod === 'setMyShortDescription').length, 1);
  } finally {
    await s.zakryt();
  }
});

test('второй запуск ничего не пишет: описание уже стоит', async () => {
  const s = await stend();
  spamyatyu(s);
  try {
    await postavitOpisanie(s.l);
    const bylo = skolkoPisali(s);
    const itog = await postavitOpisanie(s.l);
    assert.equal(itog.opisanie, 'совпало');
    assert.equal(itog.kratkoe, 'совпало');
    assert.equal(skolkoPisali(s), bylo, 'второй запуск не должен писать ни разу');
  } finally {
    await s.zakryt();
  }
});

test('смена часов работы переставляет описание', async () => {
  const s = await stend();
  const chto = spamyatyu(s);
  try {
    await postavitOpisanie(s.l);
    const doPravki = chto().o;

    nastroykiBd.postavit(s.l.db, 'rabota_do', '19', VLADELEC);
    const itog = await postavitOpisanie(s.l);

    assert.equal(itog.opisanie, 'поставлено', 'после смены часов описание обязано переставиться');
    assert.notEqual(chto().o, doPravki);
    assert.equal(chto().o, opisanieBota(raspisanie(s.l.db, s.l.n)));
    // Короткое описание часов не содержит — переставлять его незачем.
    assert.equal(itog.kratkoe, 'совпало');
  } finally {
    await s.zakryt();
  }
});

test('Telegram отдал не то, что отправили, — это неудача, а не успех', async () => {
  const s = await stend();
  try {
    s.tg.otvechat = (metod): Otvet => {
      if (metod === 'getMyDescription') return { vid: 'ok', rezultat: { description: 'чужое' } };
      if (metod === 'getMyShortDescription')
        return { vid: 'ok', rezultat: { short_description: 'и это тоже' } };
      return { vid: 'ok' };
    };
    const itog = await postavitOpisanie(s.l);
    assert.equal(itog.opisanie, 'не вышло');
    assert.equal(itog.kratkoe, 'не вышло');
  } finally {
    await s.zakryt();
  }
});

test('отказ Telegram не роняет подъём', async () => {
  const s = await stend();
  try {
    s.tg.otvechat = (metod): Otvet =>
      metod.startsWith('setMy')
        ? { vid: 'oshibka', kod: 400, opisanie: 'Bad Request' }
        : { vid: 'ok', rezultat: { description: '', short_description: '' } };
    const itog = await postavitOpisanie(s.l);
    assert.equal(itog.opisanie, 'не вышло');
    assert.equal(itog.kratkoe, 'не вышло');
  } finally {
    await s.zakryt();
  }
});

test('тексты влезают в пределы Telegram', () => {
  const r = { poyas: 'Europe/Moscow', rabotaS: 8, rabotaDo: 22, obeshchanieMinut: 60 };
  const dlinnyy = opisanieBota(r);
  assert.ok(
    dlinnyy.length <= PREDEL_OPISANIYA,
    `описание ${dlinnyy.length} знаков при пределе ${PREDEL_OPISANIYA}`,
  );
  assert.ok(
    KRATKOE_OPISANIE.length <= PREDEL_KRATKOGO,
    `короткое ${KRATKOE_OPISANIE.length} знаков при пределе ${PREDEL_KRATKOGO}`,
  );
  // И не пустые: пустая строка у Telegram проходит и СТИРАЕТ описание.
  assert.ok(dlinnyy.length > 100);
  assert.ok(KRATKOE_OPISANIE.length > 20);
});
