/**
 * Робокасса: подписи, чек, уведомления.
 *
 * Что здесь проверяется и почему именно это.
 *
 * Приём платежей ломается тремя способами, и все три молчаливые:
 *
 *   1. ПОДПИСЬ НЕ СХОДИТСЯ — Робокасса отвечает ошибкой 29, человек
 *      видит страницу с ошибкой вместо оплаты, а в журнале лавки
 *      не происходит ничего вовсе: запроса к нам не было.
 *   2. ПОДПИСЬ НЕ ПРОВЕРЯЕТСЯ — тогда «оплачено» может сказать кто
 *      угодно, кто знает номер счёта. Это не поломка, а дыра, и она
 *      не проявляется НИКОГДА, пока её не найдут.
 *   3. УВЕДОМЛЕНИЕ ЗАСЧИТЫВАЕТСЯ ДВАЖДЫ — Робокасса повторяет его,
 *      пока не получит «OK», и второй раз не должен делать ничего.
 *
 * Поэтому проверки идут по настоящему коду и по настоящему серверу,
 * а не по копии: подписи считает тот же модуль, что в бою,
 * уведомление приходит в тот же HTTP-обработчик.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stend, POKUPATEL } from './stend.js';
import type { Stend } from './stend.js';
import * as zakazy from '../src/db/zakazy.js';
import * as koshelek from '../src/db/koshelek.js';
import * as lyudi from '../src/db/lyudi.js';
import {
  chek,
  podpisSsylki,
  podpisUvedomleniya,
  podpisVozvrata,
  rubliStrokoy,
  ssylkaOplaty,
  sozdatRobokassu,
} from '../src/oplata/robokassa.js';
import type { NastroykiRobokassy } from '../src/oplata/robokassa.js';
import { prinyatUvedomlenie, ostatokKOplate, vystavitSchet } from '../src/oplata/schet.js';
import type { Zakaz } from '../src/db/zakazy.js';

const LOGIN = 'Neirolavka';
const BOEVOY1 = 'boevoy-parol-odin';
const BOEVOY2 = 'boevoy-parol-dva';
const TEST1 = 'testovyy-parol-odin';
const TEST2 = 'testovyy-parol-dva';

const OKRUZHENIE = {
  NEIROLAVKA_ROBOKASSA_LOGIN: LOGIN,
  NEIROLAVKA_ROBOKASSA_PAROL1: BOEVOY1,
  NEIROLAVKA_ROBOKASSA_PAROL2: BOEVOY2,
  NEIROLAVKA_ROBOKASSA_TEST_PAROL1: TEST1,
  NEIROLAVKA_ROBOKASSA_TEST_PAROL2: TEST2,
  NEIROLAVKA_ROBOKASSA_TEST: '1',
};

function nastroyki(dop: Partial<NastroykiRobokassy> = {}): NastroykiRobokassy {
  return {
    login: LOGIN,
    parol1: BOEVOY1,
    parol2: BOEVOY2,
    testParol1: TEST1,
    testParol2: TEST2,
    test: true,
    algoritm: 'md5',
    sno: '',
    chekVPodpisi: 'kodirovanny',
    ...dop,
  };
}

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

const obrazec = (dop: Partial<Zakaz> = {}) =>
  ({ id: 7, nazvanie: 'Kling AI, Pro', cena_kop: 139900, skidka_kop: 0, oplacheno_kop: 0, ...dop }) as unknown as Zakaz;

/* ── подписи ───────────────────────────────────────────────────── */

test('подпись ссылки собирается по формуле login:OutSum:InvId:Receipt:пароль', () => {
  const n = nastroyki({ test: false });
  const zhdem = md5(`${LOGIN}:100.00:55:CHEK:${BOEVOY1}`);
  assert.equal(podpisSsylki(n, '100.00', 55, 'CHEK'), zhdem);
});

test('без чека тот же порядок, но без его места', () => {
  const n = nastroyki({ test: false });
  assert.equal(podpisSsylki(n, '100.00', 55, null), md5(`${LOGIN}:100.00:55:${BOEVOY1}`));
});

