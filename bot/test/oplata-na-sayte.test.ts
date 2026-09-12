/**
 * ОПЛАТА НА САЙТЕ: заказ без хозяина.
 *
 * Здесь проверяется то, чего до сих пор в лавке не существовало:
 * заказ, у которого ЕСТЬ ДЕНЬГИ и НЕТ ПОКУПАТЕЛЯ. Человек платит
 * на сайте, не открывая Telegram, и связать оплату с ним можно
 * ровно одним способом — ссылкой с секретом.
 *
 * Ломается это тихо и дорого, поэтому проверок много и все они
 * про деньги:
 *
 *   1. ДВОЙНОЕ НАЖАТИЕ. Два заказа и две сожжённые активации
 *      промокода вместо одной — и обе беды видит только владелец,
 *      и только когда кто-то пожалуется, что код кончился раньше
 *      времени.
 *   2. ОДНА ССЫЛКА У ДВОИХ. Ссылку пересылают; забрать чужой
 *      оплаченный заказ нельзя даже случайно.
 *   3. ОТМЕНА НИЧЕЙНОГО. Возврат идёт на баланс, а баланса у такого
 *      заказа нет: отмена вернула бы настоящие деньги в никуда.
 *   4. БАЛАНС НА САЙТЕ. Его там нет и быть не может — входа нет,
 *      и чьи это деньги, неизвестно.
 *
 * Всё идёт по НАСТОЯЩЕМУ коду: заказ заводится тем же `zakazSSayta`,
 * что стоит за `/api/zakaz`, уведомление приходит в тот же
 * `prinyatUvedomlenie`, заказ забирается тем же `zabrat`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { stend, poslat, SEKRET, POKUPATEL, ZHIVOY_PLAN, PRODUKT_BEZ_UROVNEY } from './stend.js';
import type { Stend } from './stend.js';
import * as zakazy from '../src/db/zakazy.js';
import * as promokody from '../src/db/promokody.js';
import * as lyudi from '../src/db/lyudi.js';
import * as koshelek from '../src/db/koshelek.js';
import * as metki from '../src/db/metki.js';
import { zakazSSayta, ssylkaVBot } from '../src/oplata/zakaz-s-sayta.js';
import { prinyatUvedomlenie } from '../src/oplata/schet.js';
import { rubliStrokoy } from '../src/oplata/robokassa.js';
import { sleduyushchiyShag } from '../src/admin/stranicy.js';

const LOGIN = 'Neirolavka';
const PAROL1 = 'parol-odin';
const PAROL2 = 'parol-dva';

const OKRUZHENIE = {
  NEIROLAVKA_ROBOKASSA_LOGIN: LOGIN,
  NEIROLAVKA_ROBOKASSA_PAROL1: PAROL1,
  NEIROLAVKA_ROBOKASSA_PAROL2: PAROL2,
  NEIROLAVKA_ROBOKASSA_TEST: '0',
};

/** Второй покупатель: нужен там, где проверяется «чужая ссылка». */
const DRUGOY = 4242;

async function lavka(): Promise<Stend> {
  const s = await stend(OKRUZHENIE);
  lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
  lyudi.zapomnit(s.l.db, DRUGOY, 'Другой', null);
  return s;
}

let nomerPopytki = 0;
const popytka = () => `p-${++nomerPopytki}-${Date.now()}`;

/**
 * Завести промокод — и УБЕДИТЬСЯ, что он завёлся.
 *
 * Первая редакция звала `zavesti` и не смотрела на ответ. Срок был
 * пуст, код не создавался вовсе, и три проверки про скидку проходили
 * НИ НА ЧЁМ: «скидка не применилась» — верно, её и не могло быть.
 * Проверка, молча работающая с несуществующими данными, опаснее
 * упавшей.
 */
function zavestiKod(s: Stend, kod = 'LETO25', skidkaProc = 10, aktivaciy = 5): void {
  const god = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const itog = promokody.zavesti(s.l.db, { kod, skidkaProc, aktivaciy, doDaty: god }, 0);
  assert.ok('promokod' in itog, `промокод не завёлся: ${JSON.stringify(itog)}`);
}

