/**
 * Выбор пути к Telegram.
 *
 * Настоящее семейство адресов проверяется на боевом сервере — в среде
 * разработки IPv6 нет вовсе (`listen ::1` падает с EAFNOSUPPORT),
 * и проба по нему проверяла бы отсутствие стека, а не логику выбора.
 * Поэтому здесь подставляется проба, а решение проверяется целиком.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultResultOrder, setDefaultResultOrder } from 'node:dns';
import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { vybratPut, probaSemeystva } from '../src/lib/svyaz.js';
import type { Proba, Semeystvo } from '../src/lib/svyaz.js';

function proba(rabotaet: Record<Semeystvo, boolean>) {
  const zvali: Semeystvo[] = [];
  const fn = async (_h: string, s: Semeystvo): Promise<Proba> => {
    zvali.push(s);
    return rabotaet[s]
      ? { semeystvo: s, ok: true, adres: s === 6 ? '2001:db8::1' : '192.0.2.1', ms: 12 }
      : { semeystvo: s, ok: false, ms: 5000, oshibka: 'молчание дольше 5000 мс' };
  };
  return { fn, zvali };
}

test('работают оба — идём по IPv6 и IPv4 даже не пробуем', async () => {
  setDefaultResultOrder('verbatim');
  const p = proba({ 4: true, 6: true });
  const v = await vybratPut('api.telegram.org', p.fn);
  assert.equal(v.vybrano, 6);
  assert.deepEqual(p.zvali, [6], 'лишнего запроса по IPv4 не делаем');
  assert.equal(getDefaultResultOrder(), 'ipv6first');
});

test('боевой случай: IPv4 молчит, IPv6 отвечает', async () => {
  setDefaultResultOrder('verbatim');
  const p = proba({ 4: false, 6: true });
  const v = await vybratPut('api.telegram.org', p.fn);
  assert.equal(v.vybrano, 6);
  assert.equal(getDefaultResultOrder(), 'ipv6first');
  assert.equal(v.proby[0]?.adres, '2001:db8::1');
});

test('откат: IPv6 отвалился, IPv4 разблокировали', async () => {
  setDefaultResultOrder('ipv6first');
  const p = proba({ 4: true, 6: false });
  const v = await vybratPut('api.telegram.org', p.fn);
  assert.equal(v.vybrano, 4, 'IPv6 не прибит намертво');
  assert.deepEqual(p.zvali, [6, 4], 'IPv6 всё равно пробуем первым');
  assert.equal(getDefaultResultOrder(), 'ipv4first');
});

test('не отвечает никто — честно говорим об этом и порядок не трогаем', async () => {
  setDefaultResultOrder('verbatim');
  const p = proba({ 4: false, 6: false });
  const v = await vybratPut('api.telegram.org', p.fn);
  assert.equal(v.vybrano, null);
  assert.equal(v.proby.length, 2);
  assert.equal(getDefaultResultOrder(), 'verbatim');
});

test('молчащий узел ловится по времени, а не по отказу', async () => {
  // Так выглядит блокировка: соединение принимается (или не отвергается),
  // и дальше тишина. Отличать это от «отказано в соединении» обязательно —
  // лечится оно по-разному, и именно молчание съедает минуты.
  //
  // Сокет, который принимает и молчит, приходится поднимать самим:
  // сетевое окружение разработки отвечает мгновенным отказом даже
  // на заведомо чёрные адреса, и настоящей блокировки в нём не бывает.
  // Сокеты держим сами: у net.Server нет closeAllConnections (это
  // метод http.Server), и close() без этого ждёт открытое соединение
  // вечно — проверка зависает на уборке, а не на предмете проверки.
  const soedineniya: Socket[] = [];
  const molchun = createServer((s) => {
    soedineniya.push(s);
  });
  await new Promise<void>((gotovo) => molchun.listen(0, '127.0.0.1', gotovo));
  const port = (molchun.address() as AddressInfo).port;
  try {
    const p = await probaSemeystva('127.0.0.1', 4, 600, port);
    assert.equal(p.ok, false);
    assert.match(String(p.oshibka), /молчание/);
    assert.ok(p.ms >= 550, `упёрлись за ${p.ms} мс, а предел был 600`);
  } finally {
    for (const s of soedineniya) s.destroy();
    await new Promise<void>((gotovo) => molchun.close(() => gotovo()));
  }
});

test('несуществующее имя — это отказ разбора, а не молчание', async () => {
  const p = await probaSemeystva('takogo-imeni-net.neirolavka-proba', 4, 3000);
  assert.equal(p.ok, false);
  assert.match(String(p.oshibka), /ENOTFOUND|EAI_AGAIN|getaddrinfo/);
});
