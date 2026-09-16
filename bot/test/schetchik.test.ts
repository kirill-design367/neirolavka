/**
 * Счётчик подписок для шапки сайта.
 *
 * Строка «Уже N пользователей оформили подписки» стояла числом
 * в коде. Теперь сайт спрашивает бота, и весь вопрос в том, ЧТО
 * именно считать: строка обещает свершившийся факт, а заказ
 * заводится нажатием кнопки на сайте ещё до всякой оплаты.
 *
 * Считаются ВЫДАННЫЕ, и проверяется это с трёх сторон сразу:
 *   • заведённый и даже оплаченный заказ счётчика НЕ трогает —
 *     иначе число накручивалось бы нажатием кнопки даром;
 *   • выданный трогает;
 *   • ряд НЕУБЫВАЮЩИЙ: отменённый оплаченный заказ не отнимает
 *     единицы, потому что и не прибавлял её.
 *
 * Плюс две вещи про сам путь: он не пишет в базу (GET и только GET)
 * и держит ответ минуту — он спрашивается на каждой загрузке
 * витрины, а не по действию человека.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zakazy from '../src/db/zakazy.js';
import * as lyudi from '../src/db/lyudi.js';
import { zabytSchetchik } from '../src/server.js';
import { tarif } from '../src/lib/katalog.js';
import type { Stend } from './stend.js';
import { stend, VLADELEC, POKUPATEL, ZHIVOY_PLAN } from './stend.js';

/** Спросить счётчик, забыв посчитанное: у каждой пробы своя база. */
async function sprosit(s: Stend): Promise<{ otvet: Response; vydano: unknown }> {
  zabytSchetchik();
  const otvet = await fetch(`${s.koren}/api/schetchik`);
  const telo = (await otvet.json()) as { vydano?: unknown };
  return { otvet, vydano: telo.vydano };
}

/** Завести заказ и довести его до нужного состояния. */
function zakaz(s: Stend, tgId: number): zakazy.Zakaz {
  lyudi.zapomnit(s.l.db, tgId, 'Pokupatel', null);
  const t = tarif(s.l.db, ZHIVOY_PLAN);
  assert.ok(t, 'уровень подписки из каталога');
  const { zakaz: z } = zakazy.sozdatIliVernut(s.l.db, {
    tgId,
    produktId: t!.product.id,
    planId: t!.plan.id,
    nazvanie: `${t!.product.name} · ${t!.plan.title}`,
    cenaKop: 100_000,
    mesyacev: 0,
    vidAkkaunta: 'novy',
  });
  return z;
}

