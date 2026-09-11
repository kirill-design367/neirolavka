/**
 * Промокоды.
 *
 * Проверяется не «функция считает проценты» (это видно и так),
 * а четыре свойства, каждое из которых ломается молча и обходится
 * дорого:
 *
 *   1. АКТИВАЦИЯ ТРАТИТСЯ ПРИ ОФОРМЛЕНИИ ЗАКАЗА, а не при вводе кода.
 *      Иначе код сгорает у того, кто посмотрел и передумал, — то есть
 *      отбирается у того, кто дошёл до конца;
 *   2. ПОСЛЕДНЮЮ АКТИВАЦИЮ ДВОЕ НЕ ПОЛУЧАТ. Разнимает база, а не
 *      проверка в коде: у занятых мест частичный уникальный индекс;
 *   3. ОТМЕНА ВОЗВРАЩАЕТ АКТИВАЦИЮ КОДУ, не стирая историю
 *      применений, и делает это той же транзакцией, что и возврат
 *      денег на баланс;
 *   4. СКИДКА СЧИТАЕТСЯ ОТ ЦЕНЫ ТАРИФА, а баланс закрывает то, что
 *      осталось. Обратный порядок съедал бы скидку деньгами
 *      покупателя.
 *
 * Проверено на способность падать: со снятым уникальным индексом
 * проба на гонку краснеет, с возвратом активации мимо транзакции
 * отмены — проба на отмену, с расчётом скидки после баланса —
 * проба на сочетание с балансом.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { otkrytBazu } from '../src/db/index.js';
import * as promo from '../src/db/promokody.js';
import * as zakazy from '../src/db/zakazy.js';
import * as koshelek from '../src/db/koshelek.js';
import * as lyudi from '../src/db/lyudi.js';
import { kodPromo, skidkaKop } from '../src/lib/promokod.js';

const PERVYY = 42;
const VTOROY = 43;
const VLADELEC = 1;

/** Через сутки: срок, который заведомо ещё не истёк. */
const ZAVTRA = () => new Date(Date.now() + 24 * 3600_000).toISOString();
const VCHERA = () => new Date(Date.now() - 24 * 3600_000).toISOString();

function baza() {
  const db = otkrytBazu(':memory:');
  lyudi.zapomnit(db, PERVYY, 'Первый', null);
  lyudi.zapomnit(db, VTOROY, 'Второй', null);
  return db;
}

const zakaz = (tgId: number, planId: string, cenaKop: number, promoKod?: string) => ({
  tgId,
  produktId: 'kling',
  planId,
  nazvanie: `Kling AI, ${planId}`,
  cenaKop,
  mesyacev: 0,
  vidAkkaunta: 'novy' as const,
  ...(promoKod ? { promoKod } : {}),
});

function zavesti(db: ReturnType<typeof baza>, kod: string, skidka = 10, aktivaciy = 1) {
  const itog = promo.zavesti(db, { kod, skidkaProc: skidka, doDaty: ZAVTRA(), aktivaciy }, VLADELEC);
  assert.ok(!('oshibka' in itog), `промокод ${kod} не завёлся: ${JSON.stringify(itog)}`);
  return (itog as { promokod: promo.Promokod }).promokod;
}

// ── правила кода ─────────────────────────────────────────────────────

test('код приводится к прописной латинице, кириллица не выживает', () => {
  assert.equal(kodPromo('leto-25'), 'LETO-25');
  assert.equal(kodPromo('  Leto 25 '), 'LETO-25');
  // Подчёркивание занято под разделитель пар в payload.
  assert.equal(kodPromo('leto_25'), 'LETO-25');
  // Кириллица не переживает Telegram — значит кода нет вовсе,
  // и это честнее молчаливой подстановки чего-нибудь похожего.
  assert.equal(kodPromo('ЛЕТО'), '');
  assert.equal(kodPromo('ЛЕТО25'), '25');
  assert.equal(kodPromo(''), '');
  assert.equal(kodPromo(null), '');
});

