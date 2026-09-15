/**
 * Служебная часть бота говорит ПО-АНГЛИЙСКИ, покупательская —
 * по-русски. Решение владельца, сентябрь 2026.
 *
 * Проверяется это не списком строк, а ТЕМ, ЧТО БОТ ОТВЕЧАЕТ. Список
 * устарел бы на первой же правке текста и молча перестал бы что-либо
 * стеречь; ответ бота устареть не может — он и есть то, что читает
 * человек.
 *
 * Чужие слова из ответа вычитаются ПОИМЁННО: имя покупателя приходит
 * из Telegram, название товара — из каталога, и к языку бота они
 * отношения не имеют. Вычитаются они явно и по одному, а не «всё, что
 * похоже на данные»: широкое правило вычло бы заодно и забытую
 * русскую строку, то есть превратило бы проверку в вечнозелёную.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zakazy from '../src/db/zakazy.js';
import * as lyudi from '../src/db/lyudi.js';
import { tarif } from '../src/lib/katalog.js';
import type { Stend } from './stend.js';
import { stend, poslat, nazhatie, soobshchenie, SEKRET, VLADELEC, POKUPATEL, ZHIVOY_PLAN } from './stend.js';

const KIRILLICA = /[Ѐ-ӿ]/;

/** Все тела, ушедшие в Telegram после метки, — текст и кнопки разом. */
function otvety(s: Stend, ot = 0): string {
  return s.tg.vyzovy
    .slice(ot)
    .filter((v) => v.metod === 'sendMessage' || v.metod === 'editMessageText')
    .map((v) => JSON.stringify(v.telo))
    .join('\n');
}

/** Убрать из текста чужие слова — имя человека и название товара. */
function bezChuzhih(text: string, ...chuzhie: string[]): string {
  let t = text;
  for (const c of chuzhie) if (c) t = t.split(c).join('');
  return t;
}

/** Оплаченный заказ со своим аккаунтом, чтобы карточка была полной. */
function zakaz(s: Stend): zakazy.Zakaz {
  lyudi.zapomnit(s.l.db, POKUPATEL, 'Pokupatel', null);
  const t = tarif(s.l.db, ZHIVOY_PLAN);
  assert.ok(t, 'уровень подписки из каталога');
  const { zakaz: z } = zakazy.sozdatIliVernut(s.l.db, {
    tgId: POKUPATEL,
    produktId: t!.product.id,
    planId: t!.plan.id,
    nazvanie: `${t!.product.name} · ${t!.plan.title}`,
    cenaKop: 100_000,
    mesyacev: 0,
    vidAkkaunta: 'svoy',
  });
  return z;
}

test('во всех служебных экранах бота нет ни одной русской буквы', async () => {
  const s = await stend();
  try {
    const z = zakaz(s);
    zakazy.otmetitOplachennym(s.l.db, z.id, new Date('2026-09-20T10:00:00Z'), VLADELEC);
    zakazy.vzyat(s.l.db, z.id, VLADELEC);
    /* Чужие слова: имя покупателя, имя самого владельца (он попадает
       в список людей и в состав команды) и название товара. Всё
       остальное — наши строки.

       Имена спрашиваются ЗАНОВО перед каждым разбором: бот записывает
       имя человека из каждого входящего обновления, и посчитанное
       один раз в начале устареет на первом же нажатии. */
    const chuzhie = () => [
      lyudi.podpis(lyudi.chelovek(s.l.db, POKUPATEL), POKUPATEL),
      lyudi.podpis(lyudi.chelovek(s.l.db, VLADELEC), VLADELEC),
      z.nazvanie,
    ];

    const ekrany: [string, () => Promise<unknown>][] = [
      ['служебное', () => poslat(s.adres, SEKRET, nazhatie('a', VLADELEC))],
      ['очередь', () => poslat(s.adres, SEKRET, nazhatie('aoch', VLADELEC))],
      ['мои в работе', () => poslat(s.adres, SEKRET, nazhatie('amoi', VLADELEC))],
      ['ждут оплаты', () => poslat(s.adres, SEKRET, nazhatie('aneopl', VLADELEC))],
      ['карточка заказа', () => poslat(s.adres, SEKRET, nazhatie(`az:${z.id}`, VLADELEC))],
      ['причины отмены', () => poslat(s.adres, SEKRET, nazhatie(`aotm:${z.id}`, VLADELEC))],
      ['ввод доступа', () => poslat(s.adres, SEKRET, nazhatie(`avv:${z.id}`, VLADELEC))],
      ['люди', () => poslat(s.adres, SEKRET, nazhatie('alyudi', VLADELEC))],
      ['пополнение', () => poslat(s.adres, SEKRET, nazhatie('abal', VLADELEC))],
      ['статистика', () => poslat(s.adres, SEKRET, nazhatie('astat', VLADELEC))],
      ['настройки', () => poslat(s.adres, SEKRET, nazhatie('anastr', VLADELEC))],
      ['часы работы', () => poslat(s.adres, SEKRET, nazhatie('achasy', VLADELEC))],
      ['команда', () => poslat(s.adres, SEKRET, nazhatie('akom', VLADELEC))],
      ['добавить помощника', () => poslat(s.adres, SEKRET, nazhatie('adobp', VLADELEC))],
    ];

    for (const [imyaEkrana, otkryt] of ekrany) {
      const bylo = s.tg.vyzovy.length;
      await otkryt();
      const text = bezChuzhih(otvety(s, bylo), ...chuzhie());
      assert.ok(text, `экран «${imyaEkrana}» не ответил вовсе`);
      const russkie = text.match(new RegExp(`[\\u0400-\\u04FF]+`, 'g'));
      assert.ok(!russkie, `на экране «${imyaEkrana}» осталось русское: ${russkie?.join(', ')}`);
    }
  } finally {
    await s.zakryt();
  }
});