/** Цена живого уровня: проверки не выдумывают прайс, а берут его. */
function cenaZhivogo(s: Stend): number {
  const z = zakazy.po(s.l.db, 0);
  void z;
  const t = s.l.db
    .prepare('SELECT cena_kop FROM urovni WHERE id = ?')
    .get(ZHIVOY_PLAN) as { cena_kop: number } | undefined;
  return t?.cena_kop ?? 0;
}

/** Уведомление Робокассы с ВЕРНОЙ подписью — паролем № 2. */
function uvedomlenie(nomer: number, summaKop: number): Record<string, string> {
  const outSum = rubliStrokoy(summaKop);
  return {
    OutSum: outSum,
    InvId: String(nomer),
    SignatureValue: createHash('md5').update(`${outSum}:${nomer}:${PAROL2}`, 'utf8').digest('hex'),
  };
}

/** Номер счёта, выставленного по заказу. */
function schetZakaza(s: Stend, zakazId: number): number {
  const p = s.l.db
    .prepare("SELECT id FROM platezhi WHERE zakaz_id = ? ORDER BY id DESC LIMIT 1")
    .get(zakazId) as { id: number } | undefined;
  assert.ok(p, 'счёт по заказу не выставился');
  return p.id;
}

/* ── заказ заводится ничейным ──────────────────────────────────── */

test('заказ с сайта: без хозяина, с ключом, вид аккаунта не выбран', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, {
      tovar: ZHIVOY_PLAN,
      oplata: 'sbp',
      promo: '',
      metka: 'vk-posty',
      popytka: popytka(),
    });
    assert.ok(itog.vyshlo, 'заказ с сайта не завёлся');
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    assert.equal(z.tg_id, null, 'у заказа с сайта не должно быть хозяина');
    assert.equal(z.istochnik, 'sayt');
    assert.equal(z.vid_akkaunta, 'ne_vybran', 'на сайте про аккаунт не спрашивают');
    assert.equal(z.status, 'zhdet_oplaty');
    assert.equal(z.metka, 'vk-posty', 'метка обязана доехать до заказа');
    assert.ok(z.klyuch && z.klyuch.length >= 24, 'ключ должен быть длинным секретом');
    assert.ok(itog.adres.startsWith('https://auth.robokassa.ru/'), 'адрес оплаты не Робокассы');
    assert.ok(itog.vBot.includes(`zakaz_${z.klyuch}`), 'ссылка в бот обязана нести ключ');
  } finally {
    await s.zakryt();
  }
});

test('продукт БЕЗ уровней покупается с сайта так же', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, {
      tovar: PRODUKT_BEZ_UROVNEY.id,
      oplata: 'card',
      promo: '',
      metka: '',
      popytka: popytka(),
    });
    // Цена у такого продукта может быть не объявлена — тогда отказ
    // ЧЕСТНЫЙ и с объяснением, а не «что-то пошло не так».
    if (!itog.vyshlo) {
      assert.equal(itog.pochemu, 'net_ceny');
      assert.ok(itog.soobshchenie.includes('цена'), 'отказ обязан назвать причину словами');
      return;
    }
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    assert.equal(z.plan_id, PRODUKT_BEZ_UROVNEY.id);
    assert.equal(z.tg_id, null);
  } finally {
    await s.zakryt();
  }
});

test('несуществующий товар — отказ словами, а не заказ', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, {
      tovar: 'takogo-net',
      oplata: 'card',
      promo: '',
      metka: '',
      popytka: popytka(),
    });
    assert.equal(itog.vyshlo, false);
    if (!itog.vyshlo) assert.equal(itog.pochemu, 'net_tovara');
    assert.equal(zakazy.nichi(s.l.db).length, 0, 'заказ не должен был завестись');
  } finally {
    await s.zakryt();
  }
});

/* ── двойное нажатие ───────────────────────────────────────────── */

test('ДВА НАЖАТИЯ С ОДНИМ КЛЮЧОМ — ОДИН заказ и ОДНА активация промокода', async () => {
  const s = await lavka();
  try {
    zavestiKod(s);
    const p = popytka();
    const zapros = {
      tovar: ZHIVOY_PLAN,
      oplata: 'card',
      promo: 'LETO25',
      metka: '',
      popytka: p,
    };
    const a = await zakazSSayta(s.l, zapros);
    const b = await zakazSSayta(s.l, zapros);
    assert.ok(a.vyshlo && b.vyshlo);
    assert.equal(a.nomer, b.nomer, 'второе нажатие завело второй заказ');
    assert.equal(zakazy.nichi(s.l.db).length, 1, 'ничейных заказов должно быть ровно один');
    assert.equal(promokody.zanyato(s.l.db, 'LETO25'), 1, 'активация потрачена дважды');
  } finally {
    await s.zakryt();
  }
});

