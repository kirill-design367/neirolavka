import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chasti,
  moment,
  rabocheeVremya,
  blizhayshieeOtkrytie,
  srokVydachi,
  sklonenie,
  dostupDo,
} from '../src/lib/vremya.js';

const R = { poyas: 'Europe/Moscow', rabotaS: 8, rabotaDo: 23, obeshchanieMinut: 60 };

test('разбор момента идёт в объявленном поясе, а не в поясе машины', () => {
  // 2026-09-01T05:00:00Z — это 08:00 в Москве.
  const c = chasti(new Date('2026-09-01T05:00:00Z'), 'Europe/Moscow');
  assert.equal(c.chas, 8);
  assert.equal(c.den, 1);
  assert.equal(c.mesyac, 9);
});

test('момент по стенным часам пояса', () => {
  const d = moment({ god: 2026, mesyac: 9, den: 1, chas: 8 }, 'Europe/Moscow');
  assert.equal(d.toISOString(), '2026-09-01T05:00:00.000Z');
});

test('рабочее время считается по границам из настроек', () => {
  assert.equal(rabocheeVremya(new Date('2026-09-01T04:59:00Z'), R), false); // 07:59 мск
  assert.equal(rabocheeVremya(new Date('2026-09-01T05:00:00Z'), R), true); // 08:00
  assert.equal(rabocheeVremya(new Date('2026-09-01T19:59:00Z'), R), true); // 22:59
  assert.equal(rabocheeVremya(new Date('2026-09-01T20:00:00Z'), R), false); // 23:00
});

test('ближайшее открытие: сегодня до открытия, завтра после закрытия', () => {
  const utro = blizhayshieeOtkrytie(new Date('2026-09-01T03:00:00Z'), R); // 06:00 мск
  assert.equal(utro.toISOString(), '2026-09-01T05:00:00.000Z');
  const noch = blizhayshieeOtkrytie(new Date('2026-09-01T21:00:00Z'), R); // 00:00 мск 2-го
  assert.equal(noch.toISOString(), '2026-09-02T05:00:00.000Z');
});

test('ближайшее открытие переносится через край месяца', () => {
  const d = blizhayshieeOtkrytie(new Date('2026-09-30T21:00:00Z'), R); // 00:00 мск 1 октября
  assert.equal(d.toISOString(), '2026-10-01T05:00:00.000Z');
});

test('в рабочее время обещаем срок от текущего момента', () => {
  const s = srokVydachi(new Date('2026-09-01T09:00:00Z'), R); // 12:00 мск
  assert.equal(s.utrom, false);
  assert.equal(s.do.toISOString(), '2026-09-01T10:00:00.000Z');
});

test('ночью обещаем утро, а не час', () => {
  const s = srokVydachi(new Date('2026-09-01T22:00:00Z'), R); // 01:00 мск
  assert.equal(s.utrom, true);
  assert.equal(s.do.toISOString(), '2026-09-02T06:00:00.000Z');
});

test('заказ перед закрытием уезжает на утро: час до закрытия не помещается', () => {
  // 22:50 мск — лавка закрывается через десять минут.
  const s = srokVydachi(new Date('2026-09-01T19:50:00Z'), R);
  assert.equal(s.utrom, true);
  assert.equal(s.do.toISOString(), '2026-09-02T06:00:00.000Z');
});

test('заказ ровно за час до закрытия ещё помещается', () => {
  const s = srokVydachi(new Date('2026-09-01T19:00:00Z'), R); // 22:00 мск
  assert.equal(s.utrom, false);
});

test('круглосуточное расписание не роняет расчёт', () => {
  const sutki = { ...R, rabotaS: 0, rabotaDo: 24 };
  const s = srokVydachi(new Date('2026-09-01T22:30:00Z'), sutki);
  assert.equal(s.utrom, false);
});

test('склонение по числу', () => {
  assert.equal(sklonenie(1, 'минута', 'минуты', 'минут'), '1 минута');
  assert.equal(sklonenie(2, 'минута', 'минуты', 'минут'), '2 минуты');
  assert.equal(sklonenie(5, 'минута', 'минуты', 'минут'), '5 минут');
  assert.equal(sklonenie(11, 'минута', 'минуты', 'минут'), '11 минут');
  assert.equal(sklonenie(21, 'минута', 'минуты', 'минут'), '21 минута');
});

test('срок доступа считается месяцами', () => {
  assert.equal(dostupDo(new Date('2026-09-01T00:00:00Z'), 1).toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(dostupDo(new Date('2026-09-01T00:00:00Z'), 12).toISOString(), '2027-09-01T00:00:00.000Z');
});
