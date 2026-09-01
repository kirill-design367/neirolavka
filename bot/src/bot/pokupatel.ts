/**
 * Что видит покупатель.
 *
 * Путь короткий и без развилок: что берём → на какой срок → проверьте
 * заказ → оформлено. Всё остальное — «Мои заказы» и «Помощь».
 */

import type { Bot, Context, InlineKeyboard } from 'grammy';
import type { Lavka } from '../lavka.js';
import * as klav from './klaviatury.js';
import * as t from '../lib/texty.js';
import * as zakazy from '../db/zakazy.js';
import * as lyudi from '../db/lyudi.js';
import * as dostupy from '../db/dostupy.js';
import * as dialogi from '../db/dialogi.js';
import { raspisanie } from '../db/nastroyki.js';
import { rol } from '../db/komanda.js';
import { srokVydachi, dostupDo } from '../lib/vremya.js';
import { tovar, tovary, tarif, kopeyki } from '../lib/katalog.js';
import { zhurnal } from '../lib/zhurnal.js';
import * as uvedom from './uvedomleniya.js';
import { soobshchitOZakaze } from './admin.js';

/**
 * Правка сообщения, которая переживает «ничего не изменилось».
 *
 * Telegram отвечает ошибкой, если новый текст совпал со старым, —
 * а совпадает он от двойного нажатия. Ошибка тут ничего не значит.
 */
export async function pravit(ctx: Context, text: string, klaviatura?: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, klaviatura ? { reply_markup: klaviatura } : {});
  } catch (e) {
    const s = String(e);
    if (s.includes('message is not modified')) return;
    // Правка не удалась по другой причине — отправим новым сообщением,
    // иначе человек нажал кнопку и не увидел никакого ответа.
    zhurnal.vnimanie('правка сообщения не прошла, отправляю новым:', e);
    await ctx.reply(text, klaviatura ? { reply_markup: klaviatura } : {});
  }
}

