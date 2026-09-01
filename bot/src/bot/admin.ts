/**
 * Что видит администратор.
 *
 * Ролей две. Владелец видит всё: очередь, выдачу, людей, статистику,
 * настройки. Помощник — только заказы и выдачу: чтобы отдать логин
 * и пароль, знать выручку и список покупателей не нужно.
 *
 * Проверка роли идёт по базе на каждое действие, а не запоминается
 * при старте: помощника добавляют и убирают на ходу.
 */

import type { Bot, Context } from 'grammy';
import type { Lavka } from '../lavka.js';
import * as klav from './klaviatury.js';
import * as zakazy from '../db/zakazy.js';
import * as lyudi from '../db/lyudi.js';
import * as dostupy from '../db/dostupy.js';
import * as dialogi from '../db/dialogi.js';
import * as komanda from '../db/komanda.js';
import * as nastroykiBd from '../db/nastroyki.js';
import { raspisanie } from '../db/nastroyki.js';
import { rubli } from '../lib/katalog.js';
import { chasSlovami, dataSlovami, momentSlovami, skolkoOsalos, srokVydachi, dostupDo, sklonenie } from '../lib/vremya.js';
import * as t from '../lib/texty.js';
import * as uvedom from './uvedomleniya.js';
import { pravit, prinyatVopros } from './pokupatel.js';
import { zhurnal } from '../lib/zhurnal.js';

const NET_PRAV = 'Этот раздел только для владельца.';

function svoy(l: Lavka, ctx: Context): komanda.Rol | null {
  return ctx.from ? komanda.rol(l.db, ctx.from.id) : null;
}

/** Строка заказа для служебных сообщений. */
function opisanie(l: Lavka, z: zakazy.Zakaz): string {
  const r = raspisanie(l.db, l.n);
  const c = lyudi.chelovek(l.db, z.tg_id);
  const strok = [
    `Заказ № ${z.id} · ${t.statusSlovami(z.status)}`,
    '',
    z.nazvanie,
    `${rubli(z.cena_kop)} · ${sklonenie(z.mesyacev, 'месяц', 'месяца', 'месяцев')}`,
    `Покупатель: ${lyudi.podpis(c, z.tg_id)}`,
    `Оформлен: ${momentSlovami(new Date(z.sozdan), r.poyas)}`,
  ];
  if (z.srok_do) {
    const srok = new Date(z.srok_do);
    strok.push(`Обещано: ${momentSlovami(srok, r.poyas)} (${skolkoOsalos(new Date(), srok)})`);
  }
  if (z.ispolnitel) strok.push(`Взял: ${z.ispolnitel}`);
  if (z.status === 'vydan' && z.dostup_do) {
    strok.push(`Доступ до: ${dataSlovami(new Date(z.dostup_do), r.poyas)}`);
  }
  if (dostupy.est(l.db, z.id)) strok.push('Доступ записан');
  return strok.join('\n');
}

/**
 * Уведомление команде о заказе.
 *
 * Приходит сразу, а не после оплаты: пока оплаты в боте нет,
 * договаривается о деньгах администратор, и знать о заказе ему нужно
 * с первой минуты. Когда оплата появится, эта же функция будет
 * вызываться из подтверждения платежа — текст поменяется, а место нет.
 */
export async function soobshchitOZakaze(l: Lavka, z: zakazy.Zakaz): Promise<void> {
  const oplachen = z.status !== 'zhdet_oplaty';
  const shapka = oplachen ? 'Новый оплаченный заказ.' : 'Новый заказ. Оплата пока вне бота.';
  await uvedom.komande(l, `${shapka}\n\n${opisanie(l, z)}`, klav.novyZakazAdminu(z, oplachen));
}