test('разные нажатия — разные заказы, и уникальный индекс не мешает', async () => {
  const s = await lavka();
  try {
    // Тот же уровень, два разных человека на сайте. У заказов из бота
    // второй такой же не оформился бы — там хозяин один и тот же;
    // здесь хозяев нет вовсе, и это ДВА разных покупателя.
    const a = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    const b = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(a.vyshlo && b.vyshlo, 'второй покупатель не смог оформить тот же уровень');
    assert.notEqual(a.nomer, b.nomer);
    assert.equal(zakazy.nichi(s.l.db).length, 2);
  } finally {
    await s.zakryt();
  }
});

/* ── промокод до оплаты ────────────────────────────────────────── */

test('промокод применяется ДО оплаты: в Робокассу уходит сумма со скидкой', async () => {
  const s = await lavka();
  try {
    zavestiKod(s);
    const itog = await zakazSSayta(s.l, {
      tovar: ZHIVOY_PLAN,
      oplata: 'card',
      promo: 'leto25',
      metka: '',
      popytka: popytka(),
    });
    assert.ok(itog.vyshlo);
    const cena = cenaZhivogo(s);
    assert.equal(itog.cenaKop, cena, 'цена тарифа обязана остаться исходной');
    assert.ok(itog.skidkaKop > 0, 'скидка не применилась');
    assert.equal(itog.kOplateKop, cena - itog.skidkaKop);
    // И ровно эта сумма — в ссылке на оплату.
    assert.ok(
      itog.adres.includes(`OutSum=${rubliStrokoy(itog.kOplateKop)}`),
      `в Робокассу ушла не та сумма: ${itog.adres}`,
    );
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    assert.equal(z.promo_kod, 'LETO25');
    assert.equal(z.cena_kop, cena, 'скидку нельзя вычитать из цены тарифа');
  } finally {
    await s.zakryt();
  }
});

/* ── оплата ─────────────────────────────────────────────────────── */

test('уведомление оплачивает ничейный заказ, повтор — не оплачивает второй раз', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'sbp', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const schet = schetZakaza(s, itog.nomer);
    const pary = uvedomlenie(schet, itog.kOplateKop);

    const pervoe = await prinyatUvedomlenie(s.l, pary);
    assert.equal(pervoe.chto, 'oplachen');
    assert.equal(pervoe.otvet, `OK${schet}`);
    const posle = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    assert.equal(posle.status, 'oplachen');
    assert.equal(posle.oplacheno_kop, itog.kOplateKop);
    assert.equal(posle.tg_id, null, 'оплата не должна выдумывать хозяина');

    const vtoroe = await prinyatUvedomlenie(s.l, pary);
    assert.equal(vtoroe.chto, 'uzhe_prinyat', 'повтор оплатил заказ второй раз');
    assert.equal(vtoroe.otvet, `OK${schet}`, 'повтору тоже надо ответить OK');
    const posleVtorogo = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    assert.equal(posleVtorogo.oplacheno_kop, itog.kOplateKop, 'деньги зачлись дважды');
  } finally {
    await s.zakryt();
  }
});

/* ── получение заказа ──────────────────────────────────────────── */

test('заказ забирает ПЕРВЫЙ, второму по той же ссылке — отказ', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: 'vk-posty', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    const klyuch = z.klyuch as string;

    assert.equal(zakazy.zabrat(s.l.db, klyuch, POKUPATEL), true);
    assert.equal(zakazy.zabrat(s.l.db, klyuch, DRUGOY), false, 'ссылку удалось использовать дважды');

    const posle = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    assert.equal(posle.tg_id, POKUPATEL, 'заказ достался не тому');
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 1, 'заказа нет в «Моих заказах»');
    assert.equal(zakazy.cheloveka(s.l.db, DRUGOY).length, 0);
  } finally {
    await s.zakryt();
  }
});