export function podklyuchit(bot: Bot, l: Lavka): void {
  const r = () => raspisanie(l.db, l.n);

  bot.command('start', async (ctx) => {
    const imya = ctx.from?.first_name ?? '';
    await ctx.reply(t.privetstvie(imya, r()), { reply_markup: klav.nizhnyaya(rol(l.db, ctx.from?.id ?? 0)) });
    await ctx.reply(t.VYBOR_TOVARA, { reply_markup: klav.tovary(tovary()) });
  });

  bot.command('pomoshch', async (ctx) => {
    await ctx.reply(t.pomoshch(r(), l.n.adresSayta), { reply_markup: klav.pomoshch() });
  });

  // ── покупка ────────────────────────────────────────────────────────

  bot.hears(klav.KNOPKA_KUPIT, async (ctx) => {
    await ctx.reply(t.VYBOR_TOVARA, { reply_markup: klav.tovary(tovary()) });
  });

  bot.callbackQuery('kup', async (ctx) => {
    await ctx.answerCallbackQuery();
    await pravit(ctx, t.VYBOR_TOVARA, klav.tovary(tovary()));
  });

  bot.callbackQuery(/^t:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tv = tovar(ctx.match![1] as string);
    if (!tv) return pravit(ctx, t.TARIF_PROPAL, klav.tovary(tovary()));
    await pravit(ctx, t.kartochkaTovara(tv.name, tv.tagline, tv.note), klav.tarify(tv));
  });

  bot.callbackQuery(/^p:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const nayden = tarif(ctx.match![1] as string);
    if (!nayden) return pravit(ctx, t.TARIF_PROPAL, klav.tovary(tovary()));
    const { product, plan } = nayden;
    const seychas = new Date();
    const srok = srokVydachi(seychas, r());
    await pravit(
      ctx,
      t.podtverzhdenie(plan.title, kopeyki(plan), plan.months, dostupDo(seychas, plan.months), srok, r()),
      klav.oformit(plan.id, product.id),
    );
  });

  // Оформление. Здесь появляется заказ — и здесь же начинается всё,
  // что должно пережить перезапуск бота.
  bot.callbackQuery(/^of:(.+)$/, async (ctx) => {
    const tgId = ctx.from.id;
    const nayden = tarif(ctx.match![1] as string);
    if (!nayden) {
      await ctx.answerCallbackQuery();
      return pravit(ctx, t.TARIF_PROPAL, klav.tovary(tovary()));
    }
    const { product, plan } = nayden;
    lyudi.zapomnit(l.db, tgId, ctx.from.first_name ?? '', ctx.from.username ?? null);

    const { zakaz, novy } = zakazy.sozdatIliVernut(l.db, {
      tgId,
      produktId: product.id,
      planId: plan.id,
      nazvanie: plan.title,
      cenaKop: kopeyki(plan),
      mesyacev: plan.months,
    });

    // Ответ на нажатие уходит сразу: Telegram крутит часики на кнопке,
    // пока мы не ответили, и второе нажатие человек делает именно из-за
    // этого ожидания.
    await ctx.answerCallbackQuery(novy ? 'Записал' : 'Такой заказ уже есть');

    if (!novy) {
      await pravit(ctx, t.zakazUzheEst(zakaz), klav.poslePokupki(zakaz.id));
      return;
    }

    const schet = await l.oplata.vystavit(zakaz);
    const srok = srokVydachi(new Date(), r());
    if (schet.vneshnyId || schet.adres) {
      l.db
        .prepare(
          `INSERT INTO platezhi (zakaz_id, postavshchik, vneshny_id, summa_kop, valyuta, status, sozdan)
           VALUES (?, ?, ?, ?, 'RUB', 'sozdan', ?)`,
        )
        .run(zakaz.id, l.oplata.imya, schet.vneshnyId, zakaz.cena_kop, new Date().toISOString());
    }

    await pravit(ctx, t.zakazPrinyat(zakaz, srok, r(), l.oplata.rabotaet), klav.poslePokupki(zakaz.id));

    // Администратору — сразу, а не после оплаты: пока оплаты в боте нет,
    // именно он и договаривается с человеком о деньгах.
    await soobshchitOZakaze(l, zakaz);
  });

  // ── мои заказы ─────────────────────────────────────────────────────

  const pokazatZakazy = async (ctx: Context, pravkoy: boolean) => {
    const spisok = zakazy.cheloveka(l.db, ctx.from!.id);
    if (spisok.length === 0) {
      const text = t.NET_ZAKAZOV;
      return pravkoy ? pravit(ctx, text, klav.tovary(tovary())) : void (await ctx.reply(text, { reply_markup: klav.tovary(tovary()) }));
    }
    const shapka = 'Ваши заказы. Откройте любой, чтобы посмотреть подробности.';
    const k = klav.moiZakazy(spisok);
    if (pravkoy) await pravit(ctx, shapka, k);
    else await ctx.reply(shapka, { reply_markup: k });
  };

  bot.hears(klav.KNOPKA_ZAKAZY, (ctx) => pokazatZakazy(ctx, false));
  bot.callbackQuery('zak', async (ctx) => {
    await ctx.answerCallbackQuery();
    await pokazatZakazy(ctx, true);
  });

  bot.callbackQuery(/^z:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = Number(ctx.match![1]);
    const z = zakazy.po(l.db, id);
    // Чужой заказ по номеру не открывается: номера подряд, и подобрать
    // соседний — дело одной попытки.
    if (!z || z.tg_id !== ctx.from.id) return pravit(ctx, 'Такого заказа у вас нет.');
    const est = dostupy.est(l.db, z.id);
    await pravit(ctx, t.kartochkaZakaza(z, r(), est && z.status === 'vydan'), klav.zakazCheloveka(z, est && z.status === 'vydan'));
  });

  // Показ доступа. Единственное место, где шифротекст превращается
  // в текст, и происходит это только для владельца заказа.
  bot.callbackQuery(/^d:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match![1]);
    const z = zakazy.po(l.db, id);
    if (!z || z.tg_id !== ctx.from.id || z.status !== 'vydan') {
      await ctx.answerCallbackQuery('Доступа по этому заказу нет');
      return;
    }
    await ctx.answerCallbackQuery();
    try {
      const d = dostupy.vzyat(l.db, z.id, l.n.klyuchDostupov);
      if (!d) return void (await ctx.reply('Доступ по этому заказу ещё не записан.'));
      zakazy.sobytie(l.db, z.id, 'покупатель посмотрел доступ', ctx.from.id);
      await ctx.reply(t.dostupVydan(z, d.login, d.parol, d.zametka, r()));
    } catch (e) {
      // В журнал уходит факт, а не содержимое.
      zhurnal.oshibka(`не удалось показать доступ по заказу ${z.id}:`, e);
      await ctx.reply(
        'Не смог прочитать доступ по этому заказу. Это моя поломка, а не ваша: ' +
          'администратору я уже сообщил, он пришлёт доступ вручную.',
      );
      await uvedom.komande(l, `Не читается доступ по заказу № ${z.id}. Проверьте ключ шифрования.`);
    }
  });

  // ── помощь ─────────────────────────────────────────────────────────

  bot.hears(klav.KNOPKA_POMOSHCH, async (ctx) => {
    await ctx.reply(t.pomoshch(r(), l.n.adresSayta), { reply_markup: klav.pomoshch() });
  });

  bot.callbackQuery('pom', async (ctx) => {
    await ctx.answerCallbackQuery();
    await pravit(ctx, t.pomoshch(r(), l.n.adresSayta), klav.pomoshch());
  });

  bot.callbackQuery('vopros', async (ctx) => {
    await ctx.answerCallbackQuery();
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_vopros', null, {}, l.n.klyuchDostupov);
    await ctx.reply(t.NAPISAT_ADMINU);
  });
}

/** Вопрос покупателя администратору. Вызывается из общего разбора текста. */
export async function prinyatVopros(l: Lavka, tgId: number, text: string): Promise<void> {
  dialogi.zabyt(l.db, tgId);
  const c = lyudi.chelovek(l.db, tgId);
  zakazy.sobytie(l.db, null, 'вопрос от покупателя', tgId);
  await uvedom.komande(
    l,
    ['Вопрос от покупателя.', '', `От кого: ${lyudi.podpis(c, tgId)}`, `id: ${tgId}`, '', text].join('\n'),
  );
}
