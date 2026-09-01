import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { prochitat, adresVebhuka, putVebhuka } from '../src/config.js';

const BAZOVOE = {
  NEIROLAVKA_TOKEN_BOTA: '123456:proba',
  NEIROLAVKA_SEKRET_VEBHUKA: 'sekret-dlinnyy-dostatochno',
  NEIROLAVKA_KLYUCH_DOSTUPOV: randomBytes(32).toString('base64'),
  NEIROLAVKA_VLADELCY: '1369202079',
};

test('значения по умолчанию — часы работы лавки', () => {
  const n = prochitat({ ...BAZOVOE });
  assert.equal(n.rabotaS, 8);
  assert.equal(n.rabotaDo, 23);
  assert.equal(n.poyas, 'Europe/Moscow');
  assert.equal(n.obeshchanieMinut, 60);
  assert.deepEqual(n.vladelcy, [1369202079]);
  assert.deepEqual(n.pomoshniki, []);
});

test('без токена не поднимаемся', () => {
  assert.throws(() => prochitat({ ...BAZOVOE, NEIROLAVKA_TOKEN_BOTA: '' }), /NEIROLAVKA_TOKEN_BOTA/);
});

test('без владельца не поднимаемся: бот остался бы без хозяина', () => {
  assert.throws(() => prochitat({ ...BAZOVOE, NEIROLAVKA_VLADELCY: '' }), /без администратора/);
});

test('помощники читаются списком', () => {
  const n = prochitat({ ...BAZOVOE, NEIROLAVKA_POMOSHNIKI: '111, 222 333' });
  assert.deepEqual(n.pomoshniki, [111, 222, 333]);
});

test('мусор в списке идентификаторов не проглатывается', () => {
  assert.throws(() => prochitat({ ...BAZOVOE, NEIROLAVKA_POMOSHNIKI: 'вася' }), /не похоже/);
});

test('перевёрнутые часы работы отвергаются', () => {
  assert.throws(
    () => prochitat({ ...BAZOVOE, NEIROLAVKA_RABOTA_S: '23', NEIROLAVKA_RABOTA_DO: '8' }),
    /часы работы/,
  );
});

test('адрес вебхука собирается из адреса сайта и секрета', () => {
  const n = prochitat({ ...BAZOVOE, NEIROLAVKA_ADRES: 'https://neirolavka.ru/' });
  assert.equal(adresVebhuka(n), 'https://neirolavka.ru/tg/sekret-dlinnyy-dostatochno');
  assert.equal(putVebhuka(n), '/tg/sekret-dlinnyy-dostatochno');
});