test('пользовательские параметры идут ПОСЛЕ пароля и отсортированными', () => {
  const n = nastroyki({ test: false });
  const shp = { Shp_b: '2', Shp_a: '1' };
  assert.equal(
    podpisSsylki(n, '100.00', 55, null, shp),
    md5(`${LOGIN}:100.00:55:${BOEVOY1}:Shp_a=1:Shp_b=2`),
  );
});

test('ТЕСТОВЫЙ РЕЖИМ БЕРЁТ ТЕСТОВЫЕ ПАРОЛИ, а не боевые', () => {
  /* Самая дорогая ошибка подключения: боевой пароль при IsTest=1
     даёт ошибку 29, неотличимую от ошибки в формуле. */
  const boy = podpisSsylki(nastroyki({ test: false }), '100.00', 55, null);
  const proba = podpisSsylki(nastroyki({ test: true }), '100.00', 55, null);
  assert.notEqual(boy, proba, 'в тестовом режиме подпись обязана считаться тестовым паролем');
  assert.equal(proba, md5(`${LOGIN}:100.00:55:${TEST1}`));
});

test('уведомление подписывается ПАРОЛЕМ № 2, возврат человека — № 1', () => {
  /* Это не педантизм. Пароль № 1 уезжает в браузер в составе ссылки
     на оплату; проверь мы им уведомление — «оплачено» мог бы сказать
     любой, кто видел ссылку. */
  const n = nastroyki({ test: false });
  assert.equal(podpisUvedomleniya(n, '100.00', '55'), md5(`100.00:55:${BOEVOY2}`));
  assert.equal(podpisVozvrata(n, '100.00', '55'), md5(`100.00:55:${BOEVOY1}`));
  assert.notEqual(podpisUvedomleniya(n, '100.00', '55'), podpisVozvrata(n, '100.00', '55'));
});

test('в подписи уведомления НЕТ логина — в отличие от подписи ссылки', () => {
  const n = nastroyki({ test: false });
  assert.notEqual(podpisUvedomleniya(n, '100.00', '55'), md5(`${LOGIN}:100.00:55:${BOEVOY2}`));
});

/* ── сумма и чек ───────────────────────────────────────────────── */

test('копейки в рубли — строкой с двумя знаками', () => {
  assert.equal(rubliStrokoy(125910), '1259.10');
  assert.equal(rubliStrokoy(100), '1.00');
  assert.equal(rubliStrokoy(0), '0.00');
});

test('чек: одна позиция, НДС none, сумма позиции равна сумме платежа', () => {
  const c = chek(nastroyki(), 'Kling AI, Pro', 125910) as {
    items: { name: string; quantity: number; sum: number; tax: string; payment_object: string }[];
    sno?: string;
  };
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0]!.name, 'Kling AI, Pro');
  assert.equal(c.items[0]!.quantity, 1);
  assert.equal(c.items[0]!.sum, 1259.1);
  assert.equal(c.items[0]!.tax, 'none');
  assert.equal(c.items[0]!.payment_object, 'service');
  assert.equal(c.sno, undefined, 'пустая система налогообложения в чек не пишется');
});

test('система налогообложения попадает в чек, если её задали', () => {
  const c = chek(nastroyki({ sno: 'usn_income' }), 'Что-то', 10000) as { sno?: string };
  assert.equal(c.sno, 'usn_income');
});

test('ссылка: чек закодирован РОВНО ОДИН раз и совпадает с тем, что в подписи', () => {
  const n = nastroyki();
  const url = ssylkaOplaty(n, { zakaz: obrazec(), nomer: 55, summaKop: 125910 });
  const q = new URL(url).searchParams;
  // URL сам раскодирует значение: если бы мы закодировали дважды,
  // здесь оказался бы «%7B…» вместо «{…».
  assert.ok(q.get('Receipt')!.startsWith('{'), 'чек закодирован дважды');
  assert.equal(q.get('OutSum'), '1259.10');
  assert.equal(q.get('InvId'), '55');
  assert.equal(q.get('IsTest'), '1', 'в тестовом режиме обязан быть IsTest=1');
  const chekKod = encodeURIComponent(q.get('Receipt')!);
  assert.equal(q.get('SignatureValue'), podpisSsylki(n, '1259.10', 55, chekKod));
});

