/**
 * Сборка бота: порядок обработчиков.
 *
 * Порядок здесь — часть устройства, а не оформление.
 *
 *   1. Отсев повторов. Telegram повторяет доставку, пока не получит
 *      200, и повтор не должен оформить второй заказ.
 *   2. Память о человеке.
 *   3. Незаконченные разговоры. Пока идёт ввод пароля, слово «Помощь» —
 *      это пароль, а не нажатие кнопки.
 *   4. Покупатель, потом служебное.
 *   5. Последним — ответ на непонятое.
 */

import { Bot } from 'grammy';
import type { Lavka } from '../lavka.js';
import * as pokupatel from './pokupatel.js';
import * as admin from './admin.js';
import * as lyudi from '../db/lyudi.js';
import * as klav from './klaviatury.js';
import { rol } from '../db/komanda.js';
import { seychasISO } from '../db/index.js';
import * as t from '../lib/texty.js';
import { zhurnal } from '../lib/zhurnal.js';

export function sobrat(l: Lavka): Bot {
  const bot = l.bot;

  // 1. Повторная доставка того же обновления не делает работу дважды.
  bot.use(async (ctx, next) => {
    const id = ctx.update.update_id;
    const r = l.db
      .prepare('INSERT OR IGNORE INTO obnovleniya (update_id, kogda) VALUES (?, ?)')
      .run(id, seychasISO());
    if (r.changes === 0) {
      zhurnal.vnimanie(`повтор обновления ${id} — пропускаю`);
      return;
    }
    await next();
  });

  // 2. Кто это. Заодно обновляется имя: люди их меняют.
  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) {
      lyudi.zapomnit(l.db, ctx.from.id, ctx.from.first_name ?? '', ctx.from.username ?? null);
    }
    await next();
  });

  // 3–4.
  admin.podklyuchitDialogi(bot, l);
  pokupatel.podklyuchit(bot, l);
  admin.podklyuchit(bot, l);

  // 5. Всё, что не разобрано.
  bot.on('message', async (ctx) => {
    await ctx.reply(t.NE_PONYAL, { reply_markup: klav.nizhnyaya(rol(l.db, ctx.from?.id ?? 0)) });
  });

  bot.catch(async (err) => {
    zhurnal.oshibka('обработчик упал:', err.error);
    try {
      await err.ctx.reply(t.OSHIBKA_OBSHCHAYA);
    } catch {
      // Человек мог заблокировать бота — тогда и извиниться некому.
    }
  });

  return bot;
}
