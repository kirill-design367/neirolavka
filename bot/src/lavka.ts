/**
 * Общий свёрток: база, настройки, поставщик оплаты и сам бот.
 *
 * Отдельным файлом, чтобы обработчики могли брать отсюда тип, а не
 * тянуть друг друга по кругу.
 */

import { Bot } from 'grammy';
import type { Baza } from './db/index.js';
import type { Nastroyki } from './config.js';
import type { PostavshchikOplaty } from './oplata/index.js';

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
export function sozdatBota(n: Nastroyki, apiRoot?: string): Bot {
  return new Bot(n.token, {
    client: {
      timeoutSeconds: PREDEL_ZAPROSA_S,
      ...(apiRoot ? { apiRoot } : {}),
    },
  });
}