test('пустая лавка отвечает нулём, а не пустотой', async () => {
  const s = await stend();
  try {
    const { otvet, vydano } = await sprosit(s);
    assert.equal(otvet.status, 200);
    assert.equal(vydano, 0, 'выданных заказов нет');
    // Минута кеша объявлена браузеру тем же числом, что живёт
    // в памяти процесса: два срока годности на одно значение
    // разъехались бы.
    assert.match(otvet.headers.get('cache-control') ?? '', /max-age=60/);
    assert.equal(otvet.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await s.zakryt();
  }
});

test('ОФОРМЛЕННЫЙ И ОПЛАЧЕННЫЙ заказ счётчика не трогает, выданный — трогает', async () => {
  const s = await stend();
  try {
    const z = zakaz(s, POKUPATEL);
    assert.equal((await sprosit(s)).vydano, 0, 'оформленный не считается');

    zakazy.otmetitOplachennym(s.l.db, z.id, new Date('2026-09-20T10:00:00Z'), VLADELEC);
    assert.equal((await sprosit(s)).vydano, 0, 'ОПЛАЧЕННЫЙ ещё не считается');

    zakazy.vzyat(s.l.db, z.id, VLADELEC);
    assert.equal((await sprosit(s)).vydano, 0, 'взятый в работу ещё не считается');

    assert.equal(zakazy.otmetitVydannym(s.l.db, z.id, null, VLADELEC), true);
    assert.equal((await sprosit(s)).vydano, 1, 'а вот выданный — считается');
  } finally {
    await s.zakryt();
  }
});

test('РЯД НЕУБЫВАЮЩИЙ: отменённый оплаченный заказ единицы не отнимает', async () => {
  const s = await stend();
  try {
    // Один заказ выдан — счётчик его засчитал.
    const vydannyy = zakaz(s, POKUPATEL);
    zakazy.otmetitOplachennym(s.l.db, vydannyy.id, new Date('2026-09-20T10:00:00Z'), VLADELEC);
    zakazy.vzyat(s.l.db, vydannyy.id, VLADELEC);
    zakazy.otmetitVydannym(s.l.db, vydannyy.id, null, VLADELEC);
    assert.equal((await sprosit(s)).vydano, 1);

    // Второй оплачен и отменён. Считай мы оплаченные — счётчик
    // сперва показал бы 2, а потом вернулся к 1: число на витрине,
    // которое уменьшается, человек читает как поломку.
    const otmenennyy = zakaz(s, POKUPATEL + 1);
    zakazy.otmetitOplachennym(s.l.db, otmenennyy.id, new Date('2026-09-20T10:00:00Z'), VLADELEC);
    const itog = zakazy.otmenit(s.l.db, otmenennyy.id, VLADELEC, 'net_deneg');
    assert.equal(itog.otmenen, true, 'оплаченный заказ отменяется');
    assert.equal((await sprosit(s)).vydano, 1, 'счётчик не двинулся ни вверх, ни вниз');

    // И сам выданный отменить нельзя — ряд не может поехать вниз
    // даже руками владельца.
    const po = zakazy.otmenit(s.l.db, vydannyy.id, VLADELEC, 'net_deneg');
    assert.equal(po.otmenen, false, 'выданный заказ не отменяется');
    assert.equal((await sprosit(s)).vydano, 1);
  } finally {
    await s.zakryt();
  }
});

test('счётчик ничего не пишет и не заводит: только GET', async () => {
  const s = await stend();
  try {
    const z = zakaz(s, POKUPATEL);
    zakazy.otmetitOplachennym(s.l.db, z.id, new Date('2026-09-20T10:00:00Z'), VLADELEC);
    zakazy.vzyat(s.l.db, z.id, VLADELEC);
    zakazy.otmetitVydannym(s.l.db, z.id, null, VLADELEC);

    const bylo = s.l.db.prepare('SELECT COUNT(*) n FROM zakazy').get() as { n: number };
    const post = await fetch(`${s.koren}/api/schetchik`, { method: 'POST', body: '{}' });
    assert.equal(post.status, 405, 'заводить тут нечего — путь только для чтения');
    await sprosit(s);
    const stalo = s.l.db.prepare('SELECT COUNT(*) n FROM zakazy').get() as { n: number };
    assert.equal(stalo.n, bylo.n, 'ни одной новой строки');
  } finally {
    await s.zakryt();
  }
});

test('ответ держится минуту: спрашивают его на каждой загрузке витрины', async () => {
  const s = await stend();
  try {
    zabytSchetchik();
    const pervyy = await (await fetch(`${s.koren}/api/schetchik`)).json();
    assert.equal((pervyy as { vydano: number }).vydano, 0);

    // Выдаём заказ и спрашиваем СНОВА, не сбрасывая память.
    const z = zakaz(s, POKUPATEL);
    zakazy.otmetitOplachennym(s.l.db, z.id, new Date('2026-09-20T10:00:00Z'), VLADELEC);
    zakazy.vzyat(s.l.db, z.id, VLADELEC);
    zakazy.otmetitVydannym(s.l.db, z.id, null, VLADELEC);

    const vtoroy = await (await fetch(`${s.koren}/api/schetchik`)).json();
    assert.equal((vtoroy as { vydano: number }).vydano, 0, 'в пределах минуты отдаётся посчитанное');

    // А забыв посчитанное — видим новое число. То есть это кеш,
    // а не потерянный запрос к базе.
    assert.equal((await sprosit(s)).vydano, 1);
  } finally {
    await s.zakryt();
  }
});