test('уведомление команде о новом заказе — тоже по-английски', async () => {
  const s = await stend();
  try {
    const { soobshchitOZakaze } = await import('../src/bot/admin.js');
    const z = zakaz(s);
    const imya = lyudi.podpis(lyudi.chelovek(s.l.db, POKUPATEL), POKUPATEL);
    const bylo = s.tg.vyzovy.length;
    await soobshchitOZakaze(s.l, z);
    const text = bezChuzhih(otvety(s, bylo), imya, z.nazvanie);
    assert.ok(text.includes('New order'), `команде сказали не то: ${text}`);
    const russkie = text.match(/[Ѐ-ӿ]+/g);
    assert.ok(!russkie, `в уведомлении команде осталось русское: ${russkie?.join(', ')}`);
  } finally {
    await s.zakryt();
  }
});

/**
 * ОБРАТНАЯ СТОРОНА, и без неё первая проверка опасна: «перевести всё»
 * прошло бы её с блеском. Покупатель читает по-русски, и это ровно
 * то же требование владельца, только с другого конца.
 */
test('покупательские экраны остались русскими', async () => {
  const s = await stend();
  try {
    const bylo = s.tg.vyzovy.length;
    await poslat(s.adres, SEKRET, nazhatie('kup'));
    await poslat(s.adres, SEKRET, nazhatie('zak'));
    const text = otvety(s, bylo);
    assert.ok(KIRILLICA.test(text), `покупателю ответили не по-русски: ${text}`);
    assert.ok(text.includes('лавке'), `витрины покупателя нет: ${text}`);
  } finally {
    await s.zakryt();
  }
});

/**
 * ПРЕЖНЯЯ ПОДПИСЬ НИЖНЕЙ КНОПКИ ПРОДОЛЖАЕТ РАБОТАТЬ.
 *
 * Нижняя клавиатура живёт в клиенте Telegram, пока человек не нажмёт
 * «Старт»: у помощника, открывшего бота до выкладки, на экране
 * по-прежнему «Заказы лавки». Не принимай бот старую подпись — тот
 * нажал бы свою кнопку и получил «Не понял сообщение» ровно в ту
 * минуту, когда в очереди лежит заказ.
 */
test('старая подпись «Заказы лавки» по-прежнему открывает служебное', async () => {
  const s = await stend();
  try {
    for (const podpis of ['Shop orders', 'Заказы лавки']) {
      const bylo = s.tg.vyzovy.length;
      await poslat(s.adres, SEKRET, soobshchenie(podpis, VLADELEC));
      const text = otvety(s, bylo);
      assert.ok(text.includes('Shop desk'), `подпись «${podpis}» не открыла служебное: ${text}`);
    }
  } finally {
    await s.zakryt();
  }
});

/** А посторонний, набравший те же слова руками, служебного не видит. */
test('чужому служебное не открывается ни одной из подписей', async () => {
  const s = await stend();
  try {
    for (const podpis of ['Shop orders', 'Заказы лавки']) {
      const bylo = s.tg.vyzovy.length;
      await poslat(s.adres, SEKRET, soobshchenie(podpis, POKUPATEL));
      const text = otvety(s, bylo);
      assert.ok(!text.includes('Shop desk'), `посторонний увидел служебное по «${podpis}»: ${text}`);
    }
  } finally {
    await s.zakryt();
  }
});
