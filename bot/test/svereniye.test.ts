/**
 * Перепроверка введённого: «Всё верно?» и «Исправить».
 *
 * Главное, что здесь проверяется, — НЕ то, что кнопки нарисовались,
 * а то, ради чего они существуют:
 *   • до подтверждения не создаётся заказ и не записывается код;
 *   • пароль на экране не раскрыт;
 *   • «Исправить» правит ОДНО поле, а второе остаётся набранным —
 *     иначе человек, ошибшийся в пароле, набирал бы заново и почту;
 *   • кнопка из старого сообщения, нажатая позже, ничего не ломает.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zakazy from '../src/db/zakazy.js';
import * as dialogi from '../src/db/dialogi.js';
import * as svoi from '../src/db/svoi.js';
import { poslat } from './podstavnoy-telegram.js';
import { stend, SEKRET, POKUPATEL, VLADELEC, nazhatie, soobshchenie, ZHIVOY_PLAN } from './stend.js';

type Vyzov = { metod: string; telo: Record<string, unknown> };

const poslednee = (v: Vyzov[]): string => {
  const x = [...v].reverse().find((y) => y.metod === 'editMessageText' || y.metod === 'sendMessage');
  return String(x?.telo['text'] ?? '');
};
const komu = (v: Vyzov[], tgId: number): string[] =>
  v.filter((x) => x.metod === 'sendMessage' && x.telo['chat_id'] === tgId).map((x) => String(x.telo['text'] ?? ''));

const POCHTA = 'ivan@mail.ru';
const OPECHATKA = 'ivn@mail.ru';
const PAROL = 'parol-ot-akkaunta-777';

/** Довести до экрана сверки: выбор → свой аккаунт → почта → пароль. */
async function doSverki(s: Awaited<ReturnType<typeof stend>>, pochta = POCHTA, parol = PAROL): Promise<void> {
  await poslat(s.adres, SEKRET, nazhatie(`of:${ZHIVOY_PLAN}`));
  await poslat(s.adres, SEKRET, nazhatie(`svoy:${ZHIVOY_PLAN}`));
  await poslat(s.adres, SEKRET, soobshchenie(pochta));
  await poslat(s.adres, SEKRET, soobshchenie(parol));
}

test('«исправить почту»: пароль остаётся набранным, второй раз его не спрашивают', async () => {
  const s = await stend();
  try {
    await doSverki(s, OPECHATKA);
    assert.ok(poslednee(s.tg.vyzovy).includes(OPECHATKA), 'на сверке не та почта');

    await poslat(s.adres, SEKRET, nazhatie('sv:pr'));
    assert.ok(poslednee(s.tg.vyzovy).includes('исправить'), 'не спросили, что именно править');

    await poslat(s.adres, SEKRET, nazhatie('sv:po'));
    const prosba = poslednee(s.tg.vyzovy);
    assert.ok(prosba.includes('почты'), `просят не почту: ${prosba}`);

    // Пароль в черновике остался — значит спрашивать его незачем.
    const d = dialogi.vzyat(s.l.db, POKUPATEL, s.l.n.klyuchDostupov);
    assert.equal(d?.shag, 'zhdem_pochtu');
    assert.equal(d?.chernovik['parol'], PAROL, 'пароль потерян при исправлении почты');
    assert.equal(d?.chernovik['pochta'], undefined, 'старая почта не убрана');

    await poslat(s.adres, SEKRET, soobshchenie(POCHTA));
    const snova = poslednee(s.tg.vyzovy);
    assert.ok(snova.includes('Всё верно?'), `после правки не вернулись на сверку: ${snova}`);
    assert.ok(snova.includes(POCHTA), 'на сверке старая почта');
    assert.ok(!snova.includes(OPECHATKA), 'опечатка осталась');
    assert.ok(!snova.includes(PAROL), 'пароль показан открытым');

    await poslat(s.adres, SEKRET, nazhatie('sv:da'));
    const z = zakazy.cheloveka(s.l.db, POKUPATEL)[0];
    assert.ok(z, 'заказ не создан');
    assert.equal(svoi.est(s.l.db, z!.id), true);
    // И записалась ИСПРАВЛЕННАЯ почта, а не та, что была сначала.
    const dannye = svoi.vzyat(s.l.db, z!.id, s.l.n.klyuchDostupov);
    assert.equal(dannye?.pochta, POCHTA);
    assert.equal(dannye?.parol, PAROL);
  } finally {
    await s.zakryt();
  }
});

test('«исправить пароль»: почта остаётся набранной', async () => {
  const s = await stend();
  try {
    await doSverki(s, POCHTA, 'ne-tot-parol');
    await poslat(s.adres, SEKRET, nazhatie('sv:pr'));
    await poslat(s.adres, SEKRET, nazhatie('sv:pa'));
    assert.ok(poslednee(s.tg.vyzovy).includes('пароль'), 'просят не пароль');

    const d = dialogi.vzyat(s.l.db, POKUPATEL, s.l.n.klyuchDostupov);
    assert.equal(d?.shag, 'zhdem_parol_akkaunta');
    assert.equal(d?.chernovik['pochta'], POCHTA, 'почта потеряна при исправлении пароля');

    await poslat(s.adres, SEKRET, soobshchenie(PAROL));
    assert.ok(poslednee(s.tg.vyzovy).includes('Всё верно?'), 'не вернулись на сверку');

    await poslat(s.adres, SEKRET, nazhatie('sv:da'));
    const z = zakazy.cheloveka(s.l.db, POKUPATEL)[0]!;
    const dannye = svoi.vzyat(s.l.db, z.id, s.l.n.klyuchDostupov);
    assert.equal(dannye?.parol, PAROL, 'записан старый пароль');
  } finally {
    await s.zakryt();
  }
});

