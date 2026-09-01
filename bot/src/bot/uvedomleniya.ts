/**
 * Отправка сообщений наружу.
 *
 * Правило здесь одно, и оно куплено дорого: сообщение, которое
 * не удалось доставить, не должно ломать то, ради чего оно
 * отправлялось. Заказ покупателя и уведомление администратору —
 * разные вещи. Заказ уже принят и записан в базу; то, дошло ли
 * служебное сообщение, к нему отношения не имеет.
 *
 * Поэтому наружу отсюда не вылетает НИ ОДНО исключение. Неудача —
 * это значение, а не бросок.
 */

import { GrammyError } from 'grammy';
import type { InlineKeyboard } from 'grammy';
import type { Lavka } from '../lavka.js';
import { komuSoobshchat } from '../db/komanda.js';
import * as lyudi from '../db/lyudi.js';
import { zhurnal } from '../lib/zhurnal.js';

/** Почему не дошло. Разные причины лечатся по-разному. */
export type Pochemu = 'ne_zapuskal' | 'zablokiroval' | 'inoe';

export type Itog = { doshlo: true } | { doshlo: false; pochemu: Pochemu };

/**
 * Разбор отказа Telegram.
 *
 * «chat not found» — не сбой, а состояние: человек ни разу не открывал
 * бота, и переписки с ним не существует. Лечится тем, что он нажмёт
 * «Начать». Различать это от настоящей поломки обязательно, иначе
 * в журнале будет ровный поток непонятных ошибок.
 */
export function pochemuNeDoshlo(e: unknown): Pochemu {
  if (e instanceof GrammyError) {
    const o = e.description.toLowerCase();
    if (e.error_code === 400 && o.includes('chat not found')) return 'ne_zapuskal';
    if (e.error_code === 403) return 'zablokiroval';
  }
  return 'inoe';
}

export function pochemuSlovami(p: Pochemu, tgId: number): string {
  switch (p) {
    case 'ne_zapuskal':
      return `${tgId} ни разу не запускал бота — пусть откроет его и нажмёт «Начать»`;
    case 'zablokiroval':
      return `${tgId} заблокировал бота`;
    case 'inoe':
      return `${tgId} недоступен по другой причине`;
  }
}

export async function cheloveku(
  l: Lavka,
  tgId: number,
  text: string,
  klaviatura?: InlineKeyboard,
): Promise<Itog> {
  try {
    await l.bot.api.sendMessage(tgId, text, klaviatura ? { reply_markup: klaviatura } : {});
    return { doshlo: true };
  } catch (e) {
    const pochemu = pochemuNeDoshlo(e);
    zhurnal.vnimanie(`не доставлено: ${pochemuSlovami(pochemu, tgId)}.`, e);
    return { doshlo: false, pochemu };
  }
}

export type ItogKomande = {
  vsego: number;
  doshlo: number;
  /** Кто не получил и почему. */
  nedostupny: { tgId: number; pochemu: Pochemu }[];
};

/**
 * Всем, кто в команде.
 *
 * Параллельно, а не по очереди: один недоступный администратор
 * не должен задерживать остальных на время таймаута запроса.
 * Ошибки собираются, а не бросаются.
 */
export async function komande(
  l: Lavka,
  text: string,
  klaviatura?: InlineKeyboard,
): Promise<ItogKomande> {
  let komu: number[] = [];
  try {
    komu = komuSoobshchat(l.db);
  } catch (e) {
    zhurnal.oshibka('не удалось прочитать команду из базы:', e);
    return { vsego: 0, doshlo: 0, nedostupny: [] };
  }
  const itogi = await Promise.all(
    komu.map(async (tgId) => ({ tgId, itog: await cheloveku(l, tgId, text, klaviatura) })),
  );
  const nedostupny = itogi
    .filter((x) => !x.itog.doshlo)
    .map((x) => ({ tgId: x.tgId, pochemu: (x.itog as { pochemu: Pochemu }).pochemu }));
  return { vsego: komu.length, doshlo: itogi.length - nedostupny.length, nedostupny };
}

/**
 * Может ли бот писать этому человеку — БЕЗ отправки сообщения.
 *
 * getChat не шлёт ничего и не тревожит человека, но отвечает той же
 * ошибкой «chat not found», если переписки не существует. Так можно
 * узнать о недоступном администраторе заранее, а не в момент первого
 * заказа.
 */
export async function mozhemPisat(l: Lavka, tgId: number): Promise<Itog> {
  try {
    await l.bot.api.getChat(tgId);
    return { doshlo: true };
  } catch (e) {
    return { doshlo: false, pochemu: pochemuNeDoshlo(e) };
  }
}

/**
 * Проверка всей команды при запуске.
 *
 * Пишет в журнал понятным текстом, кто недоступен и что делать.
 * Молчание об этом стоило боевого дня: первый же заказ ушёл
 * в пустоту, и увидели это только по жалобе.
 */
export async function proveritKomandu(l: Lavka): Promise<void> {
  let komu: number[] = [];
  try {
    komu = komuSoobshchat(l.db);
  } catch (e) {
    zhurnal.oshibka('не удалось прочитать команду из базы:', e);
    return;
  }
  if (komu.length === 0) {
    zhurnal.oshibka('в команде никого нет — заказы будет некому передать');
    return;
  }
  const itogi = await Promise.all(komu.map(async (tgId) => ({ tgId, itog: await mozhemPisat(l, tgId) })));
  const plohie = itogi.filter((x) => !x.itog.doshlo);
  if (plohie.length === 0) {
    zhurnal.info(`команда на связи: ${komu.length} чел., всем можно писать`);
    return;
  }
  for (const { tgId, itog } of plohie) {
    const c = lyudi.chelovek(l.db, tgId);
    zhurnal.vnimanie(
      `АДМИНИСТРАТОР НЕДОСТУПЕН: ${lyudi.podpis(c, tgId)} — ` +
        `${pochemuSlovami((itog as { pochemu: Pochemu }).pochemu, tgId)}. ` +
        'Пока это так, заказы ему не придут.',
    );
  }
  if (plohie.length === itogi.length) {
    zhurnal.oshibka(
      'НИ ОДНОМУ администратору написать нельзя. Заказы будут сохраняться ' +
        'в базе и попадать в очередь на выдачу, но уведомлений не будет.',
    );
  }
}
