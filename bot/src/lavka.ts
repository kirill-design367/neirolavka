/**
 * Общий свёрток: база, настройки, поставщик оплаты и сам бот.
 *
 * Отдельным файлом, чтобы обработчики могли брать отсюда тип, а не
 * тянуть друг друга по кругу.
 */

import { Bot, HttpError, GrammyError } from 'grammy';
import type { Transformer } from 'grammy';
import type { Baza } from './db/index.js';
import type { Nastroyki } from './config.js';
import type { PostavshchikOplaty } from './oplata/index.js';
import { soobshchitObObryve } from './lib/svyaz.js';
import { zhurnal } from './lib/zhurnal.js';

/** Запуск длинного опроса — тот самый `bot.start`, взятый заранее. */
export type NachatOpros = (o?: Parameters<Bot['start']>[0]) => Promise<void>;

export type Lavka = {
  db: Baza;
  n: Nastroyki;
  oplata: PostavshchikOplaty;
  bot: Bot;
  /**
   * Настоящий `bot.start`, взятый ДО создания вебхук-обработчика.
   *
   * grammY подменяет `bot.start` заглушкой-исключением, как только
   * создан `webhookCallback`, и он прав: два источника обновлений
   * разом — это потерянные обновления. Но нам нужен не «оба сразу»,
   * а ПЕРЕХОД с одного на другой: к моменту опроса вебхук у Telegram
   * снят, а наш путь отвечает отказом. Ссылку поэтому берём заранее —
   * `zapomnitOpros(bot)` — и делаем это полем свёртка, а не догадкой
   * в месте перехода.
   */
  nachatOpros: NachatOpros;
};

/** Взять ссылку на запуск опроса, пока её не подменил webhookCallback. */
export function zapomnitOpros(bot: Bot): NachatOpros {
  return bot.start.bind(bot);
}

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

/**
 * Ответ на нажатие, которое уже протухло.
 *
 * Telegram даёт на ответ по `callback_query` около минуты, а потом
 * отвечает «query is too old». Пока обновления приходят вовремя, это
 * не встречается никогда — и вылезает ровно тогда, когда доставка
 * стояла: накопленные нажатия приходят пачкой, все старые, и каждое
 * роняет обработчик в самом начале, на `answerCallbackQuery`.
 *
 * Человек при этом получал бы «что-то пошло не так» вместо заказа —
 * при том что сам заказ оформить ещё можно и нужно. Поэтому протухший
 * ответ на нажатие считается успехом: часики на кнопке всё равно
 * давно погасли, а работа обязана быть сделана.
 *
 * Гасится ТОЛЬКО этот метод и ТОЛЬКО эта причина. Любой другой отказ
 * Telegram проходит наверх как был.
 */
export function gasitProtuhshieNazhatiya(): Transformer {
  return async (prev, metod, telo, signal) => {
    try {
      return await prev(metod, telo, signal);
    } catch (e) {
      const protuhlo =
        metod === 'answerCallbackQuery' &&
        e instanceof GrammyError &&
        /query is too old|query ID is invalid/i.test(e.description);
      if (!protuhlo) throw e;
      zhurnal.vnimanie('нажатие протухло, пока обновление ждало доставки — отвечать уже некому');
      return { ok: true, result: true } as unknown as Awaited<ReturnType<typeof prev>>;
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
  // Порядок важен: гашение протухшего нажатия стоит БЛИЖЕ к сети,
  // чем повтор, — повторять протухшее незачем.
  bot.api.config.use(povtorPriObryve());
  bot.api.config.use(gasitProtuhshieNazhatiya());
  return bot;
}
