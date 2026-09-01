/**
 * Общий свёрток: база, настройки, поставщик оплаты и сам бот.
 *
 * Отдельным файлом, чтобы обработчики могли брать отсюда тип, а не
 * тянуть друг друга по кругу.
 */

import type { Bot } from 'grammy';
import type { Baza } from './db/index.js';
import type { Nastroyki } from './config.js';
import type { PostavshchikOplaty } from './oplata/index.js';

export type Lavka = {
  db: Baza;
  n: Nastroyki;
  oplata: PostavshchikOplaty;
  bot: Bot;
};
