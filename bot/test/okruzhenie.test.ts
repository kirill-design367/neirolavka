/**
 * Файл окружения: разбор и то, ради чего он написан.
 *
 * Написан он не ради удобства. Пока проба оплаты подключала файл
 * оболочкой (`. /etc/neirolavka-bot/okruzhenie`), при каждом запуске
 * на экран уезжал ключ хранилища: bash выполняет строку, которую
 * не может прочесть как присваивание, и печатает её обратно вместе
 * с содержимым. Разбор не выполняет ничего, а приставка отсекает
 * всё, кроме Робокассы, — секрету неоткуда взяться в процессе.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { razobrat, tolkoS } from '../src/lib/okruzhenie.js';

test('обычные строки читаются, примечания и пустые пропускаются', () => {
  const { pary, plohie } = razobrat(
    ['# примечание', '', '  ; тоже примечание', 'A=1', 'B=два слова', 'C='].join('\n'),
  );
  assert.deepEqual(pary, { A: '1', B: 'два слова', C: '' });
  assert.deepEqual(plohie, []);
});

test('кавычки вокруг значения снимаются, как это делает systemd', () => {
  const { pary } = razobrat(['A="раз"', "B='два'", 'C="не закрыта'].join('\n'));
  assert.equal(pary['A'], 'раз');
  assert.equal(pary['B'], 'два');
  assert.equal(pary['C'], '"не закрыта');
});

test('знак равенства внутри значения значением и остаётся', () => {
  const { pary } = razobrat('KLYUCH=abc==\n');
  assert.equal(pary['KLYUCH'], 'abc==');
});

test('СЪЕХАВШЕЕ НА СВОЮ СТРОКУ ЗНАЧЕНИЕ — это негодная строка, и её номер называется', () => {
  /* Ровно тот случай, из-за которого секрет печатался на экран:
     длинный токен вставили с переносом, и вторая половина осталась
     строкой без знака равенства. Для bash это команда. */
  const { pary, plohie } = razobrat(['A=1', 'KLYUCH=', 'github_pat_SEKRET', 'B=2'].join('\n'));
  assert.deepEqual(plohie, [3]);
  assert.equal(pary['KLYUCH'], '');
  assert.equal(pary['B'], '2', 'разбор обязан продолжиться после негодной строки');
});

test('пробелы вокруг «=» и export — тоже негодные строки: systemd их не понимает', () => {
  const { plohie } = razobrat(['A = 1', 'export B=2', 'C=3'].join('\n'));
  assert.deepEqual(plohie, [1, 2]);
});

test('приставка отсекает всё, кроме Робокассы', () => {
  const pary = {
    NEIROLAVKA_TOKEN_BOTA: 'sekret-tokena',
    NEIROLAVKA_KLYUCH_HRANILISHCHA: 'sekret-hranilishcha',
    NEIROLAVKA_KLYUCH_DOSTUPOV: 'sekret-dostupov',
    NEIROLAVKA_ROBOKASSA_LOGIN: 'Neirolavka',
    NEIROLAVKA_ROBOKASSA_PAROL1: 'p1',
  };
  const tolko = tolkoS(pary, 'NEIROLAVKA_ROBOKASSA_');
  assert.deepEqual(Object.keys(tolko).sort(), ['NEIROLAVKA_ROBOKASSA_LOGIN', 'NEIROLAVKA_ROBOKASSA_PAROL1']);
  // Главное утверждение всего файла: чужих секретов в отобранном нет.
  assert.ok(!JSON.stringify(tolko).includes('sekret-tokena'));
  assert.ok(!JSON.stringify(tolko).includes('sekret-hranilishcha'));
  assert.ok(!JSON.stringify(tolko).includes('sekret-dostupov'));
});

test('BOM в начале файла не делает первую строку негодной', () => {
  const { pary, plohie } = razobrat('﻿A=1\n');
  assert.deepEqual(plohie, []);
  assert.equal(pary['A'], '1');
});

test('перевод строки Windows не попадает в значение', () => {
  const { pary } = razobrat('A=1\r\nB=2\r\n');
  assert.equal(pary['A'], '1');
  assert.equal(pary['B'], '2');
});