test('боевой режим не ставит IsTest', () => {
  const url = ssylkaOplaty(nastroyki({ test: false }), { zakaz: obrazec(), nomer: 55, summaKop: 100 });
  assert.equal(new URL(url).searchParams.get('IsTest'), null);
});

/* ── деньги заказа ─────────────────────────────────────────────── */

test('платить надо ОСТАТОК: цена минус скидка минус списанное с баланса', () => {
  assert.equal(ostatokKOplate(obrazec({ cena_kop: 139900, skidka_kop: 13990, oplacheno_kop: 0 })), 125910);
  assert.equal(ostatokKOplate(obrazec({ cena_kop: 139900, skidka_kop: 13990, oplacheno_kop: 100000 })), 25910);
  assert.equal(ostatokKOplate(obrazec({ cena_kop: 139900, skidka_kop: 139900, oplacheno_kop: 0 })), 0);
});

/* ── через настоящую лавку ─────────────────────────────────────── */

async function lavka(): Promise<Stend> {
  const s = await stend(OKRUZHENIE);
  // Заказ ссылается на человека внешним ключом: без записи о нём
  // база откажет, и проверка упадёт не по той причине, ради которой
  // написана.
  lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
  return s;
}

/** Завести заказ, ждущий оплаты, и вернуть его. */
function zakaz(s: Stend, cenaKop = 100000): Zakaz {
  const { zakaz: z } = zakazy.sozdatIliVernut(s.l.db, {
    tgId: POKUPATEL,
    produktId: 'proba',
    planId: `proba-${Math.round(cenaKop)}-${Date.now() % 100000}`,
    nazvanie: 'Проба, Уровень',
    cenaKop,
    mesyacev: 0,
    vidAkkaunta: 'novy',
  });
  return z;
}

/** Собрать уведомление с ВЕРНОЙ подписью — так, как его шлёт Робокасса. */
function uvedomlenie(s: Stend, nomer: number, summaKop: number): Record<string, string> {
  const outSum = rubliStrokoy(summaKop);
  return {
    OutSum: outSum,
    InvId: String(nomer),
    SignatureValue: podpisUvedomleniya(s.l.n.robokassa, outSum, String(nomer)).toUpperCase(),
  };
}

test('поставщик — Робокасса, и она работает', async () => {
  const s = await lavka();
  try {
    assert.equal(s.l.oplata.imya, 'robokassa');
    assert.equal(s.l.oplata.rabotaet, true);
  } finally {
    await s.zakryt();
  }
});

const nomerScheta = (p: { adres: string | null }) =>
  Number(new URL(p.adres!).searchParams.get('InvId'));

test('НОМЕР СЧЁТА — СВОЯ ПОСЛЕДОВАТЕЛЬНОСТЬ, а не номер заказа', async () => {
  /* Повторный номер Робокасса встречает ошибкой 40. Поэтому номер
     берётся из таблицы платежей с её AUTOINCREMENT, а не из заказа:
     у одного заказа платежей бывает несколько. Сравнивать «номер
     счёта не равен номеру заказа» бессмысленно — на свежей базе
     первый заказ и первый платёж оба получат единицу, и это
     не ошибка. Проверять надо то, что важно: номер ведёт к своему
     платежу, у разных платежей номера разные и они не повторяются. */
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p1 = await vystavitSchet(s.l, z);
    assert.ok(p1.adres, 'ссылки на оплату нет');
    const nomer1 = nomerScheta(p1);

    const platezh = zakazy.platezhPo(s.l.db, nomer1);
    assert.ok(platezh, 'по номеру счёта не находится платёж');
    assert.equal(platezh!.zakaz_id, z.id, 'платёж должен вести к своему заказу');
    assert.equal(platezh!.summa_kop, 100000);

    // Повторное нажатие «Оплатить» не заводит второй счёт.
    assert.equal(nomerScheta(await vystavitSchet(s.l, z)), nomer1);

    // А изменившаяся сумма обязана дать НОВЫЙ счёт: старый подписан
    // старой суммой и уехал бы в ошибку 29.
    const nomer2 = nomerScheta(await vystavitSchet(s.l, { ...z, oplacheno_kop: 40000 } as Zakaz));
    assert.notEqual(nomer2, nomer1);

    // У другого заказа — свой номер, и номера только растут.
    const nomer3 = nomerScheta(await vystavitSchet(s.l, zakaz(s, 70000)));
    assert.ok(nomer3 > nomer2 && nomer2 > nomer1, `номера обязаны расти: ${nomer1}, ${nomer2}, ${nomer3}`);
  } finally {
    await s.zakryt();
  }
});