export function podklyuchit(bot: Bot, l: Lavka): void {
  const r = () => raspisanie(l.db, l.n);

  const sluzhebnoe = async (ctx: Context, pravkoy: boolean) => {
    const rl = svoy(l, ctx);
    if (!rl) return;
    const och = zakazy.ochered(l.db);
    const neop = zakazy.neoplachennye(l.db);
    const text = [
      rl === 'vladelec' ? 'Служебное. Вы владелец.' : 'Служебное. Вы помощник.',
      '',
      `В очереди на выдачу: ${och.length}`,
      `Ждут оплаты: ${neop.length}`,
    ].join('\n');
    if (pravkoy) await pravit(ctx, text, klav.sluzhebnoe(rl));
    else await ctx.reply(text, { reply_markup: klav.sluzhebnoe(rl) });
  };

  bot.hears(klav.KNOPKA_LAVKA, (ctx) => sluzhebnoe(ctx, false));
  bot.command('lavka', (ctx) => sluzhebnoe(ctx, false));
  bot.callbackQuery('a', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sluzhebnoe(ctx, true);
  });

  // ── очереди ────────────────────────────────────────────────────────

  bot.callbackQuery('aoch', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!svoy(l, ctx)) return;
    const spisok = zakazy.ochered(l.db);
    const text = spisok.length
      ? `Очередь на выдачу: ${spisok.length}. Старые сверху.`
      : 'Очередь пуста: всё выдано.';
    await pravit(ctx, text, klav.ocheredAdminu(spisok));
  });

  bot.callbackQuery('aneopl', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!svoy(l, ctx)) return;
    const spisok = zakazy.neoplachennye(l.db);
    const text = spisok.length
      ? `Ждут оплаты: ${spisok.length}. Пока оплата вне бота, отмечайте вручную.`
      : 'Неоплаченных заказов нет.';
    await pravit(ctx, text, klav.ocheredAdminu(spisok));
  });

  bot.callbackQuery(/^az:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!svoy(l, ctx)) return;
    const z = zakazy.po(l.db, Number(ctx.match![1]));
    if (!z) return pravit(ctx, 'Такого заказа нет.', klav.nazadSluzhebnoe());
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, dostupy.est(l.db, z.id)));
  });

  // ── движение заказа ────────────────────────────────────────────────

  bot.callbackQuery(/^aopl:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    const srok = srokVydachi(new Date(), r());
    const vyshlo = zakazy.otmetitOplachennym(l.db, id, srok.do, ctx.from.id);
    await ctx.answerCallbackQuery(vyshlo ? 'Отметил оплаченным' : 'Заказ уже не ждёт оплаты');
    const z = zakazy.po(l.db, id);
    if (!z) return;
    if (vyshlo) await uvedom.cheloveku(l, z.tg_id, t.oplataPodtverzhdena(z, srok, r()));
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, dostupy.est(l.db, z.id)));
  });

  bot.callbackQuery(/^avz:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    const vzyal = zakazy.vzyat(l.db, id, ctx.from.id);
    await ctx.answerCallbackQuery(vzyal ? 'Взяли в работу' : 'Заказ уже взят или выдан');
    const z = zakazy.po(l.db, id);
    if (z) await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, dostupy.est(l.db, z.id)));
  });

  bot.callbackQuery(/^aver:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    zakazy.vernutVOchered(l.db, id, ctx.from.id);
    await ctx.answerCallbackQuery('Вернул в очередь');
    const z = zakazy.po(l.db, id);
    if (z) await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, dostupy.est(l.db, z.id)));
  });

  bot.callbackQuery(/^aotm:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    const bylo = zakazy.otmenit(l.db, id, ctx.from.id, 'отменён администратором');
    await ctx.answerCallbackQuery(bylo ? 'Отменил' : 'Выданный заказ отменить нельзя');
    const z = zakazy.po(l.db, id);
    if (!z) return;
    if (bylo) {
      await uvedom.cheloveku(
        l,
        z.tg_id,
        `Заказ № ${z.id} отменён. Если это ошибка — напишите мне, разберёмся. ` +
          'Оплаченные и невыданные заказы возвращаются деньгами.',
      );
    }
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, dostupy.est(l.db, z.id)));
  });

  // ── ввод доступа ───────────────────────────────────────────────────

  bot.callbackQuery(/^avv:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    const id = Number(ctx.match![1]);
    const z = zakazy.po(l.db, id);
    if (!z) return;
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_login', id, {}, l.n.klyuchDostupov);
    await ctx.reply(
      [
        `Заказ № ${id}. Пришлите логин одним сообщением.`,
        '',
        'Следующим сообщением — пароль. Если к доступу нужна записка ' +
          'для покупателя, допишите её со второй строки того же сообщения.',
      ].join('\n'),
      { reply_markup: klav.otmenaVvoda() },
    );
  });

  bot.callbackQuery('aotmena', async (ctx) => {
    await ctx.answerCallbackQuery('Ввод отменён');
    dialogi.zabyt(l.db, ctx.from.id);
    await pravit(ctx, 'Ввод отменён. Заказ остался как был.');
  });

  bot.callbackQuery(/^avyd:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    const z = zakazy.po(l.db, id);
    if (!z) return void (await ctx.answerCallbackQuery('Заказа нет'));
    if (!dostupy.est(l.db, id)) return void (await ctx.answerCallbackQuery('Доступ не записан'));

    let d;
    try {
      d = dostupy.vzyat(l.db, id, l.n.klyuchDostupov);
    } catch (e) {
      zhurnal.oshibka(`не читается доступ по заказу ${id}:`, e);
      return void (await ctx.answerCallbackQuery('Не читается запись доступа'));
    }
    if (!d) return void (await ctx.answerCallbackQuery('Доступ не записан'));

    // Сначала отправляем человеку, потом отмечаем выданным. Обратный
    // порядок оставил бы заказ «выданным» при неотправленном доступе.
    const dostupDoDaty = z.dostup_do ? new Date(z.dostup_do) : dostupDo(new Date(), z.mesyacev);
    const dlyaPokupatelya = { ...z, dostup_do: dostupDoDaty.toISOString() };
    const doshlo = await uvedom.cheloveku(
      l,
      z.tg_id,
      t.dostupVydan(dlyaPokupatelya, d.login, d.parol, d.zametka, r()),
    );
    if (!doshlo) {
      await ctx.answerCallbackQuery('Сообщение покупателю не доставлено');
      await ctx.reply(
        `Покупателю по заказу № ${id} сообщение не доставлено — вероятно, он заблокировал бота. ` +
          'Заказ оставил невыданным.',
      );
      return;
    }
    zakazy.otmetitVydannym(l.db, id, dostupDoDaty, ctx.from.id);
    await ctx.answerCallbackQuery('Отправил покупателю');
    const svezhy = zakazy.po(l.db, id);
    if (svezhy) await pravit(ctx, opisanie(l, svezhy), klav.zakazAdminu(svezhy, true));
  });

  // ── владелец ───────────────────────────────────────────────────────

  bot.callbackQuery('alyudi', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    const spisok = lyudi.spisok(l.db, 20);
    const strok = spisok.map(
      (c) => `${lyudi.podpis(c, c.tg_id)} · заказов ${c.zakazov}, выдано ${c.vydano}`,
    );
    await pravit(
      ctx,
      [`Всего людей: ${lyudi.skolkoVsego(l.db)}. Последние двадцать:`, '', ...strok].join('\n'),
      klav.nazadSluzhebnoe(),
    );
  });

  bot.callbackQuery('astat', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    const s = zakazy.statistika(l.db);
    const poTovaram = s.poTovaram.map((p) => `  ${p.produkt_id}: ${p.skolko} на ${rubli(p.summa_kop)}`);
    await pravit(
      ctx,
      [
        'Статистика.',
        '',
        `Заказов всего: ${s.vsego}, за сутки: ${s.zaSutki}`,
        `Ждут оплаты: ${s.poStatusam['zhdet_oplaty'] ?? 0}`,
        `Оплачены: ${s.poStatusam['oplachen'] ?? 0}`,
        `В работе: ${s.poStatusam['v_rabote'] ?? 0}`,
        `Выданы: ${s.poStatusam['vydan'] ?? 0}`,
        `Отменены: ${s.poStatusam['otmenen'] ?? 0}`,
        '',
        `Выручка по выданным: ${rubli(s.vyruchkaKop)}`,
        s.srednyayaVydachaMinut === null
          ? 'Среднего времени выдачи пока нет: ни один заказ не прошёл путь целиком.'
          : `Среднее время выдачи: ${sklonenie(s.srednyayaVydachaMinut, 'минута', 'минуты', 'минут')}`,
        ...(poTovaram.length ? ['', 'По товарам:', ...poTovaram] : []),
      ].join('\n'),
      klav.nazadSluzhebnoe(),
    );
  });

  bot.callbackQuery('anastr', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    const rr = r();
    await pravit(
      ctx,
      [
        'Настройки.',
        '',
        `Часы работы: с ${chasSlovami(rr.rabotaS)} до ${chasSlovami(rr.rabotaDo)} (${rr.poyas})`,
        `Обещание выдачи: ${sklonenie(rr.obeshchanieMinut, 'минута', 'минуты', 'минут')}`,
        `Оплата: ${l.oplata.rabotaet ? l.oplata.imya : 'не подключена'}`,
        '',
        'Часы работы подставляются в тексты сами: менять их здесь достаточно.',
      ].join('\n'),
      klav.nastroykiVladelca(),
    );
  });

  bot.callbackQuery('achasy', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_chasy', null, {}, l.n.klyuchDostupov);
    await ctx.reply(
      [
        'Пришлите два числа через пробел: час открытия и час закрытия.',
        '',
        `Сейчас: ${r().rabotaS} ${r().rabotaDo}`,
      ].join('\n'),
      { reply_markup: klav.otmenaVvoda() },
    );
  });

  bot.callbackQuery('akom', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    const strok = komanda
      .vsya(l.db)
      .map((s) => `${s.rol === 'vladelec' ? 'владелец' : 'помощник'} · ${s.tg_id}${s.imya ? ` · ${s.imya}` : ''}`);
    await pravit(
      ctx,
      [
        'Команда.',
        '',
        ...strok,
        '',
        'Помощник видит очередь и выдаёт доступы. Людей, статистику ' +
          'и настройки не видит.',
        '',
        'Убрать помощника: /ubrat_pomoshnika ‹id›',
      ].join('\n'),
      klav.komandaVladelca(),
    );
  });

  bot.callbackQuery('adobp', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_pomoshnika', null, {}, l.n.klyuchDostupov);
    await ctx.reply(
      [
        'Пришлите телеграм-идентификатор помощника — число.',
        '',
        'Узнать его можно так: пусть человек напишет боту любое сообщение, ' +
          'а вы посмотрите список людей в служебном разделе.',
      ].join('\n'),
      { reply_markup: klav.otmenaVvoda() },
    );
  });

  bot.command('ubrat_pomoshnika', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from?.id ?? 0)) return void (await ctx.reply(NET_PRAV));
    const id = Number((ctx.match ?? '').trim());
    if (!Number.isInteger(id) || id <= 0) return void (await ctx.reply('Нужен числовой идентификатор.'));
    const itog = komanda.ubrat(l.db, id);
    await ctx.reply(itog.ok ? `Убрал ${id} из команды.` : `Не убрал: ${itog.pochemu}.`);
  });
}

