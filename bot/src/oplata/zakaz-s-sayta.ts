/**
 * Заказ, оформленный НА САЙТЕ.
 *
 * До сих пор заказ рождался только в боте, и это было удобно тем,
 * что покупатель известен всегда. Оплата на сайте разрывает связку:
 * человек выбирает подписку и платит, не открывая Telegram, — значит
 * заказ создаётся РАНЬШЕ, чем мы узнаём, кто платил.
 *
 * Отсюда всё устройство этого файла:
 *
 *   1. заказ заводится БЕЗ ХОЗЯИНА (`tg_id` пуст) и с секретным
 *      ключом;
 *   2. по ключу собирается ссылка `t.me/…?start=zakaz_<ключ>` —
 *      единственный способ человека связать оплату с собой;
 *   3. счёт выставляется тут же, и наружу уходит адрес Робокассы.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ ДОЛЖНО ПОЯВИТЬСЯ — баланса покупателя. На сайте
 * нет входа, и чей это баланс, узнать неоткуда: списывать «с кого
 * -нибудь» значило бы платить чужими деньгами. Баланс остаётся
 * способом заплатить в боте, где человек известен.
 *
 * ВИД АККАУНТА ЗДЕСЬ ТОЖЕ НЕ СПРАШИВАЕТСЯ. На сайте — выбор и деньги;
 * всё, что нужно для выдачи (новый аккаунт или свой, логин, пароль,
 * код), спрашивает бот. Заказ до прихода человека живёт в состоянии
 * `ne_vybran`, и помощник его в работу не возьмёт: у заказа, где вид
 * аккаунта не назван, впереди может быть ввод чужого пароля.
 */

import { randomBytes } from 'node:crypto';

import type { Lavka } from '../lavka.js';
import * as zakazy from '../db/zakazy.js';
import { vybor, idVybora, nazvanieVybora, kopeykiVybora, getCatalog, rubli } from '../lib/katalog.js';
import { kodMetki, KLYUCH_ZAKAZA } from '../lib/metka.js';
import { kodPromo } from '../lib/promokod.js';
import { vystavitSchet } from './schet.js';
import { zhurnal } from '../lib/zhurnal.js';
import * as uved from '../bot/uvedomleniya.js';

/** Что прислал сайт. Всё — строками: разбираем и чистим здесь. */
export type ZaprosSSayta = {
  /** Идентификатор уровня подписки либо продукта без уровней. */
  tovar: string;
  /** Чем человек собрался платить. Записывается как пожелание. */
  oplata: string;
  /** Промокод, введённый в чеке. Пусто — без кода. */
  promo: string;
  /** Метка рекламного канала из адреса страницы. */
  metka: string;
  /**
   * Ключ ОДНОГО нажатия. Придуман сайтом и постоянен, пока человек
   * не поменял выбор: повторный запрос возвращает тот же заказ.
   * Без него двойное нажатие заводило бы второй заказ и жгло вторую
   * активацию промокода.
   */
  popytka: string;
};

export type OtkazSayta = 'net_tovara' | 'net_ceny' | 'net_oplaty' | 'ne_vyshlo';

export type OtvetSayta =
  | {
      vyshlo: true;
      /** Номер заказа — его человек увидит в боте и назовёт в поддержке. */
      nomer: number;
      /** Куда вести браузер: страница оплаты Робокассы. */
      adres: string;
      /** Ссылка «забрать заказ в боте». Секрет — часть ссылки. */
      vBot: string;
      cenaKop: number;
      skidkaKop: number;
      kOplateKop: number;
      /** Что вышло с промокодом: применён, не подошёл или его не было. */
      promo: zakazy.ItogPromoZakaza;
    }
  | { vyshlo: false; pochemu: OtkazSayta; soobshchenie: string };

/**
 * Секрет заказа.
 *
 * Шестнадцать байт — это 128 бит: подобрать перебором нельзя, а сам
 * ключ при этом короткий, и ссылка с ним умещается в 64 знака,
 * которые Telegram отводит параметру `start`.
 */
function novyKlyuch(): string {
  return randomBytes(16).toString('hex');
}

/** Ссылка, по которой человек забирает свой оплаченный заказ. */
export function ssylkaVBot(klyuch: string): string {
  const bot = getCatalog().botUrl;
  if (!bot || !klyuch) return '';
  return `${bot}?start=${KLYUCH_ZAKAZA}_${klyuch}`;
}

