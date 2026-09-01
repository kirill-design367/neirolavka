/**
 * Точка входа.
 *
 * Бот работает вебхуком, а не опросом: Telegram сам стучится на 443,
 * nginx проксирует на петлю. Опрос держал бы постоянное исходящее
 * соединение и просыпался бы вхолостую круглые сутки ради десятка
 * заказов.
 *
 * Порядок подъёма выбран так, чтобы поломка обнаруживалась ДО того,
 * как её увидит покупатель:
 *
 *   1. настройки — нет токена или ключа, дальше идти незачем;
 *   2. ключ шифрования проверяется туда-обратно;
 *   3. база открывается и мигрируется;
 *   4. команда засевается из окружения;
 *   5. и только потом бот объявляет Telegram свой адрес.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot, webhookCallback } from 'grammy';
import { prochitat, adresVebhuka, putVebhuka } from './config.js';
import { otkrytBazu } from './db/index.js';
import { zaseyat } from './db/komanda.js';
import { proveritKlyuch } from './lib/shifr.js';
import { zhurnal, skryt } from './lib/zhurnal.js';
import { sobrat } from './bot/index.js';
import { zapustit as zapustitNapominaniya } from './jobs/napominaniya.js';
import { zaglushka } from './oplata/zaglushka.js';
import type { Lavka } from './lavka.js';

async function glavnaya(): Promise<void> {
  const n = prochitat(process.env);
  // Регистрируем секреты до первой строки журнала: дальше они
  // не смогут просочиться даже через чужую трассировку.
  skryt(n.token, n.sekretVebhuka, n.klyuchDostupov.toString('base64'), n.klyuchDostupov.toString('hex'));

  proveritKlyuch(n.klyuchDostupov);
  zhurnal.info('ключ доступов проходит проверку');

  const db = otkrytBazu(n.baza);
  zaseyat(db, n.vladelcy, n.pomoshniki);
  zhurnal.info(`база открыта: ${n.baza}`);

  const bot = new Bot(n.token);
  const l: Lavka = { db, n, bot, oplata: zaglushka };
  sobrat(l);

  // init() до сервера: до неё бот не знает своего имени и не может
  // разбирать команды вида /start@imya_bota. Строка перед вызовом —
  // не украшение: если Telegram недоступен, grammy повторяет запрос
  // молча, и без неё в журнале не видно, на чём бот встал.
  zhurnal.info('спрашиваю Telegram, кто я');
  await bot.init();
  zhurnal.info(`бот: @${bot.botInfo.username}`);

  const obrabotchik = webhookCallback(bot, 'http', {
    secretToken: n.sekretVebhuka,
    // Долгий обработчик не должен доводить Telegram до повтора:
    // отвечаем 200 и доделываем начатое. От двойной работы спасает
    // отсев повторов по update_id.
    onTimeout: 'return',
    timeoutMilliseconds: 25_000,
  });

  // Отметка выпуска. Кладётся выкладкой рядом с кодом; выкладка потом
  // спрашивает её у живого бота и так убеждается, что перезапустился
  // именно новый выпуск, а не остался работать прежний.
  let vypusk = 'неизвестен';
  try {
    vypusk = readFileSync(new URL('../../../vypusk', import.meta.url), 'utf8').trim() || 'неизвестен';
  } catch {
    // Запуск из исходников без выкладки — это нормально.
  }

  const put = putVebhuka(n);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const adres = (req.url ?? '').split('?')[0];
    if (adres === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('жив');
      return;
    }
    if (adres === '/vypusk') {
      // Наружу не проксируется: спрашивает только выкладка с самого
      // сервера. Снаружи знать номер выпуска незачем.
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(vypusk);
      return;
    }
    if (adres === put && req.method === 'POST') {
      void obrabotchik(req, res);
      return;
    }
    if (adres === '/yookassa') {
      // Место под уведомления об оплате. Пока поставщик — заглушка,
      // и разбирать нечего: отвечаем «принято», чтобы никто не копил
      // очередь повторов, но ничего не делаем.
      zhurnal.vnimanie('пришло уведомление об оплате, а оплата не подключена');
      res.writeHead(200).end('ok');
      return;
    }
    // Всё остальное — не наше. Ни намёка на то, что здесь бот.
    res.writeHead(404).end();
  });

  // Слушаем ТОЛЬКО петлю: наружу порт не открыт и открывать его
  // не нужно — вебхуки приходят на 443 и проксируются сюда.
  server.listen(n.port, '127.0.0.1', () => {
    zhurnal.info(`слушаю 127.0.0.1:${n.port}${put.replace(/\/[^/]+$/, '/‹секрет›')}, выпуск ${vypusk}`);
  });

  await bot.api.setWebhook(adresVebhuka(n), {
    secret_token: n.sekretVebhuka,
    // Пропущенные за время простоя обновления НЕ выбрасываем: там
    // могут быть заказы.
    drop_pending_updates: false,
    allowed_updates: ['message', 'callback_query'],
  });
  zhurnal.info('вебхук объявлен Telegram');

  zapustitNapominaniya(l);

  const ostanovka = (signal: string) => {
    zhurnal.info(`${signal}: останавливаюсь`);
    server.close(() => {
      try {
        db.close();
      } catch (e) {
        zhurnal.oshibka('база не закрылась:', e);
      }
      process.exit(0);
    });
    // Если соединения не отпускают, ждём недолго и выходим сами:
    // systemd всё равно прибьёт по таймауту, но выйти самому чище.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => ostanovka('SIGTERM'));
  process.on('SIGINT', () => ostanovka('SIGINT'));
}

glavnaya().catch((e) => {
  zhurnal.oshibka('бот не поднялся:', e);
  process.exit(1);
});