test('«назад» с выбора поля возвращает на сверку, ничего не потеряв', async () => {
  const s = await stend();
  try {
    await doSverki(s);
    await poslat(s.adres, SEKRET, nazhatie('sv:pr'));
    await poslat(s.adres, SEKRET, nazhatie('sv:naz'));
    const ekran = poslednee(s.tg.vyzovy);
    assert.ok(ekran.includes('Всё верно?'), 'не вернулись на сверку');
    assert.ok(ekran.includes(POCHTA));
    const d = dialogi.vzyat(s.l.db, POKUPATEL, s.l.n.klyuchDostupov);
    assert.equal(d?.shag, 'zhdem_svereniya');
    assert.equal(d?.chernovik['parol'], PAROL);
  } finally {
    await s.zakryt();
  }
});

test('текст вместо нажатия на сверке: подсказываем и не роняем разговор', async () => {
  const s = await stend();
  try {
    await doSverki(s);
    await poslat(s.adres, SEKRET, soobshchenie('ага'));
    assert.ok(poslednee(s.tg.vyzovy).includes('кнопки'), 'не подсказали, куда нажать');
    const d = dialogi.vzyat(s.l.db, POKUPATEL, s.l.n.klyuchDostupov);
    assert.equal(d?.shag, 'zhdem_svereniya', 'разговор потерян');
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 0);
  } finally {
    await s.zakryt();
  }
});

test('нажатие из старого сообщения, когда шага уже нет, ничего не создаёт', async () => {
  const s = await stend();
  try {
    await doSverki(s);
    await poslat(s.adres, SEKRET, nazhatie('sv:da'));
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 1);

    // Второе нажатие той же кнопки — разговора уже нет.
    await poslat(s.adres, SEKRET, nazhatie('sv:da'));
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 1, 'создан второй заказ');
    assert.ok(poslednee(s.tg.vyzovy).includes('позади'), 'не сказали, что шаг пройден');
  } finally {
    await s.zakryt();
  }
});

test('«исправить» по коду: помощнику уходит исправленный код, а не первый', async () => {
  const s = await stend();
  try {
    await doSverki(s);
    await poslat(s.adres, SEKRET, nazhatie('sv:da'));
    const z = zakazy.cheloveka(s.l.db, POKUPATEL)[0]!;
    await poslat(s.adres, SEKRET, nazhatie(`aopl:${z.id}`, VLADELEC));
    await poslat(s.adres, SEKRET, nazhatie(`avz:${z.id}`, VLADELEC));
    await poslat(s.adres, SEKRET, nazhatie(`akodz:${z.id}`, VLADELEC));

    await poslat(s.adres, SEKRET, soobshchenie('111111'));
    assert.ok(poslednee(s.tg.vyzovy).includes('111111'), 'код не показан на сверке');

    await poslat(s.adres, SEKRET, nazhatie('kd:pr'));
    assert.ok(poslednee(s.tg.vyzovy).includes('код'), 'не попросили код заново');
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'zhdem_kod');

    await poslat(s.adres, SEKRET, soobshchenie('222222'));
    await poslat(s.adres, SEKRET, nazhatie('kd:da'));
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'kod_poluchen');

    const komande = komu(s.tg.vyzovy, VLADELEC);
    assert.ok(komande.some((x) => x.includes('222222')), 'исправленный код не ушёл команде');
    assert.ok(!komande.some((x) => x.includes('111111')), 'команде ушёл ПЕРВЫЙ код');
  } finally {
    await s.zakryt();
  }
});

test('час на код истёк, пока человек смотрел на сверку: код в отменённый заказ не пишется', async () => {
  const s = await stend();
  try {
    await doSverki(s);
    await poslat(s.adres, SEKRET, nazhatie('sv:da'));
    const z = zakazy.cheloveka(s.l.db, POKUPATEL)[0]!;
    await poslat(s.adres, SEKRET, nazhatie(`aopl:${z.id}`, VLADELEC));
    await poslat(s.adres, SEKRET, nazhatie(`avz:${z.id}`, VLADELEC));
    await poslat(s.adres, SEKRET, nazhatie(`akodz:${z.id}`, VLADELEC));
    await poslat(s.adres, SEKRET, soobshchenie('333333'));

    // Заказ отменяется, пока сверка висит на экране.
    zakazy.otmenit(s.l.db, z.id, null, 'net_koda');
    await poslat(s.adres, SEKRET, nazhatie('kd:da'));

    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'otmenen', 'отменённый заказ ожил');
    assert.ok(
      !komu(s.tg.vyzovy, VLADELEC).some((x) => x.includes('333333')),
      'код ушёл команде по отменённому заказу',
    );
  } finally {
    await s.zakryt();
  }
});
