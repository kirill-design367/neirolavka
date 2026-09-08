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
import * as koshelek from '../db/koshelek.js';
import * as svoi from '../db/svoi.js';
import * as kody from '../db/kody.js';
import * as komanda from '../db/komanda.js';
import * as nastroykiBd from '../db/nastroyki.js';
import { raspisanie } from '../db/nastroyki.js';
import { rubli, rubliIli } from '../lib/katalog.js';
import { chasSlovami, dataSlovami, momentSlovami, skolkoOsalos, srokVydachi, dostupDo, sklonenie } from '../lib/vremya.js';
import * as t from '../lib/texty.js';
import * as uvedom from './uvedomleniya.js';
import { pravit, prinyatVopros, prinyatPochtu, prinyatParolAkkaunta, prinyatKod } from './pokupatel.js';
import { zhurnal } from '../lib/zhurnal.js';

const NET_PRAV = 'Этот раздел только для владельца.';

function svoy(l: Lavka, ctx: Context): komanda.Rol | null {
  return ctx.from ? komanda.rol(l.db, ctx.from.id) : null;
}

/** Что помощник может сделать с заказом прямо сейчас. */
function pod(l: Lavka, z: zakazy.Zakaz): klav.Pod {
  return {
    estDostup: dostupy.est(l.db, z.id),
    estKod: kody.vzyat(l.db, z.id, l.n.klyuchDostupov) !== null,
    estAkkaunt: svoi.est(l.db, z.id),
  };
}