test('номер не переиспользуется даже после удаления платежа', async () => {
  /* AUTOINCREMENT, а не MAX(id)+1: без него SQLite выдал бы удалённый
     номер заново, а Робокасса встретила бы его ошибкой 40. */
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const nomer1 = nomerScheta(await vystavitSchet(s.l, z));
    s.l.db.prepare('DELETE FROM platezhi WHERE id = ?').run(nomer1);
    const nomer2 = nomerScheta(await vystavitSchet(s.l, z));
    assert.notEqual(nomer2, nomer1, 'номер удалённого счёта не должен выдаваться заново');
  } finally {
    await s.zakryt();
  }
});

test('уведомление с верной подписью оплачивает заказ, и ответ — OK<номер>', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);

    const itog = await prinyatUvedomlenie(s.l, uvedomlenie(s, nomer, 100000));
    assert.equal(itog.chto, 'oplachen');
    assert.equal(itog.otvet, `OK${nomer}`);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'oplachen');
  } finally {
    await s.zakryt();
  }
});

test('ПОДДЕЛАННАЯ ПОДПИСЬ НЕ ОПЛАЧИВАЕТ НИЧЕГО', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);

    const podelka = { OutSum: '1000.00', InvId: String(nomer), SignatureValue: md5('что угодно') };
    const itog = await prinyatUvedomlenie(s.l, podelka);
    assert.equal(itog.chto, 'podpis_ne_soshlas');
    assert.equal(itog.kod, 403);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'zhdet_oplaty');
  } finally {
    await s.zakryt();
  }
});

test('подпись ПАРОЛЕМ № 1 в уведомлении не проходит', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);
    const n = s.l.n.robokassa;
    const pary = {
      OutSum: '1000.00',
      InvId: String(nomer),
      SignatureValue: podpisVozvrata(n, '1000.00', String(nomer)),
    };
    const itog = await prinyatUvedomlenie(s.l, pary);
    assert.equal(itog.chto, 'podpis_ne_soshlas');
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'zhdet_oplaty');
  } finally {
    await s.zakryt();
  }
});

test('ДВА ОДИНАКОВЫХ УВЕДОМЛЕНИЯ НЕ ОПЛАЧИВАЮТ ЗАКАЗ ДВАЖДЫ', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);
    const u = uvedomlenie(s, nomer, 100000);

    const pervoe = await prinyatUvedomlenie(s.l, u);
    const vtoroe = await prinyatUvedomlenie(s.l, u);
    assert.equal(pervoe.chto, 'oplachen');
    assert.equal(vtoroe.chto, 'uzhe_prinyat');
    // Повтору тоже отвечаем «принято»: иначе Робокасса будет
    // повторять его до скончания века.
    assert.equal(vtoroe.otvet, `OK${nomer}`);
    assert.equal(vtoroe.kod, 200);

    // Событий об оплате в истории заказа ровно одно.
    const sobytiya = zakazy.sobytiya(s.l.db, z.id).filter((e) => e.chto.includes('Робокассу'));
    assert.equal(sobytiya.length, 1);
    // И баланс покупателя не вырос ни на копейку.
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 0);
  } finally {
    await s.zakryt();
  }
});

