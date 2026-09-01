/**
 * Стенд: настоящий бот с настоящим вебхук-сервером и подставным
 * Telegram вместо api.telegram.org.
 *
 * Вынесен отдельно, чтобы проверки вебхука и проверки уведомлений
 * поднимали ОДИН И ТОТ ЖЕ стенд. Два похожих стенда рано или поздно
 * разъезжаются, и одна из проверок начинает мерить не то.
 */

import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { otkrytBazu } from '../src/db/index.js';
import { prochitat } from '../src/config.js';
import { zaseyat } from '../src/db/komanda.js';
import { sobrat } from '../src/bot/index.js';
import { sozdatServer } from '../src/server.js';
import { zaglushka } from '../src/oplata/zaglushka.js';
import type { Lavka } from '../src/lavka.js';
import { sozdatBota } from '../src/lavka.js';
import { podnyat } from './podstavnoy-telegram.js';
import type { PodstavnoyTelegram } from './podstavnoy-telegram.js';

export const SEKRET = 'sekret-dlya-proverki-vebhuka';
export const VLADELEC = 1369202079;
export const POKUPATEL = 42;

export type Stend = {
  l: Lavka;
  tg: PodstavnoyTelegram;
  adres: string;
  /** Корень сервера без пути вебхука — для /health и /vypusk. */
  koren: string;
  sostoyanie: { gotov: boolean; shag: string };
  zakryt: () => Promise<void>;
};

export async function stend(): Promise<Stend> {
  const tg = await podnyat();
  const n = prochitat({
    NEIROLAVKA_TOKEN_BOTA: '123456:proba',
    NEIROLAVKA_SEKRET_VEBHUKA: SEKRET,
    NEIROLAVKA_KLYUCH_DOSTUPOV: randomBytes(32).toString('base64'),
    NEIROLAVKA_VLADELCY: String(VLADELEC),
    NEIROLAVKA_BAZA: ':memory:',
  });
  const db = otkrytBazu(':memory:');
  zaseyat(db, n.vladelcy, n.pomoshniki);
  // Тот же конструктор, что в бою: иначе проверка про таймауты
  // доказывала бы свойства стенда, а не боевого бота.
  const bot = sozdatBota(n, tg.adres);
  const l: Lavka = { db, n, bot, oplata: zaglushka };
  sobrat(l);
  await bot.init();

  const sostoyanie = { gotov: true, shag: 'на связи' };
  const { server, put } = sozdatServer(l, 'proba', sostoyanie);
  await new Promise<void>((gotovo) => server.listen(0, '127.0.0.1', gotovo));
  const port = (server.address() as AddressInfo).port;

  return {
    l,
    tg,
    adres: `http://127.0.0.1:${port}${put}`,
    koren: `http://127.0.0.1:${port}`,
    sostoyanie,
    zakryt: async () => {
      await new Promise<void>((gotovo) => {
        server.closeAllConnections?.();
        server.close(() => gotovo());
      });
      await tg.stop();
      db.close();
    },
  };
}


export { poslat } from './podstavnoy-telegram.js';

let nomer = 1000;

export const nazhatie = (dannye: string, ot = POKUPATEL) => ({
  update_id: ++nomer,
  callback_query: {
    id: String(nomer),
    from: { id: ot, is_bot: false, first_name: 'Человек' },
    chat_instance: '1',
    data: dannye,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: ot, type: 'private' as const },
      from: { id: 1, is_bot: true, first_name: 'Бот' },
      text: 'что-то',
    },
  },
});

export const soobshchenie = (text: string, ot = POKUPATEL) => ({
  update_id: ++nomer,
  message: {
    message_id: ++nomer,
    date: 1,
    chat: { id: ot, type: 'private' as const },
    from: { id: ot, is_bot: false, first_name: 'Человек' },
    text,
  },
});