test('скидка считается от цены тарифа, ноль цены даёт ноль скидки', () => {
  assert.equal(skidkaKop(139_900, 10), 13_990);
  assert.equal(skidkaKop(139_900, 100), 139_900);
  // Цены нет — процент от неизвестного тоже неизвестен, а не ноль
  // рублей выгоды.
  assert.equal(skidkaKop(0, 50), 0);
  assert.equal(skidkaKop(139_900, 0), 0);
});

// ── заведение ────────────────────────────────────────────────────────

test('промокод заводится и находится по любому написанию', () => {
  const db = baza();
  zavesti(db, 'leto25', 15, 5);
  assert.equal(promo.po(db, 'LETO25')?.skidka_proc, 15);
  assert.equal(promo.po(db, '  leto25 ')?.kod, 'LETO25');
  /* А вот «leto 25» — ЭТО ДРУГОЙ КОД, и так и задумано: пробел
     становится дефисом теми же правилами, что у метки канала.
     Одно правило на оба кода дешевле помнить, чем два похожих. */
  assert.equal(promo.po(db, 'leto 25'), null);
  assert.equal(kodPromo('leto 25'), 'LETO-25');
});

test('заведение отвергает пустой код, чужой занятый и неверные числа', () => {
  const db = baza();
  zavesti(db, 'LETO25');
  const plohie: [string, Record<string, unknown>][] = [
    ['net_koda', { kod: 'ЛЕТО', skidkaProc: 10, doDaty: ZAVTRA(), aktivaciy: 1 }],
    ['zanyat', { kod: 'LETO25', skidkaProc: 10, doDaty: ZAVTRA(), aktivaciy: 1 }],
    ['nevernaya_skidka', { kod: 'A1', skidkaProc: 0, doDaty: ZAVTRA(), aktivaciy: 1 }],
    ['nevernaya_skidka', { kod: 'A2', skidkaProc: 101, doDaty: ZAVTRA(), aktivaciy: 1 }],
    ['nevernye_aktivacii', { kod: 'A3', skidkaProc: 10, doDaty: ZAVTRA(), aktivaciy: 0 }],
    ['nevernye_aktivacii', { kod: 'A4', skidkaProc: 10, doDaty: ZAVTRA(), aktivaciy: 10_001 }],
    ['net_sroka', { kod: 'A5', skidkaProc: 10, doDaty: 'когда-нибудь', aktivaciy: 1 }],
  ];
  for (const [zhdem, z] of plohie) {
    const itog = promo.zavesti(db, z as Parameters<typeof promo.zavesti>[1], VLADELEC);
    assert.ok('oshibka' in itog, `${JSON.stringify(z)} прошёл, а не должен был`);
    assert.equal((itog as { oshibka: string }).oshibka, zhdem, JSON.stringify(z));
  }
});

test('придуманный код читается: ни нуля с О, ни единицы с I', () => {
  const kod = promo.pridumatKod(10);
  assert.equal(kod.length, 10);
  assert.match(kod, /^[A-Z0-9]+$/);
  assert.ok(!/[0O1IL]/.test(kod), `в коде ${kod} есть путающиеся знаки`);
  // И он переживает чистку без изменений — иначе сгенерированный
  // код в ссылке отличался бы от того, что лежит в базе.
  assert.equal(kodPromo(kod), kod);
});

// ── проверка ─────────────────────────────────────────────────────────

test('проверка различает «нет», «истёк», «кончились» и «отключён»', () => {
  const db = baza();
  zavesti(db, 'ZHIVOY', 10, 1);
  assert.deepEqual(promo.proverit(db, 'ZHIVOY'), { godit: true, kod: 'ZHIVOY', skidkaProc: 10 });
  assert.deepEqual(promo.proverit(db, 'NETU'), { godit: false, pochemu: 'net' });

  promo.zavesti(db, { kod: 'STARYY', skidkaProc: 10, doDaty: VCHERA(), aktivaciy: 5 }, VLADELEC);
  assert.deepEqual(promo.proverit(db, 'STARYY'), { godit: false, pochemu: 'istyok' });

  zavesti(db, 'VYKL');
  promo.otklyuchit(db, 'VYKL', true);
  assert.deepEqual(promo.proverit(db, 'VYKL'), { godit: false, pochemu: 'otklyuchen' });

  // Единственная активация занята заказом — код кончился.
  zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'ZHIVOY'));
  assert.deepEqual(promo.proverit(db, 'ZHIVOY'), { godit: false, pochemu: 'konchilis' });
});