test('уведомление на ЧУЖУЮ сумму не засчитывается', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);

    // Подпись верная, а сумма — другая: платёж выставляли на 1000 ₽.
    const itog = await prinyatUvedomlenie(s.l, uvedomlenie(s, nomer, 1));
    assert.equal(itog.chto, 'summa_ne_ta');
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'zhdet_oplaty');
  } finally {
    await s.zakryt();
  }
});

test('уведомление по НЕСУЩЕСТВУЮЩЕМУ счёту отвергается', async () => {
  const s = await lavka();
  try {
    const itog = await prinyatUvedomlenie(s.l, uvedomlenie(s, 999999, 100000));
    assert.equal(itog.chto, 'net_scheta');
    assert.equal(itog.kod, 404);
  } finally {
    await s.zakryt();
  }
});

test('ЧАСТИЧНАЯ ОПЛАТА: баланс закрывает часть, Робокассе уходит остаток', async () => {
  const s = await lavka();
  try {
    koshelek.popolnit(s.l.db, POKUPATEL, 40000, 'проба', null);
    const z = zakaz(s, 100000);
    const srok = new Date(Date.now() + 3600_000);
    const { spisano, hvatilo } = zakazy.oplatitSBalansa(s.l.db, z.id, srok);
    assert.equal(spisano, 40000);
    assert.equal(hvatilo, false);

    const svezhy = zakazy.po(s.l.db, z.id)!;
    const p = await vystavitSchet(s.l, svezhy);
    assert.equal(p.summaKop, 60000, 'Робокассе должен уйти остаток, а не вся цена');
    assert.equal(new URL(p.adres!).searchParams.get('OutSum'), '600.00');

    // И в чеке стоит та же сумма: касса пробивает то, что прошло.
    const c = JSON.parse(new URL(p.adres!).searchParams.get('Receipt')!) as { items: { sum: number }[] };
    assert.equal(c.items[0]!.sum, 600);

    const nomer = nomerScheta(p);
    const itog = await prinyatUvedomlenie(s.l, uvedomlenie(s, nomer, 60000));
    assert.equal(itog.chto, 'oplachen');
    const posle = zakazy.po(s.l.db, z.id)!;
    assert.equal(posle.status, 'oplachen');
    // Заказ держит ВСЮ сумму: и то, что с баланса, и то, что картой.
    assert.equal(posle.oplacheno_kop, 100000);
    assert.equal(posle.s_balansa_kop, 40000);
  } finally {
    await s.zakryt();
  }
});

test('СКИДКА ПРОМОКОДА уменьшает то, что уходит в Робокассу', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 139900);
    s.l.db.prepare('UPDATE zakazy SET promo_kod = ?, skidka_kop = ? WHERE id = ?').run('LETO25', 13990, z.id);
    const svezhy = zakazy.po(s.l.db, z.id)!;
    const p = await vystavitSchet(s.l, svezhy);
    assert.equal(p.summaKop, 125910);
    assert.equal(new URL(p.adres!).searchParams.get('OutSum'), '1259.10');
  } finally {
    await s.zakryt();
  }
});

test('деньги по УЖЕ ЗАКРЫТОМУ заказу не теряются — они уходят на баланс', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);

    // Человек ушёл платить, а заказ за это время отменили.
    zakazy.otmenit(s.l.db, z.id, null, 'net_koda');
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'otmenen');

    const itog = await prinyatUvedomlenie(s.l, uvedomlenie(s, nomer, 100000));
    assert.equal(itog.chto, 'zakaz_zakryt');
    assert.equal(itog.otvet, `OK${nomer}`, 'Робокассе всё равно отвечаем «принято»');
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 100000, 'деньги обязаны оказаться на балансе');
  } finally {
    await s.zakryt();
  }
});

/* ── через настоящий HTTP ──────────────────────────────────────── */