test('метка канала переезжает человеку вместе с заказом', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: 'vk-posty', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    zakazy.zabrat(s.l.db, z.klyuch as string, POKUPATEL);
    // Записывает её обработчик /start; здесь проверяется, что данные
    // для этого есть и что запись ложится по обычному правилу.
    metki.zapisatCheloveku(s.l.db, POKUPATEL, z.metka as string);
    const c = lyudi.chelovek(s.l.db, POKUPATEL) as { metka?: string | null };
    assert.equal(c.metka, 'vk-posty', 'весь трафик с сайта стал бы «без метки»');
  } finally {
    await s.zakryt();
  }
});

test('активация промокода получает хозяина, когда заказ забирают', async () => {
  const s = await lavka();
  try {
    zavestiKod(s);
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: 'LETO25', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    const doTogo = s.l.db.prepare('SELECT tg_id FROM promo_aktivacii WHERE zakaz_id = ?').get(z.id) as { tg_id: number | null };
    assert.equal(doTogo.tg_id, null, 'до получения хозяина у активации быть не может');

    zakazy.zabrat(s.l.db, z.klyuch as string, POKUPATEL);
    const posle = s.l.db.prepare('SELECT tg_id FROM promo_aktivacii WHERE zakaz_id = ?').get(z.id) as { tg_id: number | null };
    assert.equal(posle.tg_id, POKUPATEL, '«кем применялся» — это история, и её нельзя терять');
  } finally {
    await s.zakryt();
  }
});

/* ── деньги ─────────────────────────────────────────────────────── */

test('НИЧЕЙНЫЙ ОПЛАЧЕННЫЙ ЗАКАЗ ОТМЕНИТЬ НЕЛЬЗЯ: возвращать некому', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    await prinyatUvedomlenie(s.l, uvedomlenie(schetZakaza(s, itog.nomer), itog.kOplateKop));

    const otmena = zakazy.otmenit(s.l.db, itog.nomer, null, 'net_deneg');
    assert.equal(otmena.otmenen, false, 'деньги вернулись бы в никуда');
    assert.equal(otmena.pochemu, 'nichey');
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    assert.equal(z.status, 'oplachen', 'заказ не должен был закрыться');
    assert.equal(z.oplacheno_kop, itog.kOplateKop, 'деньги пропали с заказа');

    // А ПОСЛЕ получения — отменяется как обычно, с возвратом на баланс.
    zakazy.zabrat(s.l.db, z.klyuch as string, POKUPATEL);
    const vtoraya = zakazy.otmenit(s.l.db, itog.nomer, null, 'net_deneg');
    assert.equal(vtoraya.otmenen, true);
    assert.equal(vtoraya.vernuli, itog.kOplateKop);
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), itog.kOplateKop);
  } finally {
    await s.zakryt();
  }
});

test('неоплаченный ничейный заказ отменяется свободно: возвращать нечего', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const otmena = zakazy.otmenit(s.l.db, itog.nomer, null, 'net_deneg');
    assert.equal(otmena.otmenen, true);
    assert.equal(otmena.vernuli, 0);
  } finally {
    await s.zakryt();
  }
});

test('БАЛАНСА НА САЙТЕ НЕТ: ничейный заказ им не оплачивается', async () => {
  /* ЧЕСТНО О СИЛЕ ЭТОЙ ПРОВЕРКИ. Порча «убрать защиту и написать
     `z.tg_id ?? 0`» её НЕ роняет, и это проверено: у человека с
     номером 0 баланса нет, списывать нечего, и наблюдаемое поведение
     то же самое. То есть свойство держится ПО ПОСТРОЕНИЮ — у заказа
     без хозяина нет строк в кошельке, и запрос ничего не находит, —
     а явная защита в коде стоит там ради типов и ради того, чтобы
     намерение было написано словами.

     Проверка при этом не бесполезна: она держит НАБЛЮДАЕМОЕ —
     ни копейки не ушло, движений в кошельке не появилось, заказ
     остался ждать денег. Порча, которая ПРИДУМАЕТ хозяина (возьмёт
     последнего покупателя, владельца, кого угодно живого), покраснеет
     здесь же. */
  const s = await lavka();
  try {
    // У покупателя есть деньги на балансе — и они не должны
    // тронуться: мы не знаем, что это он.
    koshelek.popolnit(s.l.db, POKUPATEL, 500000, 'проба', null);
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const spisanie = zakazy.oplatitSBalansa(s.l.db, itog.nomer, new Date());
    assert.equal(spisanie.spisano, 0, 'списали с чужого баланса');
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 500000);
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    assert.equal(z.status, 'zhdet_oplaty');
    assert.equal(z.s_balansa_kop, 0, 'заказ числит деньги с чьего-то баланса');
    const dvizheniy = s.l.db
      .prepare('SELECT COUNT(*) AS n FROM dvizheniya WHERE zakaz_id = ?')
      .get(z.id) as { n: number };
    assert.equal(dvizheniy.n, 0, 'в кошельке появилось движение по ничейному заказу');
  } finally {
    await s.zakryt();
  }
});

