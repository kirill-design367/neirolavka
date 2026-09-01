/**
 * Отправка сообщений наружу.
 *
 * Здесь живёт одно правило: сообщение, которое не удалось доставить,
 * не должно ронять то, ради чего оно отправлялось. Человек заблокировал
 * бота, у помощника не открыт чат — это обычные вещи, и выдача доступа
 * из-за них падать не должна. Поэтому все отправки проглатывают ошибку
 * и пишут её в журнал.
 */

import type { InlineKeyboard } from 'grammy';
import type { Lavka } from '../lavka.js';
import { komuSoobshchat } from '../db/komanda.js';
import { zhurnal } from '../lib/zhurnal.js';

export async function cheloveku(
  l: Lavka,
  tgId: number,
  text: string,
  klaviatura?: InlineKeyboard,
): Promise<boolean> {
  try {
    await l.bot.api.sendMessage(tgId, text, klaviatura ? { reply_markup: klaviatura } : {});
    return true;
  } catch (e) {
    zhurnal.vnimanie(`не доставлено человеку ${tgId}:`, e);
    return false;
  }
}

/** Всем, кто в команде: и владельцу, и помощникам. */
export async function komande(l: Lavka, text: string, klaviatura?: InlineKeyboard): Promise<void> {
  for (const id of komuSoobshchat(l.db)) {
    await cheloveku(l, id, text, klaviatura);
  }
}
