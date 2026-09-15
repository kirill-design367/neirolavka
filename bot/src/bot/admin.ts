/**
 * Что видит администратор.
 *
 * ПО-АНГЛИЙСКИ. Решение владельца, сентябрь 2026: покупатель читает
 * по-русски, команда — по-английски. Все строки, которые здесь
 * показываются, живут в `texty-komandy.ts`; вписанных сюда строк
 * быть не должно — иначе половина экрана однажды снова заговорит
 * по-русски, и заметит это помощник, а не мы.
 *
 * Исключение ровно одно и оно намеренное: `zakazy.sobytie(...)` пишет
 * историю заказа ПО-РУССКИ. Это запись о случившемся, лежащая в базе
 * у всех прежних заказов, а не строка на экране.
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
import { postavitOpisanie } from './opisanie.js';
import { rubli } from '../lib/katalog.js';
import { chasSlovami, mnozhestvennoe, srokVydachi, dostupDo } from '../lib/vremya.js';
import * as t from '../lib/texty.js';
import * as k from './texty-komandy.js';
import * as uvedom from './uvedomleniya.js';
import { pravit, prinyatVopros, prinyatPochtu, prinyatParolAkkaunta, prinyatKod } from './pokupatel.js';
import { zhurnal } from '../lib/zhurnal.js';



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
    `${k.ZAKAZ(z.id)} · ${k.status(z.status)}`,
    '',
    z.nazvanie,
    `${k.AKKAUNT}: ${k.vidAkkaunta(z.vid_akkaunta)}`,
    // Срок печатается, только если он есть: у уровней подписки его
    // нет, и «0 месяцев» в карточке заказа читалось бы поломкой.
    z.mesyacev > 0
      ? `${k.cena(z.cena_kop)} · ${mnozhestvennoe(z.mesyacev, 'month', 'months')}`
      : k.cena(z.cena_kop),
    `${k.POKUPATEL}: ${lyudi.podpis(c, z.tg_id)}`,
    `${k.OFORMLEN}: ${k.moment(z.sozdan, r.poyas)}`,
  ];
  if (z.srok_do) {
    const srok = new Date(z.srok_do);
    strok.push(`${k.OBESHCHANO}: ${k.moment(srok, r.poyas)} (${k.ostalos(new Date(), srok)})`);
  }
  if (z.ispolnitel) strok.push(`${k.VZYAL}: ${z.ispolnitel}`);
  if (z.status === 'vydan' && z.dostup_do) {
    strok.push(`${k.DOSTUP_DO}: ${k.data(z.dostup_do, r.poyas)}`);
  }
  // Деньги: сколько заказ держит и сколько из этого пришло с баланса.
  // Помощнику это нужно, чтобы понимать, чего ждать «живыми».
  if (z.oplacheno_kop > 0) {
    strok.push(
      z.s_balansa_kop > 0
        ? `${k.OPLACHENO}: ${rubli(z.oplacheno_kop)} (${k.S_BALANSA} ${rubli(z.s_balansa_kop)})`
        : `${k.OPLACHENO}: ${rubli(z.oplacheno_kop)}`,
    );
  }
  if (z.status === 'zhdem_kod' && z.kod_zapros_v) {
    strok.push(`${k.KOD_ZAPROSHEN}: ${k.moment(z.kod_zapros_v, r.poyas)} — ${k.ZHDEM_OTVETA}`);
  }
  if (z.kod_poluchen_v) strok.push(`${k.KOD_POLUCHEN}: ${k.moment(z.kod_poluchen_v, r.poyas)}`);
  if (z.pismo_v) strok.push(`${k.PISMO_OTPRAVLENO}: ${k.moment(z.pismo_v, r.poyas)}`);
  if (z.prichina_otmeny) strok.push(`${k.PRICHINA_OTMENY}: ${k.prichina(z.prichina_otmeny)}`);
  if (svoi.est(l.db, z.id)) strok.push(k.AKKAUNT_ZAPISAN);
  if (dostupy.est(l.db, z.id)) strok.push(k.DOSTUP_ZAPISAN);
  // Заказ, о котором никому не сообщили, обязан быть виден как таковой:
  // иначе он тихо лежит в очереди и ждёт, пока кто-нибудь туда заглянет.
  /* Признак ищется по РУССКОЙ записи истории, и это не недосмотр
     перевода: `sobytie` пишет историю по-русски у всех заказов,
     включая заведённые до того, как служебное заговорило
     по-английски. Перевести признак значило бы перестать находить
     его у прежних заказов. */
  if (zakazy.sobytiya(l.db, z.id).some((s) => s.chto === 'команду уведомить не удалось')) {
    strok.push(k.NE_DOSHLO_KOMANDE);
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
    const shapka = oplachen ? k.NOVY_ZAKAZ_OPLACHEN : k.NOVY_ZAKAZ;
    const itog = await uvedom.komande(l, `${shapka}\n\n${opisanie(l, z)}`, (tgId: number) => klav.novyZakazAdminu(z, oplachen, komanda.vladelec(l.db, tgId)));

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
      rl === 'vladelec' ? k.SLUZHEBNOE_VLADELEC : k.SLUZHEBNOE_POMOSHNIK,
      '',
      k.V_OCHEREDI(och.length),
      // Свои заказы отдельной строкой: помощник ведёт несколько разом,
      // и «сколько на мне» — первое, что он хочет знать.
      k.NA_VAS(moi.length, zhdutKod),
      k.ZHDUT_OPLATY(neop.length),
    ].join('\n');
    if (pravkoy) await pravit(ctx, text, klav.sluzhebnoe(rl));
    else await ctx.reply(text, { reply_markup: klav.sluzhebnoe(rl) });
  };

  /* Не свой, набравший эти слова руками, не должен упереться в тишину:
     пропускаем дальше, и он получит обычный ответ на непонятое.

     Подписей две — нынешняя английская и прежняя русская. Нижняя
     клавиатура живёт в клиенте Telegram, пока человек не нажмёт
     «Старт»: у помощника, открывшего бота до выкладки, на экране
     по-прежнему «Заказы лавки». */
  bot.hears([klav.KNOPKA_LAVKA, klav.KNOPKA_LAVKA_STARAYA], async (ctx, next) => {
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
      ? k.OCHERED_EST(spisok.length)
      : k.OCHERED_PUSTA;
    await pravit(ctx, text, klav.ocheredAdminu(spisok));
  });

  bot.callbackQuery('amoi', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!svoy(l, ctx)) return;
    const spisok = zakazy.vRabote(l.db, ctx.from.id);
    const text = spisok.length
      ? k.MOI_EST(spisok.length)
      : k.MOI_PUSTO;
    await pravit(ctx, text, klav.ocheredAdminu(spisok));
  });

  bot.callbackQuery('aneopl', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!svoy(l, ctx)) return;
    const spisok = zakazy.neoplachennye(l.db);
    const text = spisok.length
      ? k.NEOPL_EST(spisok.length)
      : k.NEOPL_PUSTO;
    await pravit(ctx, text, klav.ocheredAdminu(spisok));
  });

  bot.callbackQuery(/^az:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!svoy(l, ctx)) return;
    const z = zakazy.po(l.db, Number(ctx.match![1]));
    if (!z) return pravit(ctx, k.NET_ZAKAZA, klav.nazadSluzhebnoe());
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z), komanda.vladelec(l.db, ctx.from.id)));
  });

  // ── движение заказа ────────────────────────────────────────────────

  /* Отметка оплаты — деньги: см. тот же разбор в admin/index.ts.
     Панель и бот зовут одни переходы, значит и замок должен стоять
     на обеих дверях, иначе закрытая панель ничего не значит. */
  bot.callbackQuery(/^aopl:(\d+)$/, async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const id = Number(ctx.match![1]);
    const srok = srokVydachi(new Date(), r());
    const vyshlo = zakazy.otmetitOplachennym(l.db, id, srok.do, ctx.from.id);
    await ctx.answerCallbackQuery(vyshlo ? k.OTMETIL_OPLATU : k.UZHE_NE_ZHDET_OPLATY);
    const z = zakazy.po(l.db, id);
    if (!z) return;
    if (vyshlo) await uvedom.cheloveku(l, z.tg_id, t.oplataPodtverzhdena(z, srok, r()));
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z), komanda.vladelec(l.db, ctx.from.id)));
  });

  bot.callbackQuery(/^avz:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const id = Number(ctx.match![1]);
    const vzyal = zakazy.vzyat(l.db, id, ctx.from.id);
    await ctx.answerCallbackQuery(vzyal ? k.VZYALI : k.UZHE_VZYAT);
    const z = zakazy.po(l.db, id);
    if (!z) return;
    // Покупателю сообщаем о КАЖДОЙ смене состояния, которая его
    // касается: молчание между оплатой и выдачей — это ровно то время,
    // когда человек начинает думать, что его обманули.
    if (vzyal) await uvedom.cheloveku(l, z.tg_id, t.vzyatVRabotu(z, srokVydachi(new Date(), r()), r()));
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z), komanda.vladelec(l.db, ctx.from.id)));
  });

  bot.callbackQuery(/^aver:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const id = Number(ctx.match![1]);
    zakazy.vernutVOchered(l.db, id, ctx.from.id);
    await ctx.answerCallbackQuery(k.VERNUL_V_OCHERED);
    const z = zakazy.po(l.db, id);
    if (z) await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z), komanda.vladelec(l.db, ctx.from.id)));
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
        itog.pochemu === 'net_pisma' ? k.SNACHALA_PISMO : k.UZHE_ZAKRYT,
      );
      return;
    }
    await ctx.answerCallbackQuery(itog.vernuli > 0 ? k.OTMENIL_DENGI : k.OTMENIL);
    const z = zakazy.po(l.db, id);
    if (!z) return;
    // Ничейному заказу сказать некому: покупатель ещё не пришёл в бот.
    if (z.tg_id !== null) {
      await uvedom.cheloveku(
        l,
        z.tg_id,
        t.zakazOtmenen(z, prichina, itog.vernuli, koshelek.balans(l.db, z.tg_id)),
      );
    }
    await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z), komanda.vladelec(l.db, ctx.from?.id ?? 0)));
  };

  /* «Отменить заказ» больше не отменяет сразу: сначала спрашиваем
     причину. Причина хранится кодом, по ней считается статистика
     и решается, что показать покупателю, — молча ставить одну
     и ту же значило бы, что статистика отмен ничего не показывает. */
  bot.callbackQuery(/^aotm:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const z = zakazy.po(l.db, Number(ctx.match![1]));
    if (!z) return pravit(ctx, k.NET_ZAKAZA, klav.nazadSluzhebnoe());
    await pravit(ctx, `${opisanie(l, z)}\n\n${k.POCHEMU_OTMENYAEM}`, klav.prichinaOtmeny(z));
  });

  bot.callbackQuery(/^aotmp:(\d+):([a-z_]+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const prichina = zakazy.razobratPrichinu(ctx.match![2]);
    if (!prichina) return void (await ctx.answerCallbackQuery(k.NET_TAKOY_PRICHINY));
    await otmenit(ctx, Number(ctx.match![1]), prichina);
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
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const id = Number(ctx.match![1]);
    const z = zakazy.po(l.db, id);
    if (!z) return void (await ctx.answerCallbackQuery(k.NET_ZAKAZA_KRATKO));
    if (z.vid_akkaunta !== 'svoy') {
      return void (await ctx.answerCallbackQuery(k.KOD_NE_NUZHEN));
    }
    /* Ничейный заказ сюда не доходит: `svoy` ставится только
       забранному. Проверка стоит не «на всякий случай», а затем,
       чтобы это утверждение было ПРОВЕРЯЕМЫМ: сломай его кто-нибудь
       завтра — здесь будет честный отказ, а не разговор о коде,
       заведённый неизвестно кому. */
    if (z.tg_id === null) {
      return void (await ctx.answerCallbackQuery(k.ZAKAZ_NE_ZABRAN));
    }
    const drugoy = zakazy.zhdutKodaOt(l.db, z.tg_id).find((x) => x.id !== z.id);
    if (drugoy) {
      return void (await ctx.answerCallbackQuery(k.UZHE_VVODIT_KOD(drugoy.id)));
    }
    if (!zakazy.zaprositKod(l.db, id, ctx.from.id)) {
      return void (await ctx.answerCallbackQuery(k.KOD_SEYCHAS_NELZYA));
    }
    kody.zaprosit(l.db, id, ctx.from.id);
    dialogi.postavit(l.db, z.tg_id, 'zhdem_kod', id, {}, l.n.klyuchDostupov);

    const svezhy = zakazy.po(l.db, id) as zakazy.Zakaz;
    const doshlo = await uvedom.cheloveku(l, z.tg_id, t.prosimKod(svezhy, r().obeshchanieMinut));
    await ctx.answerCallbackQuery(doshlo.doshlo ? k.SPROSILI_KOD : k.KOD_NE_DOSHEL);
    if (!doshlo.doshlo) {
      zakazy.sobytie(l.db, id, 'просьба о коде не доставлена', ctx.from.id, doshlo.pochemu);
    }
    await pravit(ctx, opisanie(l, svezhy), klav.zakazAdminu(svezhy, pod(l, svezhy), komanda.vladelec(l.db, ctx.from.id)));
  });

  /** Показать пришедший код. Расшифровка — только здесь и только своим. */
  bot.callbackQuery(/^akodp:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const id = Number(ctx.match![1]);
    const kd = kody.vzyat(l.db, id, l.n.klyuchDostupov);
    if (!kd) return void (await ctx.answerCallbackQuery(k.KODA_NET));
    await ctx.answerCallbackQuery();
    await ctx.reply(k.KOD_PO_ZAKAZU(id, kd.kod), { reply_markup: klav.kodAdminu(id) });
  });

  /** Логин почты и пароль, которые принёс покупатель. */
  bot.callbackQuery(/^aakk:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const id = Number(ctx.match![1]);
    let a;
    try {
      a = svoi.vzyat(l.db, id, l.n.klyuchDostupov);
    } catch (e) {
      zhurnal.oshibka(`не читается аккаунт покупателя по заказу ${id}:`, e);
      return void (await ctx.answerCallbackQuery(k.NE_CHITAETSYA_AKKAUNT));
    }
    if (!a) return void (await ctx.answerCallbackQuery(k.NET_AKKAUNTA));
    await ctx.answerCallbackQuery();
    zakazy.sobytie(l.db, id, 'помощник открыл данные аккаунта', ctx.from.id);
    await ctx.reply(
      [k.AKKAUNT_PLASHKA(id), '', `${k.POCHTA}: ${a.pochta}`, `${k.PAROL}: ${a.parol}`].join('\n'),
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
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const id = Number(ctx.match![1]);
    const vyshlo = zakazy.otmetitPismo(l.db, id, ctx.from.id);
    await ctx.answerCallbackQuery(vyshlo ? k.OTMETIL_PISMO : k.PISMO_SEYCHAS_NELZYA);
    const z = zakazy.po(l.db, id);
    if (z) await pravit(ctx, opisanie(l, z), klav.zakazAdminu(z, pod(l, z), komanda.vladelec(l.db, ctx.from.id)));
  });

  bot.callbackQuery(/^aparol:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    await otmenit(ctx, Number(ctx.match![1]), 'nevernyy_parol');
  });

  // ── ввод доступа ───────────────────────────────────────────────────

  bot.callbackQuery(/^avv:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    await ctx.answerCallbackQuery();
    const id = Number(ctx.match![1]);
    const z = zakazy.po(l.db, id);
    if (!z) return;
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_login', id, {}, l.n.klyuchDostupov);
    await ctx.reply(
      k.PROSIM_LOGIN(id),
      { reply_markup: klav.otmenaVvoda() },
    );
  });

  bot.callbackQuery('aotmena', async (ctx) => {
    await ctx.answerCallbackQuery(k.VVOD_OTMENEN_KRATKO);
    dialogi.zabyt(l.db, ctx.from.id);
    await pravit(ctx, k.VVOD_OTMENEN);
  });

  bot.callbackQuery(/^avyd:(\d+)$/, async (ctx) => {
    if (!svoy(l, ctx)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    const id = Number(ctx.match![1]);
    const z = zakazy.po(l.db, id);
    if (!z) return void (await ctx.answerCallbackQuery(k.NET_ZAKAZA_KRATKO));
    if (!dostupy.est(l.db, id)) return void (await ctx.answerCallbackQuery(k.DOSTUP_NE_ZAPISAN));

    let d;
    try {
      d = dostupy.vzyat(l.db, id, l.n.klyuchDostupov);
    } catch (e) {
      zhurnal.oshibka(`не читается доступ по заказу ${id}:`, e);
      return void (await ctx.answerCallbackQuery(k.NE_CHITAETSYA_DOSTUP));
    }
    if (!d) return void (await ctx.answerCallbackQuery(k.DOSTUP_NE_ZAPISAN));

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
      await ctx.answerCallbackQuery(k.NE_DOSTAVLENO);
      await ctx.reply(k.NE_DOSTAVLEN_DOSTUP(id, uvedom.pochemuPoAngliyski(otpravka.pochemu, z.tg_id)));
      zakazy.sobytie(l.db, id, 'доступ не доставлен покупателю', ctx.from.id, otpravka.pochemu);
      return;
    }
    zakazy.otmetitVydannym(l.db, id, dostupDoDaty, ctx.from.id);
    await ctx.answerCallbackQuery(k.OTPRAVIL);
    const svezhy = zakazy.po(l.db, id);
    if (svezhy) await pravit(ctx, opisanie(l, svezhy), klav.zakazAdminu(svezhy, pod(l, svezhy), komanda.vladelec(l.db, ctx.from.id)));
  });

  // ── владелец ───────────────────────────────────────────────────────

  bot.callbackQuery('alyudi', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    await ctx.answerCallbackQuery();
    const spisok = lyudi.spisok(l.db, 20);
    const strok = spisok.map((c) =>
      `${c.tg_id} · ${k.LYUDI_STROKA(lyudi.podpis(c, c.tg_id), c.zakazov, c.vydano, koshelek.balans(l.db, c.tg_id))}`,
    );
    await pravit(
      ctx,
      [k.LYUDI_SHAPKA(lyudi.skolkoVsego(l.db)), '', ...strok].join('\n'),
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
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    await ctx.answerCallbackQuery();
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_popolnenie', null, {}, l.n.klyuchDostupov);
    await ctx.reply(
      k.PROSIM_POPOLNENIE,
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
    if (vsego === 0) return k.VYDACH_NE_BYLO;
    if (bezCeny >= vsego) return k.CENA_NE_OBYAVLENA;
    if (bezCeny > 0) return k.CHASTICHNO_BEZ_CENY(rubli(summaKop), bezCeny, vsego);
    return rubli(summaKop);
  };

  bot.callbackQuery('astat', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    await ctx.answerCallbackQuery();
    const s = zakazy.statistika(l.db);
    const poTovaram = s.poTovaram.map(
      (p) => `  ${p.produkt_id}: ${p.skolko} · ${dengi(p.summa_kop, p.skolko, p.bez_ceny)}`,
    );
    await pravit(
      ctx,
      [
        k.STATISTIKA,
        '',
        k.STAT_VSEGO(s.vsego, s.zaSutki),
        k.STAT_ZHDUT_OPLATY(s.poStatusam['zhdet_oplaty'] ?? 0),
        k.STAT_OPLACHENY(s.poStatusam['oplachen'] ?? 0),
        k.STAT_V_RABOTE(s.poStatusam['v_rabote'] ?? 0),
        k.STAT_VYDANY(s.poStatusam['vydan'] ?? 0),
        k.STAT_OTMENENY(s.poStatusam['otmenen'] ?? 0),
        '',
        k.STAT_VYRUCHKA(dengi(s.vyruchkaKop, s.poStatusam['vydan'] ?? 0, s.bezCeny)),
        s.srednyayaVydachaMinut === null ? k.STAT_NET_SREDNEGO : k.STAT_SREDNEE(s.srednyayaVydachaMinut),
        ...(poTovaram.length ? ['', k.STAT_PO_TOVARAM, ...poTovaram] : []),
      ].join('\n'),
      klav.nazadSluzhebnoe(),
    );
  });

  bot.callbackQuery('anastr', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    await ctx.answerCallbackQuery();
    const rr = r();
    await pravit(
      ctx,
      [
        k.NASTROYKI,
        '',
        k.CHASY_RABOTY(rr.rabotaS, rr.rabotaDo, rr.poyas),
        k.OBESHCHANIE(rr.obeshchanieMinut),
        k.OPLATA_STROKA(l.oplata.rabotaet ? l.oplata.imya : null),
        '',
        k.CHASY_SAMI,
      ].join('\n'),
      klav.nastroykiVladelca(),
    );
  });

  bot.callbackQuery('achasy', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    await ctx.answerCallbackQuery();
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_chasy', null, {}, l.n.klyuchDostupov);
    await ctx.reply(
      k.PROSIM_CHASY(r().rabotaS, r().rabotaDo),
      { reply_markup: klav.otmenaVvoda() },
    );
  });

  bot.callbackQuery('akom', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    await ctx.answerCallbackQuery();
    const strok = komanda
      .vsya(l.db)
      .map((s) => `${s.rol === 'vladelec' ? k.ROL_VLADELEC : k.ROL_POMOSHNIK} · ${s.tg_id}${s.imya ? ` · ${s.imya}` : ''}`);
    await pravit(
      ctx,
      [k.KOMANDA, '', ...strok, '', k.KOMANDA_POYASNENIE, '', k.KOMANDA_UBRAT].join('\n'),
      klav.komandaVladelca(),
    );
  });

  bot.callbackQuery('adobp', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from.id)) return void (await ctx.answerCallbackQuery(k.NET_PRAV));
    await ctx.answerCallbackQuery();
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_pomoshnika', null, {}, l.n.klyuchDostupov);
    await ctx.reply(
      k.PROSIM_POMOSHNIKA,
      { reply_markup: klav.otmenaVvoda() },
    );
  });

  bot.command('ubrat_pomoshnika', async (ctx) => {
    if (!komanda.vladelec(l.db, ctx.from?.id ?? 0)) return void (await ctx.reply(k.NET_PRAV));
    const id = Number((ctx.match ?? '').trim());
    if (!Number.isInteger(id) || id <= 0) return void (await ctx.reply(k.NUZHEN_ID));
    const itog = komanda.ubrat(l.db, id);
    await ctx.reply(itog.ok || !itog.pochemu ? k.UBRAL_IZ_KOMANDY(id) : k.NE_UBRAL(itog.pochemu));
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
    /* `(\s|$)` вместо `$` — и это условие того, чтобы метка вообще
       могла ехать в ссылке. Пока регулярка требовала конца строки,
       человек с незаконченным вводом, нажавший ссылку с довеском,
       оставался ЗАПЕРТ: его `/start metka_vk` уходил в черновик как
       логин или пароль, и кнопок он больше не видел. */
    if (/^\/(start|otmena)(@\S+)?(\s|$)/.test(text.trim())) {
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
    /* На сверке ждут нажатия, а не текста. Человек, приславший сюда
       ещё одно сообщение, чаще всего думает, что его не услышали, —
       поэтому не молчим и не роняем разговор, а показываем, куда
       нажать. Сообщение при этом убирается: на шаге сверки в нём
       вполне может оказаться пароль, набранный ещё раз. */
    if (d.shag === 'zhdem_svereniya' || d.shag === 'zhdem_svereniya_koda') {
      await ubratSoobshchenie(ctx);
      await ctx.reply(t.ZHDEM_KNOPKU);
      return;
    }

    /* Покупательский шаг, до которого не дошли руки выше, — это
       недосмотр, а не служебный шаг: без этой ветки он молча
       проваливался бы в проверку роли, разговор забывался бы,
       а человек получал бы «Не понял сообщение» на свой пароль. */
    if (dialogi.SHAGI_POKUPATELYA.includes(d.shag)) {
      zhurnal.oshibka(`шаг покупателя «${d.shag}» не разбирается — разговор потерян`);
      dialogi.zabyt(l.db, tgId);
      return next();
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
      await ctx.reply(k.LOGIN_ZAPISAN, {
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
        await ctx.reply(k.VVOD_POTERYALSYA);
        return;
      }
      dostupy.polozhit(l.db, id, { login, parol, zametka }, tgId, l.n.klyuchDostupov);
      zakazy.sobytie(l.db, id, 'доступ записан', tgId);
      await ctx.reply(
        [
          k.PROVERKA_DOSTUPA(id),
          '',
          `${k.LOGIN}: ${login}`,
          `${k.PAROL}: ${parol}`,
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
        await ctx.reply(k.NE_POHOZHE_NA_ID);
        return;
      }
      const c = lyudi.chelovek(l.db, id);
      komanda.dobavit(l.db, id, 'pomoshnik', c?.imya ?? '', tgId);

      // Проверяем СРАЗУ, а не в момент первого заказа. «chat not
      // found» здесь — обычное дело: человек мог ни разу не открывать
      // бота, и узнать об этом лучше сейчас.
      const dostupen = await uvedom.cheloveku(l, id, k.DOBAVLEN_POMOSHNIKOM);
      if (dostupen.doshlo) {
        await ctx.reply(k.DOBAVIL_DOSHLO(id));
      } else {
        await ctx.reply(
          k.DOBAVIL_NE_DOSHLO(
            id,
            uvedom.pochemuPoAngliyski(dostupen.pochemu, id),
            dostupen.pochemu === 'ne_zapuskal',
          ),
        );
      }
      return;
    }

    if (d.shag === 'zhdem_popolnenie') {
      if (!komanda.vladelec(l.db, tgId)) {
        dialogi.zabyt(l.db, tgId);
        await ctx.reply(k.NET_PRAV);
        return;
      }
      dialogi.zabyt(l.db, tgId);
      const chasti = text.trim().split(/\s+/);
      const komu = Number(chasti[0]);
      const rublei = Number((chasti[1] ?? '').replace(',', '.'));
      if (!Number.isInteger(komu) || komu <= 0 || !Number.isFinite(rublei) || rublei <= 0) {
        await ctx.reply(k.POPOLNENIE_NE_RAZOBRALI);
        return;
      }
      if (!lyudi.chelovek(l.db, komu)) {
        await ctx.reply(k.NET_TAKOGO_CHELOVEKA);
        return;
      }
      const kop = Math.round(rublei * 100);
      const stalo = koshelek.popolnit(l.db, komu, kop, 'пополнение владельцем', tgId);
      await ctx.reply(k.POPOLNIL(komu, kop, stalo));
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
        await ctx.reply(k.CHASY_NE_RAZOBRALI);
        return;
      }
      nastroykiBd.postavit(l.db, 'rabota_s', String(s), tgId);
      nastroykiBd.postavit(l.db, 'rabota_do', String(po), tgId);
      await ctx.reply(k.CHASY_POSTAVLENY(s!, po!));
      /* Описание бота — единственный текст, который живёт НЕ у нас,
         а на стороне Telegram, и сам собой не пересоберётся. Час
         выдачи в нём есть, значит после смены часов его надо
         переставить, иначе оно разойдётся с настройками до
         ближайшей выкладки. Ответ человеку уже ушёл: неудача
         описания его не касается. */
      void postavitOpisanie(l).catch((e) => zhurnal.oshibka('описание бота не переставилось:', e));
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