test('деньги по ЗАКРЫТОМУ ничейному заказу никому не зачисляются, и об этом зовут людей', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const schet = schetZakaza(s, itog.nomer);
    // Заказ закрылся, пока человек платил.
    zakazy.otmenit(s.l.db, itog.nomer, null, 'net_deneg');

    const uved = await prinyatUvedomlenie(s.l, uvedomlenie(schet, itog.kOplateKop));
    assert.equal(uved.chto, 'zakaz_zakryt');
    assert.equal(uved.otvet, `OK${schet}`, 'Робокассе всё равно надо ответить');
    // Ни на чей баланс деньги не легли: хозяина нет, и придумывать
    // его нельзя — это отдало бы чужие деньги постороннему.
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 0);
    assert.equal(koshelek.balans(s.l.db, DRUGOY), 0);
    const sobytiya = zakazy.sobytiya(s.l.db, itog.nomer).map((x) => x.chto);
    assert.ok(
      sobytiya.some((x) => x.includes('НЕ зачислены')),
      `в истории заказа не сказано, что деньги повисли: ${sobytiya.join(' | ')}`,
    );
  } finally {
    await s.zakryt();
  }
});

/* ── панель ─────────────────────────────────────────────────────── */

test('панель: оплаченный ничейный заказ стоит в группе «ждём покупателя»', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    await prinyatUvedomlenie(s.l, uvedomlenie(schetZakaza(s, itog.nomer), itog.kOplateKop));
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;

    const pod = { estDostup: false, estKod: false, estAkkaunt: false };
    assert.equal(
      sleduyushchiyShag(z, pod),
      'zhdem_pokupatelya',
      'заказ с сайта нельзя предлагать взять в работу: вид аккаунта не выбран',
    );

    // Забрали и выбрали новый аккаунт — заказ становится обычным.
    zakazy.zabrat(s.l.db, z.klyuch as string, POKUPATEL);
    zakazy.postavitVidAkkaunta(s.l.db, z.id, 'novy');
    const svezhy = zakazy.po(s.l.db, z.id) as zakazy.Zakaz;
    assert.equal(sleduyushchiyShag(svezhy, pod), 'vzyat');
  } finally {
    await s.zakryt();
  }
});

test('вид аккаунта ставится ОДИН раз: нажатие из старого сообщения ничего не меняет', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    zakazy.zabrat(s.l.db, z.klyuch as string, POKUPATEL);

    assert.equal(zakazy.postavitVidAkkaunta(s.l.db, z.id, 'svoy'), true);
    assert.equal(
      zakazy.postavitVidAkkaunta(s.l.db, z.id, 'novy'),
      false,
      'заказ со «своим» аккаунтом перевели на «новый» — введённый пароль повис бы',
    );
    assert.equal((zakazy.po(s.l.db, z.id) as zakazy.Zakaz).vid_akkaunta, 'svoy');
  } finally {
    await s.zakryt();
  }
});

/* ── ссылка ─────────────────────────────────────────────────────── */

test('ссылка в бот несёт ключ и умещается в 64 знака Telegram', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const start = new URL(itog.vBot).searchParams.get('start') ?? '';
    assert.ok(start.startsWith('zakaz_'), `не та пара: ${start}`);
    assert.ok(start.length <= 64, `payload длиннее 64 знаков: ${start.length}`);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(start), `в payload есть знаки, которых Telegram не пропустит: ${start}`);
  } finally {
    await s.zakryt();
  }
});

