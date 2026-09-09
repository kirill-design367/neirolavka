/**
 * Доставка обновлений: вебхук или опрос.
 *
 * Проверяется то, из-за чего бот однажды оглох на сутки: Telegram
 * не мог достучаться до вебхука, а бот считал себя работающим —
 * обработчики просто не запускались, и в журнале было пусто.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GrammyError } from 'grammy';
import { razobrat, SVEZHEST_S } from '../src/jobs/dostavka.js';
import { gasitProtuhshieNazhatiya } from '../src/lavka.js';
import * as zakazy from '../src/db/zakazy.js';
import { stend, poslat, SEKRET, POKUPATEL, nazhatie, ZHIVOY_PLAN } from './stend.js';

const SEYCHAS = 1_800_000_000;

test('очередь растёт, а доставка падает — это отказ вебхука', () => {
  const v = razobrat(
    {
      url: 'https://neirolavka.ru/tg/sekret',
      pending_update_count: 6,
      last_error_date: SEYCHAS - 60,
      last_error_message: 'Connection timed out',
      ip_address: '5.42.123.35',
    },
    SEYCHAS,
  );
  assert.equal(v.perehodit, true);
  assert.match(v.pochemu, /Connection timed out/);
  assert.match(v.pochemu, /5\.42\.123\.35/);
});

test('пустая очередь — доставка идёт, что бы ни лежало в прошлых ошибках', () => {
  const v = razobrat(
    {
      url: 'https://neirolavka.ru/tg/sekret',
      pending_update_count: 0,
      last_error_date: SEYCHAS - 10,
      last_error_message: 'Connection timed out',
    },
    SEYCHAS,
  );
  assert.equal(v.perehodit, false);
});

test('старая ошибка при непустой очереди — память об аварии, а не авария', () => {
  const v = razobrat(
    {
      url: 'https://neirolavka.ru/tg/sekret',
      pending_update_count: 3,
      last_error_date: SEYCHAS - SVEZHEST_S - 60,
      last_error_message: 'Connection timed out',
    },
    SEYCHAS,
  );
  assert.equal(v.perehodit, false);
});

test('очередь без единой ошибки — это всплеск, который разгребается', () => {
  const v = razobrat({ url: 'https://neirolavka.ru/tg/sekret', pending_update_count: 12 }, SEYCHAS);
  assert.equal(v.perehodit, false);
});

test('вебхук не объявлен — переходить не с чего', () => {
  const v = razobrat({ pending_update_count: 99, last_error_date: SEYCHAS }, SEYCHAS);
  assert.equal(v.perehodit, false);
});

test('опрос забирает обновления сам, и накопленное не выбрасывается', async () => {
  const s = await stend();
  try {
    // Подставной Telegram отдаёт пачку накопленного ПЕРВЫМ же ответом
    // на getUpdates — ровно так приходит очередь, копившаяся, пока
    // вебхук не работал. Дальше он молчит: опрос ждёт, а проверке
    // больше ничего не нужно.
    let otdal = false;
    s.tg.otvechat = (metod) => {
      if (metod !== 'getUpdates') return { vid: 'ok' };
      if (otdal) return { vid: 'zavisnet' };
      otdal = true;
      return { vid: 'ok', rezultat: [nazhatie(`nov:${ZHIVOY_PLAN}`)] };
    };

    // Через ту же ссылку, что и в бою: bot.start уже подменён
    // вебхук-обработчиком, который создал стенд.
    void s.l.nachatOpros({
      timeout: 1,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });

    // Ждём, пока обновление доедет и превратится в заказ.
    const srok = Date.now() + 5_000;
    let spisok = zakazy.cheloveka(s.l.db, POKUPATEL);
    while (!spisok.length && Date.now() < srok) {
      await new Promise((gotovo) => setTimeout(gotovo, 25));
      spisok = zakazy.cheloveka(s.l.db, POKUPATEL);
    }
    assert.equal(spisok.length, 1, 'обновление, забранное опросом, обработано');

    // Вебхук снят — и снят БЕЗ выбрасывания накопленного: иначе смена
    // способа доставки стоила бы чужих оплаченных заказов.
    const snyatie = s.tg.vyzovy.filter((v) => v.metod === 'deleteWebhook');
    assert.equal(snyatie.length >= 1, true, 'вебхук должен быть снят перед опросом');
    for (const v of snyatie) {
      assert.notEqual(v.telo['drop_pending_updates'], true, 'накопленное выброшено');
    }
  } finally {
    // Остановка опроса САМА ходит в Telegram: grammY отправляет
    // последний getUpdates, чтобы запомнить смещение. Пока подставной
    // молчит, остановка упирается в предел запроса — поэтому сначала
    // возвращаем ему голос.
    s.tg.otvechat = () => ({ vid: 'ok', rezultat: [] });
    await s.l.bot.stop();
    await s.zakryt();
  }
});

test('пришедший вебхук на опросе получает отказ, а не вторую обработку', async () => {
  const s = await stend();
  try {
    s.sostoyanie.dostavka = 'opros';
    const otvet = await poslat(s.adres, SEKRET, nazhatie(`nov:${ZHIVOY_PLAN}`));
    assert.equal(otvet.kod, 409);
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 0, 'заказ не создан вторым путём');
  } finally {
    await s.zakryt();
  }
});

test('протухшее нажатие считается отвеченным: работа важнее часиков на кнопке', async () => {
  const gasit = gasitProtuhshieNazhatiya();
  const staroe = new GrammyError(
    'Call to answerCallbackQuery failed!',
    {
      ok: false,
      error_code: 400,
      description: 'Bad Request: query is too old and response timeout expired or query ID is invalid',
    },
    'answerCallbackQuery',
    { callback_query_id: '1' },
  );
  const itog = await gasit(
    async () => {
      throw staroe;
    },
    'answerCallbackQuery',
    { callback_query_id: '1' },
    undefined,
  );
  assert.deepEqual(itog, { ok: true, result: true });
});

test('любой другой отказ Telegram гасить нельзя', async () => {
  const gasit = gasitProtuhshieNazhatiya();
  await assert.rejects(
    gasit(
      async () => {
        throw new GrammyError(
          'Call to sendMessage failed!',
          { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
          'sendMessage',
          { chat_id: 1, text: 'проба' },
        );
      },
      'sendMessage',
      { chat_id: 1, text: 'проба' },
      undefined,
    ),
  );
});
