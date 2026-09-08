/**
 * Путь покупки целиком, через настоящий вебхук-сервер.
 *
 * Главное здесь — продукт БЕЗ уровней подписки. У Claude Pro
 * и Seedance их нет вовсе, и до этой правки карточка такого продукта
 * была тупиком: кнопок уровня не рисовалось (уровней нет), а весь путь
 * оформления шёл через уровень. Человек видел «Выберите срок.»
 * и одну кнопку «← К списку» — купить было нечем.
 *
 * Идентификаторы берутся ИЗ КАТАЛОГА, а не вписаны строкой: вписанный
 * устаревает вместе с прайсом молча.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zakazy from '../src/db/zakazy.js';
import {
  stend,
  poslat,
  SEKRET,
  POKUPATEL,
  VLADELEC,
  nazhatie,
  PRODUKT_BEZ_UROVNEY,
  PRODUKT_S_UROVNYAMI,
} from './stend.js';

type Knopka = { text?: string; callback_data?: string; url?: string };

/** Кнопки последнего сообщения, которое бот показал человеку. */
function poslednieKnopki(vyzovy: { metod: string; telo: Record<string, unknown> }[]): Knopka[] {
  const posl = [...vyzovy]
    .reverse()
    .find((v) => v.metod === 'editMessageText' || v.metod === 'sendMessage');
  const razmetka = posl?.telo['reply_markup'] as { inline_keyboard?: Knopka[][] } | undefined;
  return (razmetka?.inline_keyboard ?? []).flat();
}

/** Текст последнего сообщения человеку. */
function posledniyTekst(vyzovy: { metod: string; telo: Record<string, unknown> }[]): string {
  const posl = [...vyzovy]
    .reverse()
    .find((v) => v.metod === 'editMessageText' || v.metod === 'sendMessage');
  return String(posl?.telo['text'] ?? '');
}

test('продукт без уровней покупается прямо с карточки', async () => {
  const s = await stend();
  try {
    const p = PRODUKT_BEZ_UROVNEY;

    const kartochka = await poslat(s.adres, SEKRET, nazhatie(`t:${p.id}`));
    assert.equal(kartochka.kod, 200);

    const knopki = poslednieKnopki(s.tg.vyzovy);
    const oformit = knopki.find((k) => k.callback_data === `of:${p.id}`);
    assert.ok(oformit, `нет кнопки оформления: ${JSON.stringify(knopki)}`);

    // Карточка сразу и есть подтверждение: видно, что берут и когда придёт.
    const tekst = posledniyTekst(s.tg.vyzovy);
    assert.ok(tekst.includes(p.name), `в тексте нет имени продукта: ${tekst}`);
    assert.ok(tekst.includes('Когда придёт'), `в тексте нет обещания: ${tekst}`);
    // И что за подписка: без этой строки человек видел бы голое название.
    assert.ok(tekst.includes(p.note), `в тексте нет описания подписки: ${tekst}`);
    // Цены ещё нет — и ноль наружу не выходит.
    assert.ok(!tekst.includes('0 ₽'), `ноль напечатан как цена: ${tekst}`);

    // «Оформить заказ» ведёт на развилку, а не создаёт заказ сразу:
    // сначала человек говорит, новый у него аккаунт или свой.
    const razvilka = await poslat(s.adres, SEKRET, nazhatie(`of:${p.id}`));
    assert.equal(razvilka.kod, 200);
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 0, 'на развилке заказа ещё нет');
    const puti = poslednieKnopki(s.tg.vyzovy).map((k) => k.callback_data);
    assert.ok(puti.includes(`nov:${p.id}`), `нет пути «новый аккаунт»: ${puti.join(', ')}`);
    assert.ok(puti.includes(`svoy:${p.id}`), `нет пути «свой аккаунт»: ${puti.join(', ')}`);

    const oformlenie = await poslat(s.adres, SEKRET, nazhatie(`nov:${p.id}`));
    assert.equal(oformlenie.kod, 200);

    const spisok = zakazy.cheloveka(s.l.db, POKUPATEL);
    assert.equal(spisok.length, 1, 'заказ создан');
    assert.equal(spisok[0]!.produkt_id, p.id);
    // У продукта без уровней в базу уезжает он сам: в чек уходит имя
    // продукта, а не выдуманный уровень.
    assert.equal(spisok[0]!.plan_id, p.id);
    assert.equal(spisok[0]!.nazvanie, p.name);
    assert.equal(spisok[0]!.vid_akkaunta, 'novy');
  } finally {
    await s.zakryt();
  }
});

test('у продукта с уровнями карточка по-прежнему предлагает выбрать уровень', async () => {
  const s = await stend();
  try {
    const p = PRODUKT_S_UROVNYAMI;
    await poslat(s.adres, SEKRET, nazhatie(`t:${p.id}`));

    const knopki = poslednieKnopki(s.tg.vyzovy);
    for (const uroven of p.plans) {
      assert.ok(
        knopki.some((k) => k.callback_data === `p:${uroven.id}`),
        `нет кнопки уровня ${uroven.id}: ${JSON.stringify(knopki)}`,
      );
    }
    // Оформить, не выбрав уровень, нельзя: такой кнопки на карточке нет.
    assert.equal(knopki.some((k) => (k.callback_data ?? '').startsWith('of:')), false);
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 0);
  } finally {
    await s.zakryt();
  }
});

test('оформить по идентификатору продукта С уровнями нельзя: уровень не назван', async () => {
  const s = await stend();
  try {
    const otvet = await poslat(s.adres, SEKRET, nazhatie(`nov:${PRODUKT_S_UROVNYAMI.id}`));
    assert.equal(otvet.kod, 200, 'Telegram обязан получить ответ');
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 0, 'заказа быть не должно');
  } finally {
    await s.zakryt();
  }
});

test('в статистике ноль не печатается как цена', async () => {
  const s = await stend();
  try {
    const p = PRODUKT_BEZ_UROVNEY;
    await poslat(s.adres, SEKRET, nazhatie(`nov:${p.id}`));
    const z = zakazy.cheloveka(s.l.db, POKUPATEL)[0]!;
    assert.equal(z.cena_kop, 0, 'цены в каталоге ещё нет — в базе ноль');
    zakazy.otmetitOplachennym(s.l.db, z.id, new Date(), VLADELEC);
    zakazy.vzyat(s.l.db, z.id, VLADELEC);
    zakazy.otmetitVydannym(s.l.db, z.id, null, VLADELEC);

    await poslat(s.adres, SEKRET, nazhatie('astat', VLADELEC));
    const tekst = posledniyTekst(s.tg.vyzovy);
    assert.ok(tekst.includes('Статистика'), `не та страница: ${tekst}`);
    assert.ok(!/\b0\s?₽/.test(tekst), `ноль напечатан как цена: ${tekst}`);
    assert.ok(tekst.includes('цена не объявлена'), `не сказано, что цены нет: ${tekst}`);
  } finally {
    await s.zakryt();
  }
});
