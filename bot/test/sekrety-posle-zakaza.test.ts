/**
 * «Сразу после выполнения заказа данные удалятся автоматически».
 *
 * Это не оборот речи, а обещание, которое бот даёт словами в просьбе
 * прислать пароль. Пока `zabytSekrety` не существовало, обещание было
 * бы ложью: логин, пароль и код двухфакторной аутентификации лежали
 * бы в базе вечно, а ключ к ним — в /etc на том же сервере.
 *
 * Проверяется ПАРА: текст обещания и то, что он правда исполняется.
 * Вычиткой такое не ловится — текст сам по себе исправен.
 *
 * Проверено на способность падать: со снятыми вызовами `zabytSekrety`
 * в `otmetitVydannym` и `otmenit` краснеют обе пробы.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zakazy from '../src/db/zakazy.js';
import * as svoi from '../src/db/svoi.js';
import * as kody from '../src/db/kody.js';
import { PROSIM_PAROL_AKKAUNTA } from '../src/lib/texty.js';
import { poslat } from './podstavnoy-telegram.js';
import { stend, SEKRET, POKUPATEL, VLADELEC, nazhatie, soobshchenie, ZHIVOY_PLAN } from './stend.js';

const POCHTA = 'ivan@mail.ru';
const PAROL = 'parol-ot-akkaunta-777';
const KOD = '424242';

/** Довести заказ до состояния «свой аккаунт, данные и код записаны». */
async function sDannymi(s: Awaited<ReturnType<typeof stend>>): Promise<zakazy.Zakaz> {
  await poslat(s.adres, SEKRET, nazhatie(`of:${ZHIVOY_PLAN}`));
  await poslat(s.adres, SEKRET, nazhatie(`svoy:${ZHIVOY_PLAN}`));
  await poslat(s.adres, SEKRET, soobshchenie(POCHTA));
  await poslat(s.adres, SEKRET, soobshchenie(PAROL));
  await poslat(s.adres, SEKRET, nazhatie('sv:da'));
  const z = zakazy.cheloveka(s.l.db, POKUPATEL)[0];
  assert.ok(z, 'заказ не создан');
  await poslat(s.adres, SEKRET, nazhatie(`aopl:${z!.id}`, VLADELEC));
  await poslat(s.adres, SEKRET, nazhatie(`avz:${z!.id}`, VLADELEC));
  await poslat(s.adres, SEKRET, nazhatie(`akodz:${z!.id}`, VLADELEC));
  await poslat(s.adres, SEKRET, soobshchenie(KOD));
  await poslat(s.adres, SEKRET, nazhatie('kd:da'));
  assert.equal(svoi.est(s.l.db, z!.id), true, 'данные аккаунта не записаны');
  assert.ok(kody.vzyat(s.l.db, z!.id, s.l.n.klyuchDostupov), 'код не записан');
  return zakazy.po(s.l.db, z!.id) as zakazy.Zakaz;
}

test('обещание «данные удалятся» стоит в тексте просьбы о пароле', () => {
  assert.ok(
    /удал/i.test(PROSIM_PAROL_AKKAUNTA),
    `в просьбе о пароле нет обещания удалить данные: ${PROSIM_PAROL_AKKAUNTA}`,
  );
});

test('выданный заказ не оставляет ни логина, ни пароля, ни кода', async () => {
  const s = await stend();
  try {
    const z = await sDannymi(s);
    assert.equal(zakazy.otmetitVydannym(s.l.db, z.id, null, VLADELEC), true, 'заказ не выдан');

    assert.equal(svoi.est(s.l.db, z.id), false, 'логин и пароль покупателя пережили выдачу');
    assert.equal(kody.vzyat(s.l.db, z.id, s.l.n.klyuchDostupov), null, 'код пережил выдачу');
    // Шифротекста тоже не осталось: стирается строка, а не значения.
    const syrye = JSON.stringify([
      ...s.l.db.prepare('SELECT * FROM svoi_akkaunty WHERE zakaz_id = ?').all(z.id),
      ...s.l.db.prepare('SELECT kod_sh FROM kody WHERE zakaz_id = ?').all(z.id),
    ]);
    assert.ok(!syrye.includes('v1.'), `шифротекст остался в базе: ${syrye}`);

    // А запросы кода остались: по ним видно, сколько раз его просили.
    const zaprosov = s.l.db.prepare('SELECT COUNT(*) AS n FROM kody WHERE zakaz_id = ?').get(z.id) as {
      n: number;
    };
    assert.ok(zaprosov.n > 0, 'история запросов кода стёрта вместе с самим кодом');
  } finally {
    await s.zakryt();
  }
});

test('отменённый заказ тоже не оставляет секретов', async () => {
  const s = await stend();
  try {
    const z = await sDannymi(s);
    const itog = zakazy.otmenit(s.l.db, z.id, VLADELEC, 'net_koda');
    assert.equal(itog.otmenen, true, 'заказ не отменён');

    assert.equal(svoi.est(s.l.db, z.id), false, 'логин и пароль покупателя пережили отмену');
    assert.equal(kody.vzyat(s.l.db, z.id, s.l.n.klyuchDostupov), null, 'код пережил отмену');
  } finally {
    await s.zakryt();
  }
});
