/**
 * ЗАПИСЬ ОТКЛОНЁННЫХ УВЕДОМЛЕНИЙ.
 *
 * Уведомление об оплате приходит от чужого сервера ОДИН раз, и
 * подпись у него считана паролем, которого мы придумать не можем.
 * Не записали — разбирать нечего: повторить его руками нельзя,
 * а Робокасса второй раз не пришлёт.
 *
 * Проверяется здесь ровно то, из-за чего запись вообще заведена:
 * что она есть, что ежеминутный повтор не вытесняет предыдущую беду
 * и что персональные данные плательщика в базу не попадают.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { stend } from './stend.js';
import * as otkazy from '../src/db/otkazy.js';
import { prinyatUvedomlenie } from '../src/oplata/schet.js';

const OKRUZHENIE = {
  NEIROLAVKA_ROBOKASSA_LOGIN: 'Neirolavka',
  NEIROLAVKA_ROBOKASSA_PAROL1: 'boevoy-parol-odin',
  NEIROLAVKA_ROBOKASSA_PAROL2: 'boevoy-parol-dva',
  NEIROLAVKA_ROBOKASSA_TEST: '0',
};

test('отклонённое уведомление ЗАПИСЫВАЕТСЯ — иначе разбирать нечего', async () => {
  const s = await stend(OKRUZHENIE);
  try {
    const itog = await prinyatUvedomlenie(s.l, {
      OutSum: '1259.10',
      InvId: '17',
      SignatureValue: 'f'.repeat(32),
    });
    assert.equal(itog.kod, 403, 'непринятое уведомление не имеет права отвечать «принято»');

    const o = otkazy.posledniy(s.l.db);
    assert.ok(o, 'ОТКАЗ НЕ ЗАПИСАН: разбирать беду будет нечем');
    assert.equal(o.pochemu, 'podpis_ne_soshlas');
    assert.equal(o.pary['InvId'], '17');
    assert.equal(o.pary['OutSum'], '1259.10');
    assert.equal(o.povtorov, 1);
  } finally {
    await s.zakryt();
  }
});

test('ежеминутный повтор склеивается в счётчик, а не вытесняет прошлую беду', async () => {
  const s = await stend(OKRUZHENIE);
  try {
    // Сначала ДРУГАЯ беда — её и нельзя потерять.
    await prinyatUvedomlenie(s.l, { InvId: '1' });
    // Потом Робокасса двадцать пять раз повторяет одно и то же.
    for (let i = 0; i < 25; i += 1) {
      await prinyatUvedomlenie(s.l, { OutSum: '10.00', InvId: '2', SignatureValue: 'a'.repeat(32) });
    }
    const vse = otkazy.svezhie(s.l.db);
    assert.equal(vse.length, 2, `повторы не склеились: строк ${vse.length}`);
    const povtor = vse.find((x) => x.pary['InvId'] === '2');
    assert.equal(povtor?.povtorov, 25);
    assert.ok(
      vse.some((x) => x.pochemu === 'net_poley'),
      'ПЕРВАЯ беда вытеснена повторами второй — а смотреть надо было на неё',
    );
  } finally {
    await s.zakryt();
  }
});

test('в базу не попадает почта плательщика — только имя поля', async () => {
  const s = await stend(OKRUZHENIE);
  try {
    await prinyatUvedomlenie(s.l, {
      OutSum: '10.00',
      InvId: '3',
      SignatureValue: 'b'.repeat(32),
      EMail: 'pokupatel@example.com',
    });
    const o = otkazy.posledniy(s.l.db);
    assert.ok(o);
    assert.ok(
      !JSON.stringify(o.pary).includes('pokupatel@example.com'),
      'ПОЧТА ПЛАТЕЛЬЩИКА ЛЕГЛА В БАЗУ — персональных данных лавка не собирает',
    );
    assert.ok(o.imena.includes('EMail'), 'имя поля знать надо');

    // И по всей таблице целиком: значение не должно лежать нигде.
    const syroe = s.l.db.prepare('SELECT pary, imena FROM otkazy_uvedomleniy').all();
    assert.ok(!JSON.stringify(syroe).includes('pokupatel@example.com'));
  } finally {
    await s.zakryt();
  }
});

test('в базе нет НИЧЕГО, посчитанного из пароля', async () => {
  const s = await stend(OKRUZHENIE);
  try {
    await prinyatUvedomlenie(s.l, { OutSum: '10.00', InvId: '4', SignatureValue: 'c'.repeat(32) });
    const syroe = JSON.stringify(s.l.db.prepare('SELECT * FROM otkazy_uvedomleniy').all());
    /* Ожидаемая подпись — это хеш строки с паролем. База лежит
       с правами 700, пароли — в /etc под root с правами 600; переносить
       производное от них в место послабее нельзя. Проба считает
       ожидаемую подпись сама, в своём процессе. */
    const zhdali = createHash('md5').update('10.00:4:boevoy-parol-dva', 'utf8').digest('hex');
    assert.ok(!syroe.includes(zhdali), 'ОЖИДАЕМАЯ ПОДПИСЬ ЛЕЖИТ В БАЗЕ — она посчитана из пароля');
    assert.ok(!syroe.includes('boevoy-parol-dva'), 'пароль в базе');
  } finally {
    await s.zakryt();
  }
});

test('принятое уведомление отказов не пишет', async () => {
  const s = await stend(OKRUZHENIE);
  try {
    // Подпись верная, но счёта такого нет: отказ по счёту — не по подписи,
    // и в таблицу отказов подписи он попадать не должен.
    const podpis = createHash('md5').update('10.00:999:boevoy-parol-dva', 'utf8').digest('hex');
    const itog = await prinyatUvedomlenie(s.l, {
      OutSum: '10.00',
      InvId: '999',
      SignatureValue: podpis,
    });
    assert.equal(itog.chto, 'net_scheta', 'подпись обязана была сойтись');
    assert.equal(otkazy.posledniy(s.l.db), null, 'записан отказ там, где подпись сошлась');
  } finally {
    await s.zakryt();
  }
});