// ── применение ───────────────────────────────────────────────────────

test('активация тратится при ОФОРМЛЕНИИ, а не при проверке кода', () => {
  const db = baza();
  zavesti(db, 'LETO', 10, 3);

  // Сколько угодно проверок — ни одна активация не тратится.
  for (let i = 0; i < 20; i++) promo.proverit(db, 'LETO');
  assert.equal(promo.zanyato(db, 'LETO'), 0, 'проверка кода потратила активацию');

  const { zakaz: z, promo: p } = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 139_900, 'LETO'));
  assert.equal(p.vid, 'primenen');
  assert.equal(promo.zanyato(db, 'LETO'), 1);
  assert.equal(z.promo_kod, 'LETO');
  assert.equal(z.skidka_kop, 13_990);
  assert.equal(z.cena_kop, 139_900, 'цена тарифа обязана остаться нетронутой');
  assert.equal(zakazy.kOplate(z), 125_910);
});

test('ДВОЕ НА ПОСЛЕДНЮЮ АКТИВАЦИЮ: второму её не достаётся', () => {
  const db = baza();
  zavesti(db, 'ODIN', 20, 1);

  const a = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'ODIN'));
  const b = zakazy.sozdatIliVernut(db, zakaz(VTOROY, 'kling-pro', 100_000, 'ODIN'));

  assert.equal(a.promo.vid, 'primenen');
  assert.equal(b.promo.vid, 'ne_podoshel');
  assert.equal(b.promo.vid === 'ne_podoshel' ? b.promo.pochemu : null, 'konchilis');
  // Заказ у второго ВСЁ РАВНО есть: человек пришёл за подпиской,
  // а не за скидкой, и ронять заказ из-за кода нельзя.
  assert.equal(b.zakaz.skidka_kop, 0);
  assert.equal(b.zakaz.promo_kod, null);
  assert.equal(promo.zanyato(db, 'ODIN'), 1);
});

test('мест ровно столько, сколько объявлено активаций', () => {
  const db = baza();
  zavesti(db, 'TRI', 10, 3);
  const kuplennye = ['kling-a', 'kling-b', 'kling-c', 'kling-d'].map((plan, i) =>
    zakazy.sozdatIliVernut(db, zakaz(PERVYY + (i % 2), plan, 100_000, 'TRI')),
  );
  assert.deepEqual(
    kuplennye.map((k) => k.promo.vid),
    ['primenen', 'primenen', 'primenen', 'ne_podoshel'],
  );
  assert.equal(promo.zanyato(db, 'TRI'), 3);
  // Номера мест — 1, 2, 3 и без повторов: на них стоит уникальный индекс.
  const mesta = promo.primeneniya(db, 'TRI').map((a) => a.mesto).sort();
  assert.deepEqual(mesta, [1, 2, 3]);
});