/**
 * Незаконченные разговоры.
 *
 * Стоит ПЕРЕД остальными обработчиками текста: пока идёт ввод пароля,
 * слово «Помощь» — это пароль, а не нажатие кнопки.
 */
export function podklyuchitDialogi(bot: Bot, l: Lavka): void {
  bot.on('message:text', async (ctx, next) => {
    const tgId = ctx.from.id;
    const d = dialogi.vzyat(l.db, tgId, l.n.klyuchDostupov);
    if (!d) return next();
    const text = ctx.message.text;

    if (d.shag === 'zhdem_vopros') {
      await prinyatVopros(l, tgId, text);
      await ctx.reply(t.VOPROS_PRINYAT);
      return;
    }

    // Дальше — только служебные шаги.
    if (!komanda.rol(l.db, tgId)) {
      dialogi.zabyt(l.db, tgId);
      return next();
    }

    if (d.shag === 'zhdem_login') {
      const login = text.trim();
      dialogi.postavit(l.db, tgId, 'zhdem_parol', d.zakazId, { login }, l.n.klyuchDostupov);
      await ubratSoobshchenie(ctx);
      await ctx.reply('Логин записал. Теперь пароль — и записка со второй строки, если нужна.', {
        reply_markup: klav.otmenaVvoda(),
      });
      return;
    }

    if (d.shag === 'zhdem_parol') {
      const stroki = text.split('\n');
      const parol = (stroki[0] ?? '').trim();
      const zametka = stroki.slice(1).join('\n').trim() || null;
      const login = d.chernovik['login'] ?? '';
      const id = d.zakazId;
      // Сообщение с паролем убираем из чата сразу: в переписке ему
      // делать нечего, а посмотреть введённое можно ниже.
      await ubratSoobshchenie(ctx);
      dialogi.zabyt(l.db, tgId);
      if (!id || !login || !parol) {
        await ctx.reply('Что-то потерялось при вводе. Начните заново из карточки заказа.');
        return;
      }
      dostupy.polozhit(l.db, id, { login, parol, zametka }, tgId, l.n.klyuchDostupov);
      zakazy.sobytie(l.db, id, 'доступ записан', tgId);
      await ctx.reply(
        [
          `Заказ № ${id}. Проверьте, что отправлю покупателю.`,
          '',
          `Логин: ${login}`,
          `Пароль: ${parol}`,
          ...(zametka ? ['', zametka] : []),
        ].join('\n'),
        { reply_markup: klav.proverkaDostupa(id) },
      );
      return;
    }

    if (d.shag === 'zhdem_pomoshnika') {
      dialogi.zabyt(l.db, tgId);
      const id = Number(text.trim());
      if (!Number.isInteger(id) || id <= 0) {
        await ctx.reply('Это не похоже на идентификатор. Нужно число.');
        return;
      }
      const c = lyudi.chelovek(l.db, id);
      komanda.dobavit(l.db, id, 'pomoshnik', c?.imya ?? '', tgId);
      await ctx.reply(`Добавил ${id} помощником. Заказы теперь приходят и ему.`);
      await uvedom.cheloveku(
        l,
        id,
        'Вас добавили помощником в Нейролавке. В нижнем меню появился раздел «Заказы лавки»: ' +
          'там очередь на выдачу. Нажмите /start, чтобы меню обновилось.',
      );
      return;
    }

    if (d.shag === 'zhdem_chasy') {
      dialogi.zabyt(l.db, tgId);
      const chasti = text.trim().split(/[\s—–-]+/).map(Number);
      const [s, po] = chasti;
      if (chasti.length !== 2 || !Number.isInteger(s) || !Number.isInteger(po) || s! < 0 || po! > 24 || s! >= po!) {
        await ctx.reply('Нужны два целых часа, начало меньше конца. Например: 8 23');
        return;
      }
      nastroykiBd.postavit(l.db, 'rabota_s', String(s), tgId);
      nastroykiBd.postavit(l.db, 'rabota_do', String(po), tgId);
      await ctx.reply(
        `Часы работы теперь с ${chasSlovami(s!)} до ${chasSlovami(po!)}. ` +
          'Тексты подставят их сами — править ничего не нужно.',
      );
      return;
    }

    return next();
  });
}

/** Убрать сообщение из чата, не поднимая шума, если не вышло. */
async function ubratSoobshchenie(ctx: Context): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch {
    // Telegram не даёт удалять чужие сообщения старше двух суток.
    // Ничего страшного: это гигиена, а не защита.
  }
}
