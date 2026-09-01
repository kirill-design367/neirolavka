import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { zashifrovat, rasshifrovat, proveritKlyuch, OshibkaShifra } from '../src/lib/shifr.js';
import { razobratKlyuch } from '../src/config.js';

const KLYUCH = randomBytes(32);

test('туда и обратно', () => {
  const s = 'парол ь с пробелами и кириллицей';
  assert.equal(rasshifrovat(zashifrovat(s, KLYUCH), KLYUCH), s);
});

test('два шифрования одного и того же дают разные строки', () => {
  // Иначе по базе видно, у кого одинаковые пароли.
  assert.notEqual(zashifrovat('одно и то же', KLYUCH), zashifrovat('одно и то же', KLYUCH));
});

test('чужим ключом не расшифровывается', () => {
  const shifr = zashifrovat('секрет', KLYUCH);
  assert.throws(() => rasshifrovat(shifr, randomBytes(32)), OshibkaShifra);
});

test('подменённый шифротекст не превращается в мусор, а честно падает', () => {
  const shifr = zashifrovat('секрет', KLYUCH);
  const chasti = shifr.split('.');
  const telo = Buffer.from(chasti[3] as string, 'base64');
  telo[0] = (telo[0] ?? 0) ^ 0xff;
  chasti[3] = telo.toString('base64');
  assert.throws(() => rasshifrovat(chasti.join('.'), KLYUCH), OshibkaShifra);
});

test('в тексте ошибки нет открытого текста', () => {
  try {
    rasshifrovat(zashifrovat('очень-секретный-пароль', KLYUCH), randomBytes(32));
    assert.fail('должно было упасть');
  } catch (e) {
    assert.equal((e as Error).message.includes('очень-секретный-пароль'), false);
  }
});

test('неизвестный формат отвергается', () => {
  assert.throws(() => rasshifrovat('v2.a.b.c', KLYUCH), OshibkaShifra);
});

test('ключ короче 32 байт не принимается', () => {
  assert.throws(() => razobratKlyuch(randomBytes(16).toString('base64')), /32 байта/);
});

test('ключ принимается и в base64, и в hex', () => {
  assert.equal(razobratKlyuch(KLYUCH.toString('base64')).equals(KLYUCH), true);
  assert.equal(razobratKlyuch(KLYUCH.toString('hex')).equals(KLYUCH), true);
});

test('проверка ключа при старте проходит', () => {
  proveritKlyuch(KLYUCH);
});