/** Строка заказа для служебных сообщений. */
function opisanie(l: Lavka, z: zakazy.Zakaz): string {
  const r = raspisanie(l.db, l.n);
  const c = lyudi.chelovek(l.db, z.tg_id);
  const strok = [
    `Заказ № ${z.id} · ${t.statusSlovami(z.status)}`,
    '',
    z.nazvanie,
    `Аккаунт: ${t.vidAkkauntaSlovami(z.vid_akkaunta)}`,
    // Срок печатается, только если он есть: у уровней подписки его
    // нет, и «0 месяцев» в карточке заказа читалось бы поломкой.
    z.mesyacev > 0
      ? `${rubliIli(z.cena_kop)} · ${sklonenie(z.mesyacev, 'месяц', 'месяца', 'месяцев')}`
      : rubliIli(z.cena_kop),
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
  // Деньги: сколько заказ держит и сколько из этого пришло с баланса.
  // Помощнику это нужно, чтобы понимать, чего ждать «живыми».
  if (z.oplacheno_kop > 0) {
    strok.push(
      z.s_balansa_kop > 0
        ? `Оплачено: ${rubli(z.oplacheno_kop)} (с баланса ${rubli(z.s_balansa_kop)})`
        : `Оплачено: ${rubli(z.oplacheno_kop)}`,
    );
  }
  if (z.status === 'zhdem_kod' && z.kod_zapros_v) {
    strok.push(`Код запрошен: ${momentSlovami(new Date(z.kod_zapros_v), r.poyas)} — ждём ответа`);
  }
  if (z.kod_poluchen_v) strok.push(`Код получен: ${momentSlovami(new Date(z.kod_poluchen_v), r.poyas)}`);
  if (z.pismo_v) strok.push(`Письмо восстановления отправлено: ${momentSlovami(new Date(z.pismo_v), r.poyas)}`);
  if (z.prichina_otmeny) strok.push(`Причина отмены: ${t.prichinaSlovami(z.prichina_otmeny)}`);
  if (svoi.est(l.db, z.id)) strok.push('Данные аккаунта покупателя записаны');
  if (dostupy.est(l.db, z.id)) strok.push('Доступ записан');
  // Заказ, о котором никому не сообщили, обязан быть виден как таковой:
  // иначе он тихо лежит в очереди и ждёт, пока кто-нибудь туда заглянет.
  if (zakazy.sobytiya(l.db, z.id).some((s) => s.chto === 'команду уведомить не удалось')) {
    strok.push('⚠ уведомление команде не дошло — заказ найден в очереди');
  }
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
  try {
    const oplachen = z.status !== 'zhdet_oplaty';
    const shapka = oplachen ? 'Новый оплаченный заказ.' : 'Новый заказ. Оплата пока вне бота.';
    const itog = await uvedom.komande(l, `${shapka}\n\n${opisanie(l, z)}`, klav.novyZakazAdminu(z, oplachen));

    if (itog.doshlo > 0) {
      zakazy.sobytie(l.db, z.id, 'команда уведомлена', null, `дошло ${itog.doshlo} из ${itog.vsego}`);
      return;
    }
    // Никому не дошло. Заказ от этого не пропадает: он записан
    // и стоит в очереди — администратор увидит его, как только
    // откроет служебный раздел. Но в журнале это должно быть видно.
    const komu = itog.nedostupny
      .map((x) => uvedom.pochemuSlovami(x.pochemu, x.tgId))
      .join('; ');
    zakazy.sobytie(l.db, z.id, 'команду уведомить не удалось', null, komu || 'команда пуста');
    zhurnal.oshibka(
      `заказ № ${z.id} записан, но передать его некому: ${komu || 'в команде никого нет'}. ` +
        'Заказ ждёт в очереди на выдачу.',
    );
  } catch (e) {
    // Последняя черта. Уведомление администратора не имеет права
    // уронить путь покупателя: заказ уже принят и записан.
    zhurnal.oshibka(`уведомление о заказе № ${z.id} не отправлено:`, e);
  }
}

export function podklyuchit(bot: Bot, l: Lavka): void {
  const r = () => raspisanie(l.db, l.n);

  const sluzhebnoe = async (ctx: Context, pravkoy: boolean) => {
    const rl = svoy(l, ctx);
    if (!rl) return;
    const och = zakazy.ochered(l.db);
    const neop = zakazy.neoplachennye(l.db);
    const moi = zakazy.vRabote(l.db, ctx.from!.id);
    const zhdutKod = moi.filter((z) => z.status === 'zhdem_kod').length;
    const text = [
      rl === 'vladelec' ? 'Служебное. Вы владелец.' : 'Служебное. Вы помощник.',
      '',
      `В очереди на выдачу: ${och.length}`,
      // Свои заказы отдельной строкой: помощник ведёт несколько разом,
      // и «сколько на мне» — первое, что он хочет знать.
      `На вас: ${moi.length}${zhdutKod ? `, из них ждут код: ${zhdutKod}` : ''}`,
      `Ждут оплаты: ${neop.length}`,
    ].join('\n');
    if (pravkoy) await pravit(ctx, text, klav.sluzhebnoe(rl));
    else await ctx.reply(text, { reply_markup: klav.sluzhebnoe(rl) });
  };

  // Не свой, набравший эти слова руками, не должен упереться в тишину:
  // пропускаем дальше, и он получит обычный ответ на непонятое.
  bot.hears(klav.KNOPKA_LAVKA, async (ctx, next) => {
    if (!svoy(l, ctx)) return next();
    await sluzhebnoe(ctx, false);
  });
  bot.command('lavka', async (ctx, next) => {
    if (!svoy(l, ctx)) return next();
    await sluzhebnoe(ctx, false);
  });
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

  bot.callbackQuery('amoi', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!svoy(l, ctx)) return;
    const spisok = zakazy.vRabote(l.db, ctx.from.id);
    const text = spisok.length
      ? `На вас ${spisok.length}. Открывайте любой — они идут независимо друг от друга.`
      : 'На вас сейчас ничего нет. Возьмите заказ из очереди.';
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
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z)));
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
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z)));
  });

  bot.callbackQuery(/^avz:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    const vzyal = zakazy.vzyat(l.db, id, ctx.from.id);
    await ctx.answerCallbackQuery(vzyal ? 'Взяли в работу' : 'Заказ уже взят или выдан');
    const z = zakazy.po(l.db, id);
    if (!z) return;
    // Покупателю сообщаем о КАЖДОЙ смене состояния, которая его
    // касается: молчание между оплатой и выдачей — это ровно то время,
    // когда человек начинает думать, что его обманули.
    if (vzyal) await uvedom.cheloveku(l, z.tg_id, t.vzyatVRabotu(z));
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z)));
  });

  bot.callbackQuery(/^aver:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    zakazy.vernutVOchered(l.db, id, ctx.from.id);
    await ctx.answerCallbackQuery('Вернул в очередь');
    const z = zakazy.po(l.db, id);
    if (z) await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z)));
  });

  /**
   * Отмена заказа — и возврат денег на баланс.
   *
   * Одна дверь на все причины: ручная отмена, неверный пароль,
   * не пришедший код. Деньги возвращает `zakazy.otmenit` одной
   * транзакцией с отменой, а здесь остаётся сказать об этом человеку.
   */
  const otmenit = async (
    ctx: Context,
    id: number,
    prichina: zakazy.PrichinaOtmeny,
  ): Promise<void> => {
    const itog = zakazy.otmenit(l.db, id, ctx.from!.id, prichina);
    if (!itog.otmenen) {
      await ctx.answerCallbackQuery(
        itog.pochemu === 'net_pisma'
          ? 'Сначала отправьте письмо восстановления и отметьте это'
          : 'Заказ уже закрыт',
      );
      return;
    }
    await ctx.answerCallbackQuery(itog.vernuli > 0 ? 'Отменил, деньги на балансе' : 'Отменил');
    const z = zakazy.po(l.db, id);
    if (!z) return;
    await uvedom.cheloveku(
      l,
      z.tg_id,
      t.zakazOtmenen(z, prichina, itog.vernuli, koshelek.balans(l.db, z.tg_id)),
    );
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z)));
  };

  bot.callbackQuery(/^aotm:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await otmenit(ctx, Number(ctx.match![1]), 'ruchnaya');
  });

  // ── свой аккаунт покупателя: код, письмо, неверный пароль ──────────

  /**
   * Запрос кода. Помощник дошёл до шага входа.
   *
   * Отказываемся, если у этого же покупателя уже ждут код по ДРУГОМУ
   * заказу: разговор один на человека, и второй запрос затёр бы
   * первый — код пришёл бы не к тому заказу, а час на ответ шёл бы
   * у обоих.
   */
  bot.callbackQuery(/^akodz:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    const z = zakazy.po(l.db, id);
    if (!z) return void (await ctx.answerCallbackQuery('Заказа нет'));
    if (z.vid_akkaunta !== 'svoy') {
      return void (await ctx.answerCallbackQuery('У этого заказа новый аккаунт — код не нужен'));
    }
    const drugoy = zakazy.zhdutKodaOt(l.db, z.tg_id).find((x) => x.id !== z.id);
    if (drugoy) {
      return void (await ctx.answerCallbackQuery(`Покупатель уже вводит код по заказу № ${drugoy.id}`));
    }
    if (!zakazy.zaprositKod(l.db, id, ctx.from.id)) {
      return void (await ctx.answerCallbackQuery('Сейчас код запросить нельзя'));
    }
    kody.zaprosit(l.db, id, ctx.from.id);
    dialogi.postavit(l.db, z.tg_id, 'zhdem_kod', id, {}, l.n.klyuchDostupov);

    const svezhy = zakazy.po(l.db, id) as zakazy.Zakaz;
    const doshlo = await uvedom.cheloveku(l, z.tg_id, t.prosimKod(svezhy, r().obeshchanieMinut));
    await ctx.answerCallbackQuery(doshlo.doshlo ? 'Спросил у покупателя' : 'Покупателю не доставлено');
    if (!doshlo.doshlo) {
      zakazy.sobytie(l.db, id, 'просьба о коде не доставлена', ctx.from.id, doshlo.pochemu);
    }
    await pravit(ctx, opisanie(l, svezhy), klav.zakazAdminu(svezhy, pod(l, svezhy)));
  });

  /** Показать пришедший код. Расшифровка — только здесь и только своим. */
  bot.callbackQuery(/^akodp:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    const k = kody.vzyat(l.db, id, l.n.klyuchDostupov);
    if (!k) return void (await ctx.answerCallbackQuery('Кода по этому заказу нет'));
    await ctx.answerCallbackQuery();
    await ctx.reply(`Код по заказу № ${id}: ${k.kod}`, { reply_markup: klav.kodAdminu(id) });
  });

  /** Логин почты и пароль, которые принёс покупатель. */
  bot.callbackQuery(/^aakk:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    let a;
    try {
      a = svoi.vzyat(l.db, id, l.n.klyuchDostupov);
    } catch (e) {
      zhurnal.oshibka(`не читается аккаунт покупателя по заказу ${id}:`, e);
      return void (await ctx.answerCallbackQuery('Не читается запись аккаунта'));
    }
    if (!a) return void (await ctx.answerCallbackQuery('Покупатель не передавал свой аккаунт'));
    await ctx.answerCallbackQuery();
    zakazy.sobytie(l.db, id, 'помощник открыл данные аккаунта', ctx.from.id);
    await ctx.reply(
      [`Заказ № ${id}. Аккаунт покупателя.`, '', `Почта: ${a.pochta}`, `Пароль: ${a.parol}`].join('\n'),
      { reply_markup: klav.kodAdminu(id) },
    );
  });

  /**
   * Письмо восстановления отправлено.
   *
   * Это ЗАМОК для отмены по неверному паролю, а не заметка: порядок
   * строгий — сначала человек получает письмо, которым вернёт себе
   * доступ, и только потом заказ отменяется.
   */
  bot.callbackQuery(/^apis:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    const id = Number(ctx.match![1]);
    const vyshlo = zakazy.otmetitPismo(l.db, id, ctx.from.id);
    await ctx.answerCallbackQuery(vyshlo ? 'Отметил. Теперь можно отменять' : 'Сейчас это нельзя отметить');
    const z = zakazy.po(l.db, id);
    if (z) await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z)));
  });

  bot.callbackQuery(/^aparol:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await otmenit(ctx, Number(ctx.match![1]), 'nevernyy_parol');
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
    // Дата окончания считается ТОЛЬКО когда срок объявлен. У уровня
    // подписки его нет, и «доступ до сегодня» было бы враньём; в этом
    // случае в базу уезжает null, а сообщение покупателю про срок
    // не говорит вовсе.
    const dostupDoDaty = z.dostup_do
      ? new Date(z.dostup_do)
      : z.mesyacev > 0
        ? dostupDo(new Date(), z.mesyacev)
        : null;
    const dlyaPokupatelya = { ...z, dostup_do: dostupDoDaty ? dostupDoDaty.toISOString() : null };
    const otpravka = await uvedom.cheloveku(
      l,
      z.tg_id,
      t.dostupVydan(dlyaPokupatelya, d.login, d.parol, d.zametka, r()),
    );
    if (!otpravka.doshlo) {
      await ctx.answerCallbackQuery('Сообщение покупателю не доставлено');
      await ctx.reply(
        [
          `Покупателю по заказу № ${id} доступ не доставлен:`,
          uvedom.pochemuSlovami(otpravka.pochemu, z.tg_id) + '.',
          '',
          'Заказ оставил НЕвыданным — иначе он числился бы закрытым, а человек ' +
            'остался бы без доступа.',
        ].join('\n'),
      );
      zakazy.sobytie(l.db, id, 'доступ не доставлен покупателю', ctx.from.id, otpravka.pochemu);
      return;
    }
    zakazy.otmetitVydannym(l.db, id, dostupDoDaty, ctx.from.id);
    await ctx.answerCallbackQuery('Отправил покупателю');
    const svezhy = zakazy.po(l.db, id);
    if (svezhy) await pravit(ctx, opisanie(l, svezhy), klav.zakazAdminu(svezhy, pod(l, svezhy)));
  });

  // ── владелец ───────────────────────────────────────────────────────

  bot.callbackQuery('alyudi', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    const spisok = lyudi.spisok(l.db, 20);
    const strok = spisok.map((c) => {
      const b = koshelek.balans(l.db, c.tg_id);
      const hvost = b > 0 ? `, баланс ${rubli(b)}` : '';
      return `${c.tg_id} · ${lyudi.podpis(c, c.tg_id)} · заказов ${c.zakazov}, выдано ${c.vydano}${hvost}`;
    });
    await pravit(
      ctx,
      [`Всего людей: ${lyudi.skolkoVsego(l.db)}. Последние двадцать:`, '', ...strok].join('\n'),
      klav.lyudiVladelca(),
    );
  });

  /**
   * Пополнение баланса. Пока оплаты нет, это единственный способ
   * положить человеку деньги, кроме возврата по отменённому заказу.
   *
   * ВЫВОДА ОТСЮДА НЕТ и не будет: отрицательное число `popolnit`
   * не примет, а другой двери к чужому балансу в боте не существует.
   */
  bot.callbackQuery('abal', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_popolnenie', null, {}, l.n.klyuchDostupov);
    await ctx.reply(
      [
        'Пришлите одной строкой: идентификатор человека и сумму в рублях.',
        '',
        'Например: 42 1500',
        '',
        'Сумма только положительная: списывать с чужого баланса руками нельзя.',
      ].join('\n'),
      { reply_markup: klav.otmenaVvoda() },
    );
  });

  /**
   * Деньги в сводке. НОЛЬ КАК ЦЕНА НЕ ПЕЧАТАЕТСЯ НИКОГДА: пока прайса
   * нет, у заказа записан ноль, и «на 0 ₽» читается как «продано
   * бесплатно» — то же самое враньё, от которого на сайте стоит слово
   * «уточняется». Сумма показывается только за заказы с объявленной
   * ценой, а про остальные говорится прямо: иначе неполная сумма
   * выглядит полной.
   */
  const dengi = (summaKop: number, vsego: number, bezCeny: number): string => {
    if (vsego === 0) return 'выдач пока не было';
    if (bezCeny >= vsego) return 'цена не объявлена';
    if (bezCeny > 0) return `${rubli(summaKop)} (у ${bezCeny} из ${vsego} цена не объявлена)`;
    return rubli(summaKop);
  };

  bot.callbackQuery('astat', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(NET_PRAV));
    await ctx.answerCallbackQuery();
    const s = zakazy.statistika(l.db);
    const poTovaram = s.poTovaram.map(
      (p) => `  ${p.produkt_id}: ${p.skolko} · ${dengi(p.summa_kop, p.skolko, p.bez_ceny)}`,
    );
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
        `Выручка по выданным: ${dengi(s.vyruchkaKop, s.poStatusam['vydan'] ?? 0, s.bezCeny)}`,
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

    // Две команды выходят из разговора всегда. Иначе человек, начавший
    // ввод и передумавший, остаётся заперт: его «/start» уходит в
    // черновик как логин, и кнопок он больше не видит.
    if (/^\/(start|otmena)(@\S+)?$/.test(text.trim())) {
      dialogi.zabyt(l.db, tgId);
      return next();
    }

    // Шаги ПОКУПАТЕЛЯ идут до проверки роли: человек, вводящий пароль
    // от своего аккаунта, не должен упереться в «только для владельца».
    if (d.shag === 'zhdem_vopros') {
      await prinyatVopros(l, tgId, text);
      await ctx.reply(t.VOPROS_PRINYAT);
      return;
    }
    if (d.shag === 'zhdem_pochtu') return void (await prinyatPochtu(l, ctx, text));
    if (d.shag === 'zhdem_parol_akkaunta') return void (await prinyatParolAkkaunta(l, ctx, text));
    if (d.shag === 'zhdem_kod') return void (await prinyatKod(l, ctx, text, d.zakazId));

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

      // Проверяем СРАЗУ, а не в момент первого заказа. «chat not
      // found» здесь — обычное дело: человек мог ни разу не открывать
      // бота, и узнать об этом лучше сейчас.
      const dostupen = await uvedom.cheloveku(
        l,
        id,
        'Вас добавили помощником в Нейролавке. В нижнем меню появился раздел «Заказы лавки»: ' +
          'там очередь на выдачу. Нажмите /start, чтобы меню обновилось.',
      );
      if (dostupen.doshlo) {
        await ctx.reply(`Добавил ${id} помощником, сообщение ему дошло. Заказы теперь приходят и ему.`);
      } else {
        await ctx.reply(
          [
            `Добавил ${id} помощником, но написать ему я не могу:`,
            uvedom.pochemuSlovami(dostupen.pochemu, id) + '.',
            '',
            dostupen.pochemu === 'ne_zapuskal'
              ? 'Пусть он откроет бота и нажмёт «Начать» — после этого заказы начнут ему приходить. ' +
                'До тех пор он в команде числится, но уведомлений не получает.'
              : 'Пока это так, заказы ему не придут.',
          ].join('\n'),
        );
      }
      return;
    }

    if (d.shag === 'zhdem_popolnenie') {
      if (!komanda.vladelec(l.db, tgId)) {
        dialogi.zabyt(l.db, tgId);
        await ctx.reply(NET_PRAV);
        return;
      }
      dialogi.zabyt(l.db, tgId);
      const chasti = text.trim().split(/\s+/);
      const komu = Number(chasti[0]);
      const rublei = Number((chasti[1] ?? '').replace(',', '.'));
      if (!Number.isInteger(komu) || komu <= 0 || !Number.isFinite(rublei) || rublei <= 0) {
        await ctx.reply('Нужны два числа: идентификатор и сумма в рублях больше нуля. Например: 42 1500');
        return;
      }
      if (!lyudi.chelovek(l.db, komu)) {
        await ctx.reply('Такого человека в базе нет. Он должен хотя бы раз написать боту.');
        return;
      }
      const kop = Math.round(rublei * 100);
      const stalo = koshelek.popolnit(l.db, komu, kop, 'пополнение владельцем', tgId);
      await ctx.reply(`Пополнил ${komu} на ${rubli(kop)}. Стало ${rubli(stalo)}.`);
      await uvedom.cheloveku(
        l,
        komu,
        [
          `Баланс пополнен на ${rubli(kop)}.`,
          '',
          `Сейчас на балансе ${rubli(stalo)}. Балансом оплачивается заказ — ` +
            'целиком или частично, при оформлении он спишется сам.',
        ].join('\n'),
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