test('уведомление приходит НАСТОЯЩИМ POST на /robokassa/result', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);

    const telo = new URLSearchParams(uvedomlenie(s, nomer, 100000)).toString();
    const r = await fetch(`${s.koren}/robokassa/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: telo,
    });
    assert.equal(r.status, 200);
    assert.equal((await r.text()).trim(), `OK${nomer}`);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'oplachen');
  } finally {
    await s.zakryt();
  }
});

test('то же уведомление приходит GET-ом — метод в кабинете выбирается галочкой', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);

    const q = new URLSearchParams(uvedomlenie(s, nomer, 100000)).toString();
    const r = await fetch(`${s.koren}/robokassa/result?${q}`);
    assert.equal(r.status, 200);
    assert.equal((await r.text()).trim(), `OK${nomer}`);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'oplachen');
  } finally {
    await s.zakryt();
  }
});

test('подделка по HTTP получает отказ и ничего не меняет', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);

    const q = new URLSearchParams({
      OutSum: '1000.00',
      InvId: String(nomer),
      SignatureValue: md5('подделка'),
    }).toString();
    const r = await fetch(`${s.koren}/robokassa/result?${q}`);
    assert.equal(r.status, 403);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'zhdet_oplaty');
  } finally {
    await s.zakryt();
  }
});

test('страница возврата НИЧЕГО не оплачивает', async () => {
  const s = await lavka();
  try {
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    const nomer = nomerScheta(p);
    const n = s.l.n.robokassa;

    // Даже с ПРАВИЛЬНОЙ подписью возврата статус не меняется:
    // засчитывает оплату только уведомление на /result.
    const q = new URLSearchParams({
      OutSum: '1000.00',
      InvId: String(nomer),
      SignatureValue: podpisVozvrata(n, '1000.00', String(nomer)),
    }).toString();
    const r = await fetch(`${s.koren}/robokassa/uspeh?${q}`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Оплата принята/);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'zhdet_oplaty');
  } finally {
    await s.zakryt();
  }
});

test('страница неудачи говорит, что заказ на месте', async () => {
  const s = await lavka();
  try {
    const r = await fetch(`${s.koren}/robokassa/neudacha`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Ничего не списано/);
    assert.ok(!html.includes('<script'), 'скриптов на странице быть не должно');
  } finally {
    await s.zakryt();
  }
});

test('в ТЕСТОВОМ режиме человеку об этом говорится словами', async () => {
  /* Молчать нельзя: человек уйдёт на страницу Робокассы, деньги
     не спишутся, доступа не будет — и объяснить это будет некому. */
  const s = await lavka();
  try {
    const p = await vystavitSchet(s.l, zakaz(s, 100000));
    assert.match(p.soobshchenie, /ТЕСТОВОМ/);
  } finally {
    await s.zakryt();
  }
});

test('в боевом режиме лишнего абзаца нет — говорит кнопка', async () => {
  const s = await stend({ ...OKRUZHENIE, NEIROLAVKA_ROBOKASSA_TEST: '0' });
  lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
  try {
    const p = await vystavitSchet(s.l, zakaz(s, 100000));
    assert.ok(p.adres, 'ссылки нет');
    assert.equal(p.soobshchenie, '');
    assert.equal(new URL(p.adres!).searchParams.get('IsTest'), null);
  } finally {
    await s.zakryt();
  }
});

test('без настроек Робокассы заказ всё равно принимается, а платить негде', async () => {
  const s = await stend();
  lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
  try {
    assert.equal(s.l.oplata.imya, 'zaglushka');
    const z = zakaz(s, 100000);
    const p = await vystavitSchet(s.l, z);
    assert.equal(p.adres, null);
    assert.match(p.soobshchenie, /не подключена/);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'zhdet_oplaty');
  } finally {
    await s.zakryt();
  }
});

test('поставщик собирается из НАСТРОЕК, а не из объекта в проверке', () => {
  /* Тот же довод, что у `sozdatBota`: проверка обязана гонять код,
     который работает в бою. Здесь это видно прямо: разбор окружения
     и сборка поставщика — те же функции. */
  const p = sozdatRobokassu(nastroyki({ login: '', parol1: '', testParol1: '' }));
  assert.equal(p.rabotaet, false, 'без логина и пароля оплата не работает');
});