test('пустой ключ ссылки не собирается вовсе', () => {
  assert.equal(ssylkaVBot(''), '');
});

/* ── путь целиком, настоящим вебхуком ──────────────────────────── */

/** Обновление вида «человек открыл ссылку из письма Робокассы». */
function start(payload: string, tgId = POKUPATEL): unknown {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: tgId, type: 'private' },
      from: { id: tgId, is_bot: false, first_name: 'Покупатель' },
      text: payload ? `/start ${payload}` : '/start',
      entities: [{ offset: 0, length: 6, type: 'bot_command' }],
    },
  };
}

/** Всё, что бот сказал человеку, одной строкой. */
function skazal(s: Stend): string {
  return s.tg.vyzovy
    .filter((v) => v.metod === 'sendMessage')
    .map((v) => String((v.telo as { text?: string }).text ?? ''))
    .join('\n');
}

test('ПУТЬ ЦЕЛИКОМ: оплатил на сайте → открыл ссылку → заказ у него в боте', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, {
      tovar: ZHIVOY_PLAN,
      oplata: 'sbp',
      promo: '',
      metka: 'vk-posty',
      popytka: popytka(),
    });
    assert.ok(itog.vyshlo);
    await prinyatUvedomlenie(s.l, uvedomlenie(schetZakaza(s, itog.nomer), itog.kOplateKop));
    const klyuch = (zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz).klyuch as string;

    s.tg.vyzovy.length = 0;
    await poslat(s.adres, SEKRET, start(`zakaz_${klyuch}`));

    const z = zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz;
    assert.equal(z.tg_id, POKUPATEL, 'заказ не стал его');
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 1, 'заказа нет в «Моих заказах»');
    assert.equal(lyudi.chelovek(s.l.db, POKUPATEL)?.metka, 'vk-posty', 'метка не переехала');

    const text = skazal(s);
    assert.ok(text.includes(`№ ${itog.nomer}`), `бот не назвал номер заказа: ${text}`);
    assert.ok(text.includes('Оплачено'), `бот не сказал, что заказ оплачен: ${text}`);
    assert.ok(text.includes('аккаунт'), `бот не спросил про аккаунт: ${text}`);

    // И ВИТРИНЫ ТУТ НЕ ДОЛЖНО БЫТЬ: человек пришёл за своим заказом,
    // а не покупать второй раз то, за что уже заплатил.
    assert.ok(!text.includes('Выберите, к какой нейросети'), `показали витрину: ${text}`);
  } finally {
    await s.zakryt();
  }
});

test('чужую ссылку второй человек открыть не может, и подробностей не узнаёт', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const klyuch = (zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz).klyuch as string;
    await poslat(s.adres, SEKRET, start(`zakaz_${klyuch}`, POKUPATEL));

    s.tg.vyzovy.length = 0;
    await poslat(s.adres, SEKRET, start(`zakaz_${klyuch}`, DRUGOY));
    const text = skazal(s);
    assert.equal((zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz).tg_id, POKUPATEL);
    assert.equal(zakazy.cheloveka(s.l.db, DRUGOY).length, 0, 'чужой заказ достался постороннему');
    assert.ok(text.includes('уже использована'), `не сказали, что ссылка занята: ${text}`);
    // Ни названия, ни суммы: ссылку могли переслать.
    assert.ok(!text.includes(String(itog.kOplateKop / 100)), `показали сумму чужого заказа: ${text}`);
  } finally {
    await s.zakryt();
  }
});

test('ссылка с выдуманным ключом — честный отказ, а не молчание', async () => {
  const s = await lavka();
  try {
    await poslat(s.adres, SEKRET, start('zakaz_00000000000000000000000000000000'));
    const text = skazal(s);
    assert.ok(text.includes('ссылка не подошла'), `на негодную ссылку бот промолчал: ${text}`);
  } finally {
    await s.zakryt();
  }
});

test('свою ссылку можно открыть второй раз: заказ уже ваш', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    const klyuch = (zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz).klyuch as string;
    await poslat(s.adres, SEKRET, start(`zakaz_${klyuch}`));
    // Выбрал новый аккаунт — и открыл ссылку снова.
    zakazy.postavitVidAkkaunta(s.l.db, itog.nomer, 'novy');
    s.tg.vyzovy.length = 0;
    await poslat(s.adres, SEKRET, start(`zakaz_${klyuch}`));
    const text = skazal(s);
    assert.ok(text.includes('уже ваш'), `человеку не сказали, что заказ его: ${text}`);
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 1, 'завёлся второй заказ');
  } finally {
    await s.zakryt();
  }
});

