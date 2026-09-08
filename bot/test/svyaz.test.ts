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
import { HttpError, GrammyError } from 'grammy';
import { vybratPut, probaSemeystva, PREDPOCHTENIE } from '../src/lib/svyaz.js';
import type { Proba, Semeystvo } from '../src/lib/svyaz.js';
import { sozdatPrismotr, SHAG_ZDOROVYY_MS, SHAG_ZAPASNOY_MS, SHAG_POISKA_MS } from '../src/jobs/svyaz.js';
import { povtorPriObryve } from '../src/lavka.js';

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

test('не отвечает никто — выбора НЕТ, а порядок возвращается к рабочему пути', async () => {
  // Здесь стояло «порядок не трогаем», и это стоило двадцати минут
  // молчания на боевом: прошлый выбор мог быть запасным IPv4, который
  // на этом сервере заблокирован постоянно, — и бот оставался на нём.
  setDefaultResultOrder('ipv4first');
  const p = proba({ 4: false, 6: false });
  const v = await vybratPut('api.telegram.org', p.fn);
  assert.equal(v.vybrano, null, 'неподтверждённый путь — это не выбор');
  assert.equal(v.proby.length, 2);
  assert.equal(getDefaultResultOrder(), 'ipv6first', 'на мёртвом пути не остаёмся');
});

/* ── присмотр за путём ───────────────────────────────────────────── */

/** Проба, у которой можно менять, какое семейство «живо». */
function stend(zhivo: Record<Semeystvo, boolean>) {
  const zvali: Semeystvo[] = [];
  const fn = async (_h: string, s: Semeystvo): Promise<Proba> => {
    zvali.push(s);
    return zhivo[s]
      ? { semeystvo: s, ok: true, adres: s === 6 ? '2001:db8::1' : '192.0.2.1', ms: 11 }
      : { semeystvo: s, ok: false, ms: 5000, oshibka: 'молчание дольше 5000 мс' };
  };
  return { fn, zvali, zhivo };
}

test('живой IPv6: присмотр молчит и смотрит редко', async () => {
  const st = stend({ 4: false, 6: true });
  const p = sozdatPrismotr(6, { proba: st.fn });
  assert.equal(await p.proverit(), 6);
  assert.deepEqual(st.zvali, [6], 'на здоровом пути второе семейство не трогаем');
  assert.equal(p.shagMs(), SHAG_ZDOROVYY_MS);
});

test('НЕ ЗАЛИПАЕМ: молчат оба — путь снимается, а не остаётся заблокированным', async () => {
  setDefaultResultOrder('ipv4first');
  const st = stend({ 4: false, 6: false });
  const p = sozdatPrismotr(4, { proba: st.fn });

  assert.equal(await p.proverit(), null, 'выбор снят, а не оставлен на мёртвом IPv4');
  assert.equal(p.shagMs(), SHAG_POISKA_MS, 'ищем часто, а не раз в десять минут');
  assert.equal(getDefaultResultOrder(), 'ipv6first');

  // И как только IPv6 оживает — следующий же круг его находит.
  st.zhivo[6] = true;
  assert.equal(await p.proverit(), 6);
  assert.equal(p.shagMs(), SHAG_ZDOROVYY_MS);
});

test('секундный отвал IPv6 не уводит на заблокированный IPv4', async () => {
  const st = stend({ 4: false, 6: false });
  const p = sozdatPrismotr(6, { proba: st.fn });
  // IPv6 молчит, IPv4 тоже (он заблокирован постоянно) — переключаться
  // некуда, и переключаться НЕ НАДО.
  assert.equal(await p.proverit(), null);
  st.zhivo[6] = true;
  assert.equal(await p.proverit(), 6, 'вернулись на свой путь, как только он ожил');
});

test('IPv6 отвалился, а IPv4 разблокировали — переходим и проверяем чаще', async () => {
  const st = stend({ 4: true, 6: false });
  const p = sozdatPrismotr(6, { proba: st.fn });
  assert.equal(await p.proverit(), 4);
  assert.equal(getDefaultResultOrder(), 'ipv4first');
  assert.equal(p.shagMs(), SHAG_ZAPASNOY_MS, 'на запасном пути смотрим чаще');
});

test('на запасном пути не засиживаемся: IPv6 вернулся — возвращаемся', async () => {
  const st = stend({ 4: true, 6: true });
  const p = sozdatPrismotr(4, { proba: st.fn });
  assert.equal(await p.proverit(), PREDPOCHTENIE);
  assert.deepEqual(st.zvali, [4, 6], 'запасной путь жив, но основной всё равно проверяем');
  assert.equal(p.shagMs(), SHAG_ZDOROVYY_MS);
});

test('старт без подтверждённого пути: ищем, пока кто-нибудь не ответит', async () => {
  const st = stend({ 4: false, 6: false });
  const p = sozdatPrismotr(null, { proba: st.fn });
  assert.equal(p.shagMs(), SHAG_POISKA_MS);
  assert.equal(await p.proverit(), null);
  assert.equal(await p.proverit(), null, 'молчание не превращается в выбор');
  st.zhivo[6] = true;
  assert.equal(await p.proverit(), 6);
});

/* ── повтор оборвавшегося запроса ────────────────────────────────── */

/** Настоящее тело запроса: подставное не проходит по типам. */
const TELO = { chat_id: 42, text: 'проба' };

test('быстрый обрыв сети повторяется и не доходит до человека', async () => {
  let zvali = 0;
  const povtor = povtorPriObryve(3, 1);
  const itog = await povtor(
    async () => {
      zvali += 1;
      if (zvali < 3) throw new HttpError('сеть', new Error('fetch failed'));
      return { ok: true, result: 'готово' } as never;
    },
    'sendMessage',
    TELO,
    undefined,
  );
  assert.deepEqual(itog, { ok: true, result: 'готово' });
  assert.equal(zvali, 3, 'повторили дважды и дошли');
});

test('отказ самого Telegram не повторяется: ответ не изменится', async () => {
  let zvali = 0;
  const povtor = povtorPriObryve(3, 1);
  await assert.rejects(
    povtor(
      async () => {
        zvali += 1;
        throw new GrammyError(
          'Call to sendMessage failed!',
          { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
          'sendMessage',
          TELO,
        );
      },
      'sendMessage',
      TELO,
      undefined,
    ),
  );
  assert.equal(zvali, 1, 'ни одного лишнего запроса');
});

test('обрыв по таймауту не повторяется: бюджет обработчика уже съеден', async () => {
  let zvali = 0;
  const povtor = povtorPriObryve(3, 1);
  await assert.rejects(
    povtor(
      async () => {
        zvali += 1;
        // Дольше PREDEL_BYSTROGO_MS: так выглядит молчащий путь,
        // а не разорванное соединение.
        await new Promise((gotovo) => setTimeout(gotovo, 2100));
        throw new HttpError('сеть', new Error('timeout'));
      },
      'sendMessage',
      TELO,
      undefined,
    ),
  );
  assert.equal(zvali, 1);
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