test('уникальный индекс не пускает второе занятие того же места', () => {
  const db = baza();
  zavesti(db, 'ODIN', 10, 1);
  const { zakaz: z } = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'ODIN'));
  const { zakaz: vtoroy } = zakazy.sozdatIliVernut(db, zakaz(VTOROY, 'kling-pro', 100_000));
  // Прямая вставка мимо `zanyat` — именно так выглядела бы гонка,
  // если бы её разнимал код, а не база.
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO promo_aktivacii (kod, mesto, zakaz_id, tg_id, skidka_kop, kogda)
           VALUES ('ODIN', 1, ?, ?, 1000, ?)`,
        )
        .run(vtoroy.id, VTOROY, new Date().toISOString()),
    /UNIQUE|constraint/i,
    'база пустила двоих на одно место',
  );
  assert.equal(z.promo_kod, 'ODIN');
});

test('цены нет — активация не тратится вовсе', () => {
  const db = baza();
  zavesti(db, 'LETO', 50, 5);
  const { zakaz: z, promo: p } = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 0, 'LETO'));
  assert.equal(p.vid, 'ne_podoshel');
  assert.equal(p.vid === 'ne_podoshel' ? p.pochemu : null, 'net_ceny');
  assert.equal(promo.zanyato(db, 'LETO'), 0, 'сгорела активация ради нулевой скидки');
  assert.equal(z.skidka_kop, 0);
});

// ── отмена ───────────────────────────────────────────────────────────

test('отмена ВОЗВРАЩАЕТ активацию коду, не стирая историю применений', () => {
  const db = baza();
  zavesti(db, 'ODIN', 10, 1);
  const { zakaz: z } = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'ODIN'));
  assert.equal(promo.zanyato(db, 'ODIN'), 1);

  const itog = zakazy.otmenit(db, z.id, VLADELEC, 'net_deneg');
  assert.equal(itog.otmenen, true);
  assert.equal(promo.zanyato(db, 'ODIN'), 0, 'активация не вернулась коду');

  // История ОСТАЛАСЬ: «кем и когда применялся» — это запись
  // о случившемся, а не счётчик.
  const bylo = promo.primeneniya(db, 'ODIN');
  assert.equal(bylo.length, 1);
  assert.equal(bylo[0]!.tg_id, PERVYY);
  assert.ok(bylo[0]!.snyata_v, 'у снятой активации нет отметки о возврате');

  // И код снова годится — тем же местом.
  assert.equal(promo.proverit(db, 'ODIN').godit, true);
  const vtoroy = zakazy.sozdatIliVernut(db, zakaz(VTOROY, 'kling-pro', 100_000, 'ODIN'));
  assert.equal(vtoroy.promo.vid, 'primenen');
  assert.equal(promo.zanyato(db, 'ODIN'), 1);
});

test('отмена возвращает И деньги, И активацию — одной транзакцией', () => {
  const db = baza();
  zavesti(db, 'POL', 50, 1);
  koshelek.popolnit(db, PERVYY, 200_000, 'проба', VLADELEC);
  const { zakaz: z } = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'POL'));
  zakazy.oplatitSBalansa(db, z.id, new Date());

  // Списано ровно «к оплате»: 1000 ₽ минус половина.
  assert.equal(koshelek.balans(db, PERVYY), 150_000);

  const itog = zakazy.otmenit(db, z.id, VLADELEC, 'net_deneg');
  assert.equal(itog.vernuli, 50_000);
  assert.equal(koshelek.balans(db, PERVYY), 200_000, 'вернули не то, что взяли');
  assert.equal(promo.zanyato(db, 'POL'), 0);
});

// ── сочетание с балансом ─────────────────────────────────────────────

test('СНАЧАЛА СКИДКА, ПОТОМ БАЛАНС: скидку не съедают деньги покупателя', () => {
  const db = baza();
  zavesti(db, 'DESYAT', 10, 5);
  // Цена 1000 ₽, скидка 10 % → к оплате 900 ₽. На балансе ровно 900.
  koshelek.popolnit(db, PERVYY, 90_000, 'проба', VLADELEC);
  const { zakaz: z } = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'DESYAT'));
  const { spisano, hvatilo } = zakazy.oplatitSBalansa(db, z.id, new Date());

  assert.equal(spisano, 90_000);
  assert.equal(hvatilo, true, 'баланса не хватило, хотя после скидки он ровно в сумму');
  assert.equal(zakazy.po(db, z.id)!.status, 'oplachen');
  assert.equal(koshelek.balans(db, PERVYY), 0);
});

test('баланса хватает лишь на часть — остаток ждёт оплаты', () => {
  const db = baza();
  zavesti(db, 'DESYAT', 10, 5);
  koshelek.popolnit(db, PERVYY, 40_000, 'проба', VLADELEC);
  const { zakaz: z } = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'DESYAT'));
  const { spisano, hvatilo } = zakazy.oplatitSBalansa(db, z.id, new Date());

  assert.equal(spisano, 40_000);
  assert.equal(hvatilo, false);
  const svezhy = zakazy.po(db, z.id)!;
  assert.equal(svezhy.status, 'zhdet_oplaty');
  assert.equal(zakazy.kOplate(svezhy) - svezhy.oplacheno_kop, 50_000, 'остаток посчитан без скидки');
});

test('скидка в сто процентов закрывает заказ, не тронув баланс', () => {
  const db = baza();
  zavesti(db, 'DAROM', 100, 1);
  koshelek.popolnit(db, PERVYY, 70_000, 'проба', VLADELEC);
  const { zakaz: z } = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'DAROM'));
  const { spisano, hvatilo } = zakazy.oplatitSBalansa(db, z.id, new Date());

  assert.equal(spisano, 0);
  assert.equal(hvatilo, true);
  assert.equal(zakazy.po(db, z.id)!.status, 'oplachen');
  assert.equal(koshelek.balans(db, PERVYY), 70_000, 'списали деньги за бесплатный заказ');
});

test('оплата администратором берёт сумму СО СКИДКОЙ, а не цену тарифа', () => {
  const db = baza();
  zavesti(db, 'DESYAT', 10, 5);
  const { zakaz: z } = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'DESYAT'));
  assert.equal(zakazy.otmetitOplachennym(db, z.id, new Date(), VLADELEC), true);
  const svezhy = zakazy.po(db, z.id)!;
  assert.equal(svezhy.oplacheno_kop, 90_000, 'заказ держит больше, чем с человека взяли');

  // И при отмене вернётся ровно столько же — иначе промокод печатал бы
  // деньги: заказ отдал бы на баланс то, чего никто не платил.
  const itog = zakazy.otmenit(db, z.id, VLADELEC, 'net_deneg');
  assert.equal(itog.vernuli, 90_000);
  assert.equal(koshelek.balans(db, PERVYY), 90_000);
});

// ── принесённый код ──────────────────────────────────────────────────

test('принесённый код перезаписывается, а потраченный забывается', () => {
  const db = baza();
  zavesti(db, 'PERVYY-KOD', 10, 5);
  zavesti(db, 'VTOROY-KOD', 20, 5);

  promo.zapomnitCheloveku(db, PERVYY, 'PERVYY-KOD');
  assert.equal(promo.chelovekPrines(db, PERVYY), 'PERVYY-KOD');
  // Пришёл по новой ссылке — новый код важнее прежнего. Это НЕ метка
  // канала: у той ответ один и навсегда.
  promo.zapomnitCheloveku(db, PERVYY, 'VTOROY-KOD');
  assert.equal(promo.chelovekPrines(db, PERVYY), 'VTOROY-KOD');

  promo.zabytUCheloveka(db, PERVYY);
  assert.equal(promo.chelovekPrines(db, PERVYY), '');
});

// ── статистика ───────────────────────────────────────────────────────

test('выручка считается тем, что взяли, а не ценой по прайсу', () => {
  const db = baza();
  zavesti(db, 'DESYAT', 10, 5);
  const so = zakazy.sozdatIliVernut(db, zakaz(PERVYY, 'kling-pro', 100_000, 'DESYAT')).zakaz;
  const bez = zakazy.sozdatIliVernut(db, zakaz(VTOROY, 'kling-pro', 100_000)).zakaz;
  for (const z of [so, bez]) {
    zakazy.otmetitOplachennym(db, z.id, new Date(), VLADELEC);
    zakazy.otmetitVydannym(db, z.id, null, VLADELEC);
  }
  const st = zakazy.statistika(db);
  assert.equal(st.vyruchkaKop, 90_000 + 100_000, 'скидка не вычтена из выручки');
  assert.equal(st.bezCeny, 0);
});
