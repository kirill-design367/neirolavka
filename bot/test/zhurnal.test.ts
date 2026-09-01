import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skryt, bezSekretov } from '../src/lib/zhurnal.js';

test('зарегистрированный секрет не проходит в журнал', () => {
  skryt('123456:AAHtoken-bota-nastoyashchiy');
  const s = bezSekretov('запрос к https://api.telegram.org/bot123456:AAHtoken-bota-nastoyashchiy/getMe упал');
  assert.equal(s.includes('AAHtoken'), false);
  assert.equal(s.includes('‹скрыто›'), true);
});

test('секрет вырезается из строки во всех местах', () => {
  skryt('sekret-vebhuka-dlinnyy');
  const s = bezSekretov('/tg/sekret-vebhuka-dlinnyy и ещё раз /tg/sekret-vebhuka-dlinnyy');
  assert.equal(s.includes('sekret-vebhuka'), false);
});

test('короткие строки секретами не считаются: иначе вырежется полтекста', () => {
  skryt('ab');
  assert.equal(bezSekretov('таблица'), 'таблица');
});
