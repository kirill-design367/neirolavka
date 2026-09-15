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
import type { Baza } from '../src/db/index.js';
import { prochitat } from '../src/config.js';
import { zaseyat } from '../src/db/komanda.js';
import { sobrat } from '../src/bot/index.js';
import { sozdatServer } from '../src/server.js';
import type { Sostoyanie } from '../src/server.js';
import { zaglushka } from '../src/oplata/zaglushka.js';
import { sozdatRobokassu } from '../src/oplata/robokassa.js';
import type { Lavka } from '../src/lavka.js';
import { sozdatBota, zapomnitOpros } from '../src/lavka.js';
import { getCatalog } from '../../src/lib/catalog.js';
import * as bdKatalog from '../src/db/katalog.js';
import { podnyat } from './podstavnoy-telegram.js';
import type { PodstavnoyTelegram } from './podstavnoy-telegram.js';

export const SEKRET = 'sekret-dlya-proverki-vebhuka';
export const VLADELEC = 1369202079;
export const POKUPATEL = 42;

/**
 * Живой уровень подписки, взятый ИЗ КАТАЛОГА, а не вписанный строкой.
 *
 * Берётся из ФАЙЛА, а не из базы: база засевается этим же файлом,
 * идентификаторы совпадают, а константу надо знать до открытия базы.
 *
 * Вписанный id однажды устаревает вместе с каталогом, и проверки
 * начинают падать с «0 !== 1»: нажатие уходит на несуществующий
 * уровень, заказ не создаётся, а по сообщению об ошибке этого
 * не видно. Так уже было с «claude-pro-1m» после смены прайса.
 */
export const ZHIVOY_PLAN: string = (() => {
  const p = getCatalog().products.find((t) => t.plans.length > 0);
  if (!p) throw new Error('в каталоге не осталось ни одного уровня подписки');
  return p.plans[0]!.id;
})();

/**
 * Продукт БЕЗ уровней подписки — стенд ЗАВОДИТ его сам.
 *
 * Прежде он искался в прайсе, и это была ставка на чужой прайс:
 * владелец выложил из панели уровни всем шести продуктам — и стенд
 * перестал подниматься ВООБЩЕ, уронив разом двенадцать файлов
 * проверок. Падали они при этом не по той причине, ради которой
 * написаны: покупка продукта без уровней работает, её просто не на
 * чем стало показать.
 *
 * Свойство продукта проверять НАДО — у такого заказ оформляется
 * с самой карточки, — но держать его в прайсе владельца нельзя:
 * прайс его, и он вправе завести уровни кому угодно. Поэтому такой
 * продукт заводится В БАЗЕ СТЕНДА, рядом с засеянными из файла.
 *
 * Тот же закон, что у `ZHIVOY_PLAN`: ничего, что зависит от прайса,
 * в проверки не вписывается.
 */
export const PRODUKT_BEZ_UROVNEY = {
  id: 'proba-bez-urovney',
  name: 'Proba bez urovney',
  tagline: 'Proba: podpiska bez urovney',
  note: 'Odna podpiska, vybirat nechego',
};

/**
 * Завести его в базе стенда — ЯВНО, там, где он нужен.
 *
 * Не в самом `stend()`, и это не мелочь: каталог стенда обязан
 * оставаться точной копией прайса. Проверка выкладки гоняет круг
 * «файл → база → файл» и требует совпадения БАЙТ В БАЙТ; лишний
 * продукт в базе ломает его на ровном месте — то есть проверка
 * краснела бы не про то, ради чего написана.
 *
 * Цена положительная: ноль в базе значит «цена не объявлена», и проба,
 * которой нужен настоящий заказ, получила бы «уточняется» вместо
 * суммы. Та проверка, что мерит именно ноль, снимает цену сама.
 */
export function zavestiProduktBezUrovney(db: Baza): void {
  bdKatalog.sozdatProdukt(db, PRODUKT_BEZ_UROVNEY.id, PRODUKT_BEZ_UROVNEY.name);
  bdKatalog.pravitProdukt(db, PRODUKT_BEZ_UROVNEY.id, {
    tagline: PRODUKT_BEZ_UROVNEY.tagline,
    note: PRODUKT_BEZ_UROVNEY.note,
    cenaKop: 139900,
  });
}

/** Продукт, у которого уровни есть. */
export const PRODUKT_S_UROVNYAMI = (() => {
  const p = getCatalog().products.find((t) => t.plans.length > 0);
  if (!p) throw new Error('в каталоге не осталось продукта с уровнями');
  return p;
})();

export type Stend = {
  l: Lavka;
  tg: PodstavnoyTelegram;
  adres: string;
  /** Корень сервера без пути вебхука — для /health и /vypusk. */
  koren: string;
  sostoyanie: Sostoyanie;
  zakryt: () => Promise<void>;
};

/**
 * Поднять стенд.
 *
 * `dop` уезжает в РАЗБОР НАСТРОЕК, а не мимо него: проверка оплаты
 * обязана получать поставщика, собранного тем же кодом, что и бой.
 * Подсунуть готовый объект было бы проще и доказывало бы свойства
 * подсунутого объекта — тот же довод, по которому бот создаётся
 * одной функцией `sozdatBota`.
 */
export async function stend(dop: Record<string, string> = {}): Promise<Stend> {
  const tg = await podnyat();
  // Настройки читаются ТЕМ ЖЕ разбором, что в бою; проверка может
  // добавить своё — например, адрес подставного хранилища кода.
  const n = prochitat({
    NEIROLAVKA_TOKEN_BOTA: '123456:proba',
    NEIROLAVKA_SEKRET_VEBHUKA: SEKRET,
    NEIROLAVKA_KLYUCH_DOSTUPOV: randomBytes(32).toString('base64'),
    NEIROLAVKA_VLADELCY: String(VLADELEC),
    NEIROLAVKA_BAZA: ':memory:',
    ...dop,
  });
  const db = otkrytBazu(':memory:');
  zaseyat(db, n.vladelcy, n.pomoshniki);
  // Тот же конструктор, что в бою: иначе проверка про таймауты
  // доказывала бы свойства стенда, а не боевого бота.
  const bot = sozdatBota(n, tg.adres);
  const oplata = n.robokassa.login ? sozdatRobokassu(n.robokassa) : zaglushka;
  const l: Lavka = { db, n, bot, oplata, nachatOpros: zapomnitOpros(bot) };
  sobrat(l);
  await bot.init();

  const sostoyanie: Sostoyanie = { gotov: true, shag: 'на связи', dostavka: 'vebhuk' };
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
