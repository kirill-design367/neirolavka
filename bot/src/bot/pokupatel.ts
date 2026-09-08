/**
 * Что видит покупатель.
 *
 * Путь короткий и без развилок: что берём → какой уровень подписки →
 * проверьте заказ → оформлено. У продукта, где уровень один-единственный,
 * средний шаг пропадает: карточка сразу и есть подтверждение.
 * Всё остальное — «Мои заказы» и «Помощь».
 */

import type { Bot, Context, InlineKeyboard } from 'grammy';
import type { Lavka } from '../lavka.js';
import * as klav from './klaviatury.js';
import * as t from '../lib/texty.js';
import * as zakazy from '../db/zakazy.js';
import * as lyudi from '../db/lyudi.js';
import * as dostupy from '../db/dostupy.js';
import * as dialogi from '../db/dialogi.js';
import * as koshelek from '../db/koshelek.js';
import * as svoi from '../db/svoi.js';
import * as kody from '../db/kody.js';
import { raspisanie } from '../db/nastroyki.js';
import { rol } from '../db/komanda.js';
import { srokVydachi } from '../lib/vremya.js';
import { tovar, tovary, tarif, kopeyki, vybor, nazvanieVybora, idVybora, kopeykiVybora } from '../lib/katalog.js';
import type { Vybor } from '../lib/katalog.js';
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
    if (!tv) return pravit(ctx, t.TOVAR_PROPAL, klav.tovary(tovary()));

    // У продукта БЕЗ уровней выбирать нечего: подписка одна. Значит
    // его карточка сразу и есть подтверждение заказа — ровно как
    // на сайте, где такой продукт кладётся в чек нажатием по самой
    // карточке. Прежде здесь показывались уровни, и у Claude Pro
    // с Seedance выходил тупик: ни одной кнопки, кроме «← К списку».
    if (tv.plans.length === 0) {
      const v: Vybor = { product: tv, plan: null };
      return pravit(
        ctx,
        t.podtverzhdenie(nazvanieVybora(v), kopeykiVybora(v), srokVydachi(new Date(), r()), r(), tv.note),
        klav.oformitPodpisku(tv.id),
      );
    }

    await pravit(ctx, t.kartochkaTovara(tv.name, tv.tagline, tv.note), klav.tarify(tv));
  });

  bot.callbackQuery(/^p:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const nayden = tarif(ctx.match![1] as string);
    if (!nayden) return pravit(ctx, t.TOVAR_PROPAL, klav.tovary(tovary()));
    const { product, plan } = nayden;
    const srok = srokVydachi(new Date(), r());
    await pravit(
      ctx,
      t.podtverzhdenie(plan.title, kopeyki(plan), srok, r()),
      klav.oformit(plan.id, product.id),
    );
  });

  // Оформление идёт в ДВА нажатия, и второе — про аккаунт.
  //
  // «Оформить заказ» больше не создаёт заказ сразу: сначала человек
  // говорит, заводим ли мы аккаунт заново или он несёт свой. Пути
  // разные по цене для человека: во втором он вводит логин и пароль
  // и должен будет прислать код с почты. Спрашивать об этом после
  // создания заказа значило бы ставить его перед фактом.
  bot.callbackQuery(/^of:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match![1] as string;
    if (!vybor(id)) return pravit(ctx, t.TOVAR_PROPAL, klav.tovary(tovary()));
    await pravit(ctx, t.VYBOR_AKKAUNTA, klav.vyborAkkaunta(id));
  });

  // Новый аккаунт: вводить нечего, заказ появляется прямо здесь.
  bot.callbackQuery(/^nov:(.+)$/, async (ctx) => {
    const v = vybor(ctx.match![1] as string);
    if (!v) {
      await ctx.answerCallbackQuery();
      return pravit(ctx, t.TOVAR_PROPAL, klav.tovary(tovary()));
    }
    const itog = oformit(l, ctx.from.id, v, 'novy');
    // Ответ на нажатие уходит сразу: Telegram крутит часики на кнопке,
    // пока мы не ответили, и второе нажатие человек делает именно
    // из-за этого ожидания.
    await ctx.answerCallbackQuery(itog.novy ? 'Записал' : 'Такой заказ уже есть');
    if (!itog.novy) return pravit(ctx, t.zakazUzheEst(itog.zakaz), klav.poslePokupki(itog.zakaz.id));
    await pravit(ctx, soobshchenieOZakaze(l, itog), klav.poslePokupki(itog.zakaz.id));
    await soobshchitOZakaze(l, itog.zakaz);
  });

  // Свой аккаунт: сначала логин почты и пароль, потом заказ. Иначе
  // в базе висел бы заказ, по которому нечего делать, а человек
  // на середине ввода передумал.
  bot.callbackQuery(/^svoy:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match![1] as string;
    if (!vybor(id)) return pravit(ctx, t.TOVAR_PROPAL, klav.tovary(tovary()));
    dialogi.postavit(l.db, ctx.from.id, 'zhdem_pochtu', null, { vybor: id }, l.n.klyuchDostupov);
    await pravit(ctx, t.PROSIM_POCHTU);
  });

  // ── баланс ─────────────────────────────────────────────────────────

  const pokazatBalans = async (ctx: Context, pravkoy: boolean) => {
    const tgId = ctx.from!.id;
    const text = t.balansEkran(
      koshelek.balans(l.db, tgId),
      koshelek.dvizheniya(l.db, tgId, 10),
      r().poyas,
    );
    if (pravkoy) await pravit(ctx, text);
    else await ctx.reply(text);
  };

  bot.hears(klav.KNOPKA_BALANS, (ctx) => pokazatBalans(ctx, false));
  bot.callbackQuery('bal', async (ctx) => {
    await ctx.answerCallbackQuery();
    await pokazatBalans(ctx, true);
  });

  // ── мои заказы ─────────────────────────────────────────────────────

  const pokazatZakazy = async (ctx: Context, pravkoy: boolean) => {
    const spisok = zakazy.cheloveka(l.db, ctx.from!.id);
    const pusto = spisok.length === 0;
    const text = pusto ? t.NET_ZAKAZOV : 'Ваши заказы. Откройте любой, чтобы посмотреть подробности.';
    const k = pusto ? klav.tovary(tovary()) : klav.moiZakazy(spisok);
    if (pravkoy) await pravit(ctx, text, k);
    else await ctx.reply(text, { reply_markup: k });
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

  // Поддержка — отдельная кнопка, а не строка внутри помощи.
  // Помощь отвечает на частые вопросы, поддержка — это живой
  // человек, и путь к нему должен быть в один нажим с любого
  // экрана, а не найтись в конце длинного текста.
  bot.hears(klav.KNOPKA_PODDERZHKA, async (ctx) => {
    await ctx.reply(t.PODDERZHKA, { reply_markup: klav.poddershka() });
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

/**
 * Оформление заказа: создать, списать с баланса, вернуть итог.
 *
 * Отдельно от обработчика нажатия по двум причинам. Первая — путей два
 * (новый аккаунт и свой), а действие одно, и разъехаться им нельзя.
 * Вторая — путь со своим аккаунтом приходит не из нажатия, а из конца
 * разговора: там нет ни callbackQuery, ни правки сообщения.
 */
export type Oformlenie = {
  zakaz: zakazy.Zakaz;
  novy: boolean;
  /** Сколько ушло с баланса при оформлении. */
  spisano: number;
  /** Что осталось на балансе. */
  balans: number;
};

export function oformit(l: Lavka, tgId: number, v: Vybor, vid: zakazy.VidAkkaunta): Oformlenie {
  const { zakaz, novy } = zakazy.sozdatIliVernut(l.db, {
    tgId,
    produktId: v.product.id,
    planId: idVybora(v),
    nazvanie: nazvanieVybora(v),
    cenaKop: kopeykiVybora(v),
    // Срока у подписки нет — колонка осталась от прежней структуры,
    // где тарифом был срок. Ноль значит «не объявлен», и наружу
    // он не выходит ни одной строкой.
    mesyacev: 0,
    vidAkkaunta: vid,
  });
  if (!novy) return { zakaz, novy, spisano: 0, balans: koshelek.balans(l.db, tgId) };

  // Баланс тратится СРАЗУ и молча только в одну сторону: заплатить.
  // Хватило целиком — заказ оплачен и администратору подтверждать
  // нечего; хватило частью — остаток ждёт оплаты, как раньше.
  const srok = srokVydachi(new Date(), raspisanie(l.db, l.n));
  const { spisano } = zakazy.oplatitSBalansa(l.db, zakaz.id, srok.do);
  const svezhy = zakazy.po(l.db, zakaz.id) ?? zakaz;

  // Место под настоящую оплату остатка. Поставщик сейчас заглушка
  // и не возвращает ничего; когда появится живой, здесь же появится
  // счёт — и переписывать поток не придётся.
  if (svezhy.status === 'zhdet_oplaty') {
    void l.oplata.vystavit(svezhy).then((schet) => {
      if (schet.vneshnyId || schet.adres) {
        zakazy.zavestiPlatezh(l.db, svezhy.id, l.oplata.imya, schet.vneshnyId, svezhy.cena_kop - svezhy.oplacheno_kop);
      }
    });
  }

  return { zakaz: svezhy, novy, spisano, balans: koshelek.balans(l.db, tgId) };
}

/** Что показать покупателю сразу после оформления. */
export function soobshchenieOZakaze(l: Lavka, o: Oformlenie): string {
  return t.zakazPrinyat({
    zakaz: o.zakaz,
    srok: srokVydachi(new Date(), raspisanie(l.db, l.n)),
    r: raspisanie(l.db, l.n),
    oplataRabotaet: l.oplata.rabotaet,
    spisano: o.spisano,
    balansKop: o.balans,
  });
}

/* ── разговоры покупателя ────────────────────────────────────────── */

/**
 * Логин почты. Сообщение с ним убирается из переписки: это часть
 * доступа к чужому аккаунту, и лежать открытым в чате ему незачем.
 */
export async function prinyatPochtu(l: Lavka, ctx: Context, text: string): Promise<void> {
  const d = dialogi.vzyat(l.db, ctx.from!.id, l.n.klyuchDostupov);
  const vyborId = d?.chernovik['vybor'] ?? '';
  const pochta = text.trim();
  await ubrat(ctx);
  if (!vyborId || !vybor(vyborId)) {
    dialogi.zabyt(l.db, ctx.from!.id);
    await ctx.reply(t.TOVAR_PROPAL, { reply_markup: klav.tovary(tovary()) });
    return;
  }
  if (!pochta) {
    await ctx.reply('Пустое сообщение. Пришлите логин почты одной строкой.');
    return;
  }
  dialogi.postavit(l.db, ctx.from!.id, 'zhdem_parol_akkaunta', null, { vybor: vyborId, pochta }, l.n.klyuchDostupov);
  await ctx.reply(t.PROSIM_PAROL_AKKAUNTA);
}

/** Пароль от аккаунта — и вот здесь появляется заказ. */
export async function prinyatParolAkkaunta(l: Lavka, ctx: Context, text: string): Promise<void> {
  const tgId = ctx.from!.id;
  const d = dialogi.vzyat(l.db, tgId, l.n.klyuchDostupov);
  const vyborId = d?.chernovik['vybor'] ?? '';
  const pochta = d?.chernovik['pochta'] ?? '';
  const parol = text.trim();
  await ubrat(ctx);
  dialogi.zabyt(l.db, tgId);

  const v = vyborId ? vybor(vyborId) : null;
  if (!v || !pochta || !parol) {
    await ctx.reply('Что-то потерялось при вводе. Начните заново — кнопка «Купить доступ».', {
      reply_markup: klav.tovary(tovary()),
    });
    return;
  }

  const itog = oformit(l, tgId, v, 'svoy');
  if (!itog.novy) {
    await ctx.reply(t.zakazUzheEst(itog.zakaz), { reply_markup: klav.poslePokupki(itog.zakaz.id) });
    return;
  }
  // Данные аккаунта ложатся ПОСЛЕ создания заказа: они привязаны
  // к нему внешним ключом, и без заказа им негде лежать.
  svoi.polozhit(l.db, itog.zakaz.id, pochta, parol, l.n.klyuchDostupov);
  zakazy.sobytie(l.db, itog.zakaz.id, 'покупатель передал данные своего аккаунта', tgId);

  await ctx.reply(t.AKKAUNT_PRINYAT);
  await ctx.reply(soobshchenieOZakaze(l, itog), { reply_markup: klav.poslePokupki(itog.zakaz.id) });
  await soobshchitOZakaze(l, itog.zakaz);
}

/**
 * Код двухфакторной аутентификации.
 *
 * Уходит помощнику С НОМЕРОМ ЗАКАЗА в первой строке: помощник ведёт
 * несколько заказов разом, и код без привязки — это код неизвестно
 * от чего.
 */
export async function prinyatKod(l: Lavka, ctx: Context, text: string, zakazId: number | null): Promise<void> {
  const tgId = ctx.from!.id;
  const kod = text.trim();
  await ubrat(ctx);
  dialogi.zabyt(l.db, tgId);

  const z = zakazId ? zakazy.po(l.db, zakazId) : null;
  if (!z || z.tg_id !== tgId || z.status !== 'zhdem_kod') {
    await ctx.reply('По этому заказу код уже не нужен. Если что-то не так — напишите в поддержку.');
    return;
  }
  if (!kod) {
    dialogi.postavit(l.db, tgId, 'zhdem_kod', z.id, {}, l.n.klyuchDostupov);
    await ctx.reply('Пустое сообщение. Пришлите код одной строкой.');
    return;
  }

  kody.zapisat(l.db, z.id, kod, l.n.klyuchDostupov);
  zakazy.prinyatKod(l.db, z.id);
  const svezhy = zakazy.po(l.db, z.id) ?? z;
  await ctx.reply(t.kodPrinyat(svezhy));

  const c = lyudi.chelovek(l.db, tgId);
  await uvedom.komande(
    l,
    [
      `Код по заказу № ${z.id} · ${z.nazvanie}`,
      `Покупатель: ${lyudi.podpis(c, tgId)}`,
      '',
      `Код: ${kod}`,
    ].join('\n'),
    klav.kodAdminu(z.id),
  );
}

/** Убрать сообщение с секретом из переписки, не поднимая шума. */
async function ubrat(ctx: Context): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch {
    // Telegram не даёт удалять сообщения старше двух суток. Это
    // гигиена, а не защита: пароль всё равно уже зашифрован в базе.
  }
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