/** Обновление вида «человек нажал кнопку под сообщением». */
function nazhal(data: string, tgId = POKUPATEL): unknown {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: String(Math.floor(Math.random() * 1e9)),
      from: { id: tgId, is_bot: false, first_name: 'Покупатель' },
      chat_instance: '1',
      data,
      message: {
        message_id: Math.floor(Math.random() * 1e9),
        date: Math.floor(Date.now() / 1000),
        chat: { id: tgId, type: 'private' },
        from: { id: 1, is_bot: true, first_name: 'bot' },
        text: 'вопрос про аккаунт',
      },
    },
  };
}

/**
 * Ответ на «Новый аккаунт» должен объяснять ТО, ЧТО ПРОИЗОШЛО.
 *
 * Здесь стоял `zakazUzheEst` — текст про повторное нажатие кнопки
 * покупки: «Второй такой же заводить не стал: скорее всего кнопка
 * нажалась дважды». Человек, только что ответивший на единственный
 * оставшийся вопрос, читал его как «мой заказ не приняли» и шёл
 * искать второй заказ, которого нет. Сообщение, объясняющее не то,
 * что произошло, дороже отсутствующего.
 */
test('«Новый аккаунт» отвечает про выбор аккаунта, а не про двойное нажатие', async () => {
  const s = await lavka();
  try {
    const itog = await zakazSSayta(s.l, { tovar: ZHIVOY_PLAN, oplata: 'card', promo: '', metka: '', popytka: popytka() });
    assert.ok(itog.vyshlo);
    await prinyatUvedomlenie(s.l, uvedomlenie(schetZakaza(s, itog.nomer), itog.kOplateKop));
    const klyuch = (zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz).klyuch as string;
    await poslat(s.adres, SEKRET, start(`zakaz_${klyuch}`));

    s.tg.vyzovy.length = 0;
    await poslat(s.adres, SEKRET, nazhal(`zn:${itog.nomer}`));

    const text = s.tg.vyzovy
      .filter((v) => v.metod === 'sendMessage' || v.metod === 'editMessageText')
      .map((v) => String((v.telo as { text?: string }).text ?? ''))
      .join('\n');

    assert.equal(
      (zakazy.po(s.l.db, itog.nomer) as zakazy.Zakaz).vid_akkaunta,
      'novy',
      'вид аккаунта не записался',
    );
    assert.ok(!text.includes('нажалась дважды'), `ответили текстом про двойное нажатие: ${text}`);
    assert.ok(!text.includes('уже оформлен'), `ответили текстом про повторное оформление: ${text}`);
    assert.ok(text.includes('новый'), `не сказали, какой аккаунт выбран: ${text}`);

    // Второе нажатие той же вечной кнопки: выбор уже сделан,
    // и говорить об этом надо прямо, а не текстом про покупку.
    s.tg.vyzovy.length = 0;
    await poslat(s.adres, SEKRET, nazhal(`zn:${itog.nomer}`));
    const vtoroy = s.tg.vyzovy
      .filter((v) => v.metod === 'sendMessage' || v.metod === 'editMessageText')
      .map((v) => String((v.telo as { text?: string }).text ?? ''))
      .join('\n');
    assert.ok(vtoroy.includes('уже позади'), `на второе нажатие ответили не тем: ${vtoroy}`);
    assert.ok(!vtoroy.includes('нажалась дважды'), `и снова текст про двойное нажатие: ${vtoroy}`);
  } finally {
    await s.zakryt();
  }
});

test('ПУТЬ ЧЕРЕЗ БОТА НЕ СЛОМАН: /start без заказа показывает витрину', async () => {
  const s = await lavka();
  try {
    await poslat(s.adres, SEKRET, start(''));
    const text = skazal(s);
    assert.ok(text.length > 0, 'бот промолчал на обычный /start');
    assert.ok(!text.includes('ссылка не подошла'), `обычный /start принят за ссылку заказа: ${text}`);
  } finally {
    await s.zakryt();
  }
});
