/**
 * Общий свёрток: база, настройки, поставщик оплаты и сам бот.
 *
 * Отдельным файлом, чтобы обработчики могли брать отсюда тип, а не
 * тянуть друг друга по кругу.
 */

import { Bot, HttpError } from 'grammy';
import type { Transformer } from 'grammy';
import type { Baza } from './db/index.js';
import type { Nastroyki } from './config.js';
import type { PostavshchikOplaty } from './oplata/index.js';
import { soobshchitObObryve } from './lib/svyaz.js';
import { zhurnal } from './lib/zhurnal.js';

export type Lavka = {
  db: Baza;
  n: Nastroyki;
  oplata: PostavshchikOplaty;
  bot: Bot;
};

/**
 * Сколько ждём ответа от Telegram на ОДИН запрос.
 *
 * У grammY умолчание — 500 секунд. Это не опечатка и для длинного опроса
 * оправдано, но у нас вебхук: обработчик, ушедший ждать ответа
 * на восемь минут, держит соединение, копит работу и делает
 * поведение бота необъяснимым. Десять секунд — заведомо больше, чем
 * нужно живому Telegram, и заведомо меньше, чем терпит человек.
 */
export const PREDEL_ZAPROSA_S = 10;

/**
 * Создание бота — ОДНО на весь проект.
 *
 * Так сделано после того, как проверка вебхука чуть не соврала:
 * в стенде бот создавался со своим таймаутом, а в бою — с умолчанием
 * grammY в 500 секунд, и «зависший Telegram не держит очередь»
 * доказывалось про стенд, а не про то, что работает на сервере.
 * Настройки клиента должны быть в одном месте, иначе проверка меряет
 * не то, что ставится.
 */
/**
 * Сколько раз повторяем запрос, оборвавшийся по сети, и с какой паузой.
 *
 * Три попытки с паузами 0,7 и 1,4 с — это чуть больше двух секунд
 * сверху в худшем случае. Больше нельзя: обработчик обновления обязан
 * ответить Telegram за восемь секунд (PREDEL_OBRABOTKI_MS), и повторы
 * должны укладываться в этот бюджет, а не съедать его.
 */
export const POVTOROV = 3;
export const PAUZA_POVTORA_MS = 700;

/**
 * Повторяем только БЫСТРЫЙ обрыв.
 *
 * Разорванное соединение отваливается за миллисекунды — это и есть
 * секундный отвал IPv6, который лечится повтором. А молчащий путь
 * упирается в таймаут запроса (десять секунд), и к этому моменту
 * бюджет обработчика уже съеден: повторять там нечего, надо честно
 * падать и менять путь.
 */
export const PREDEL_BYSTROGO_MS = 2_000;

/**
 * Повтор запроса, оборвавшегося ПО СЕТИ.
 *
 * IPv6 до Telegram отваливается на секунды несколько раз в час.
 * Без повтора каждый такой отвал — это не доставленное человеку
 * сообщение: «доступ выдан», которое он не увидел, или просьба кода,
 * которой не было. С повтором отвал длиной в секунды человек
 * не замечает вовсе.
 *
 * Повторяем ТОЛЬКО сетевой обрыв (`HttpError`). Отказ самого Telegram
 * (`GrammyError` — «chat not found», 403, 429) повторять бессмысленно
 * и вредно: ответ не изменится, а время уйдёт.
 *
 * Заодно обрыв — самый ранний признак, что путь умер, и мы говорим
 * об этом присмотру: он проверит путь сразу, а не через расписание.
 */
export function povtorPriObryve(popytok = POVTOROV, pauzaMs = PAUZA_POVTORA_MS): Transformer {
  return async (prev, metod, telo, signal) => {
    for (let popytka = 1; ; popytka += 1) {
      const nachalo = Date.now();
      try {
        return await prev(metod, telo, signal);
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        // Обрыв — самый ранний признак, что путь умер. Говорим
        // присмотру ВСЕГДА, даже когда повторять не будем.
        soobshchitObObryve();
        const bystro = Date.now() - nachalo < PREDEL_BYSTROGO_MS;
        if (popytka >= popytok || !bystro) throw e;
        zhurnal.vnimanie(
          `сеть оборвалась на ${metod} (попытка ${popytka} из ${popytok}) — повторяю через ${pauzaMs * popytka} мс`,
        );
        await new Promise((gotovo) => setTimeout(gotovo, pauzaMs * popytka));
      }
    }
  };
}

export function sozdatBota(n: Nastroyki, apiRoot?: string): Bot {
  const bot = new Bot(n.token, {
    client: {
      timeoutSeconds: PREDEL_ZAPROSA_S,
      ...(apiRoot ? { apiRoot } : {}),
    },
  });
  bot.api.config.use(povtorPriObryve());
  return bot;
}
