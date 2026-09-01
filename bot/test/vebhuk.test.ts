/**
 * Вебхук под отказами.
 *
 * Проверяется главное свойство: Telegram доставляет обновления
 * ПОСЛЕДОВАТЕЛЬНО и не присылает следующее, пока не получил ответ
 * на предыдущее. Значит одно обновление, оставшееся без ответа,
 * останавливает бота целиком — и это не рассуждение, а то, что
 * уже случилось на боевом сервере.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREDEL_OBRABOTKI_MS } from '../src/server.js';
import * as zakazy from '../src/db/zakazy.js';
import { stend, poslat, SEKRET, VLADELEC, POKUPATEL, nazhatie, soobshchenie } from './stend.js';

test('администратор не запускал бота: заказ всё равно принят, очередь не встала', async () => {
  const s = await stend();
  try {
    // Ровно то, что было на боевом: любое сообщение владельцу
    // отвергается Telegram, потому что он не начинал разговор с ботом.
    s.tg.otvechat = (metod, telo) =>
      metod === 'sendMessage' && telo['chat_id'] === VLADELEC
        ? { vid: 'oshibka', kod: 400, opisanie: 'Bad Request: chat not found' }
        : { vid: 'ok' };

    const zakaz = await poslat(s.adres, SEKRET, nazhatie('of:claude-pro-1m'));
    assert.equal(zakaz.kod, 200, 'Telegram обязан получить ответ');
    assert.ok(zakaz.ms < PREDEL_OBRABOTKI_MS, `ответ за ${zakaz.ms} мс, а не по таймауту`);

    // Заказ должен существовать несмотря на неудачу уведомления.
    const spisok = zakazy.cheloveka(s.l.db, POKUPATEL);
    assert.equal(spisok.length, 1, 'заказ покупателя записан');

    // И следующее обновление обрабатывается как ни в чём не бывало.
    const dalshe = await poslat(s.adres, SEKRET, soobshchenie('Мои заказы'));
    assert.equal(dalshe.kod, 200);
    assert.ok(dalshe.ms < PREDEL_OBRABOTKI_MS);
  } finally {
    await s.zakryt();
  }
});

test('исключение внутри обработчика не оставляет Telegram без ответа', async () => {
  const s = await stend();
  try {
    // Подстановка: ломаем обработчик изнутри, как просит условие
    // приёмки. Первое же обновление уходит в исключение.
    s.l.bot.use(async () => {
      throw new Error('нарочная поломка для проверки');
    });

    const slomannoe = await poslat(s.adres, SEKRET, soobshchenie('что угодно'));
    assert.equal(slomannoe.kod, 200, 'ответ отдан даже на упавшем обработчике');
    assert.ok(slomannoe.ms < PREDEL_OBRABOTKI_MS);

    const sleduyushchee = await poslat(s.adres, SEKRET, soobshchenie('и ещё раз'));
    assert.equal(sleduyushchee.kod, 200, 'следующее обновление обрабатывается как обычно');
    assert.ok(sleduyushchee.ms < PREDEL_OBRABOTKI_MS);
  } finally {
    await s.zakryt();
  }
});

test('зависший Telegram не держит очередь дольше предела обработки', async () => {
  const s = await stend();
  try {
    // Сервер, до которого запрос дошёл и ответ не вернулся, — самый
    // опасный вид отказа: он не бросает исключения, он просто ждёт.
    s.tg.otvechat = (metod) => (metod === 'sendMessage' ? { vid: 'zavisnet' } : { vid: 'ok' });

    const zakaz = await poslat(s.adres, SEKRET, nazhatie('of:claude-pro-1m'));
    assert.equal(zakaz.kod, 200);
    assert.ok(
      zakaz.ms < PREDEL_OBRABOTKI_MS + 2_000,
      `ответ за ${zakaz.ms} мс, предел ${PREDEL_OBRABOTKI_MS}`,
    );
  } finally {
    await s.zakryt();
  }
});

test('повторная доставка того же обновления не создаёт второго заказа', async () => {
  const s = await stend();
  try {
    const odno = nazhatie('of:claude-pro-1m');
    const a = await poslat(s.adres, SEKRET, odno);
    const b = await poslat(s.adres, SEKRET, odno);
    assert.equal(a.kod, 200);
    assert.equal(b.kod, 200);
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 1, 'заказ ровно один');
  } finally {
    await s.zakryt();
  }
});

test('чужой секрет в заголовке не пускают', async () => {
  const s = await stend();
  try {
    const chuzhoy = await poslat(s.adres, 'ne-tot-sekret', soobshchenie('привет'));
    assert.equal(chuzhoy.kod, 401);
  } finally {
    await s.zakryt();
  }
});