const OTKAZY: Record<OtkazSayta, string> = {
  net_tovara: 'Такой подписки нет в лавке. Обновите страницу и выберите заново.',
  net_ceny:
    'На эту подписку цена ещё не объявлена — оплатить её нельзя. ' +
    'Напишите в поддержку, вам ответит живой человек.',
  net_oplaty: 'Оплата сейчас не работает. Напишите в поддержку — заказ оформят руками.',
  ne_vyshlo: 'Не получилось завести заказ. Попробуйте ещё раз через минуту.',
};

const otkaz = (pochemu: OtkazSayta): OtvetSayta => ({
  vyshlo: false,
  pochemu,
  soobshchenie: OTKAZY[pochemu],
});

/**
 * Оформить заказ с сайта и выставить счёт.
 *
 * ПОРЯДОК ЗДЕСЬ — ЭТО И ЕСТЬ ЗАЩИТА, ровно как в приёме уведомления.
 * Сначала заказ ложится в базу и только потом что-либо уходит по сети:
 * заказ, о котором мы сказали «идите платить», обязан существовать.
 * Обратный порядок дал бы платёж без заказа — деньги, которым некуда
 * лечь.
 */
export async function zakazSSayta(l: Lavka, z: ZaprosSSayta): Promise<OtvetSayta> {
  const v = vybor(l.db, z.tovar);
  if (!v) return otkaz('net_tovara');

  const cenaKop = kopeykiVybora(v);
  // Ноль значит «цена не объявлена», а не «бесплатно». Пускать
  // человека на страницу оплаты с нулём нельзя: Робокасса такой счёт
  // не примет, а человек решит, что сломались мы.
  if (cenaKop <= 0) return otkaz('net_ceny');
  if (!l.oplata.rabotaet) return otkaz('net_oplaty');

  let sozdanie: zakazy.Sozdanie;
  try {
    sozdanie = zakazy.sozdatIliVernut(l.db, {
      tgId: null,
      istochnik: 'sayt',
      klyuch: novyKlyuch(),
      popytka: z.popytka,
      metka: kodMetki(z.metka) || undefined,
      produktId: v.product.id,
      planId: idVybora(v),
      nazvanie: nazvanieVybora(v),
      cenaKop,
      // Срока у подписки нет — колонка осталась от прежней структуры.
      mesyacev: 0,
      // Про аккаунт спросит бот. См. верх файла.
      vidAkkaunta: 'ne_vybran',
      promoKod: kodPromo(z.promo) || undefined,
    });
  } catch (e) {
    zhurnal.oshibka('заказ с сайта не завёлся:', e);
    return otkaz('ne_vyshlo');
  }

  const zakaz = sozdanie.zakaz;
  if (sozdanie.novy) {
    /* ЧЕМ ЧЕЛОВЕК СОБРАЛСЯ ПЛАТИТЬ — ЭТО ПОЖЕЛАНИЕ, А НЕ НАСТРОЙКА.
       Способ он выбирает на странице Робокассы; передать выбор туда
       параметром можно, но для этого надо знать, как в кабинете
       названы способы у ЭТОГО магазина, — а угадывать названия
       в платёжном запросе нельзя ровно по той же причине, по которой
       не угадывается система налогообложения в чеке. Пожелание
       остаётся в истории заказа: помощнику видно, чего человек ждал. */
    const sposob = (z.oplata || '').trim().slice(0, 16);
    if (sposob) zakazy.sobytie(l.db, zakaz.id, 'выбран способ оплаты на сайте', null, sposob);
    zhurnal.info(`сайт: заказ № ${zakaz.id} — ${zakaz.nazvanie}, ${rubli(zakazy.kOplate(zakaz))}`);
    void uved
      .komande(
        l,
        `Заказ № ${zakaz.id} оформлен НА САЙТЕ: ${zakaz.nazvanie}.\n` +
          `К оплате ${rubli(zakazy.kOplate(zakaz))}. Покупателя пока нет — он появится, ` +
          'когда откроет ссылку в бот.',
      )
      .catch(() => undefined);
  }

  const schet = await vystavitSchet(l, zakaz);
  if (!schet.adres) {
    // Заказ УЖЕ ЗАВЕДЁН и никуда не денется: он виден в панели,
    // и команда его разберёт. Врать человеку, что всё хорошо, нельзя.
    zhurnal.oshibka(`сайт: заказ № ${zakaz.id} завёлся, а счёт не выставился`);
    return otkaz('net_oplaty');
  }

  return {
    vyshlo: true,
    nomer: zakaz.id,
    adres: schet.adres,
    vBot: ssylkaVBot(zakaz.klyuch ?? ''),
    cenaKop: zakaz.cena_kop,
    skidkaKop: zakaz.skidka_kop,
    kOplateKop: zakazy.kOplate(zakaz),
    promo: sozdanie.promo,
  };
}
