/**
 * Счёт и его оплата: то, что общее для любого поставщика.
 *
 * Поставщик (`robokassa.ts`) знает только про подписи и ссылки.
 * Здесь — про заказ: сколько человек должен, какой счёт ему выставить,
 * что делать, когда деньги пришли, и что делать, когда они пришли
 * не вовремя.
 */

import type { Lavka } from '../lavka.js';
import * as zakazy from '../db/zakazy.js';
import * as koshelek from '../db/koshelek.js';
import { raspisanie } from '../db/nastroyki.js';
import { srokVydachi } from '../lib/vremya.js';
import { zhurnal } from '../lib/zhurnal.js';
import * as uved from '../bot/uvedomleniya.js';
import { rubli } from '../lib/katalog.js';
import { kogdaPridet } from '../lib/texty.js';

/** Что показать человеку у неоплаченного заказа. */
export type Predlozhenie = {
  /** Ссылка на оплату. Пусто — платить негде (оплата не настроена). */
  adres: string | null;
  /** Строка рядом с кнопкой. */
  soobshchenie: string;
  /** Сколько осталось заплатить деньгами, копейками. */
  summaKop: number;
};

/**
 * Сколько осталось заплатить ДЕНЬГАМИ.
 *
 * Цена тарифа минус скидка промокода минус то, что уже закрыто
 * балансом. Одно место на весь проект: пять мест, где считаются
 * деньги заказа, и так уже держатся на `kOplate`, а шестое —
 * «а сколько осталось» — обязано держаться на нём же.
 */
export function ostatokKOplate(z: zakazy.Zakaz): number {
  return Math.max(0, zakazy.kOplate(z) - z.oplacheno_kop);
}

/**
 * Выставить счёт по заказу (или вернуть уже выставленный).
 *
 * СЧЁТ ПЕРЕИСПОЛЬЗУЕТСЯ, пока сумма не изменилась. Иначе каждое
 * нажатие «Оплатить» заводило бы новый номер, а человек, открывший
 * две страницы оплаты и заплативший по обеим, платил бы дважды.
 */
export async function vystavitSchet(l: Lavka, zakaz: zakazy.Zakaz): Promise<Predlozhenie> {
  const summaKop = ostatokKOplate(zakaz);
  if (zakaz.status !== 'zhdet_oplaty' || summaKop <= 0) {
    return { adres: null, soobshchenie: 'Платить по этому заказу нечего.', summaKop: 0 };
  }
  if (!l.oplata.rabotaet) {
    const schet = await l.oplata.vystavit({ zakaz, nomer: 0, summaKop });
    return { adres: null, soobshchenie: schet.soobshchenie, summaKop };
  }

  const staryy = zakazy.otkrytyPlatezh(l.db, zakaz.id, l.oplata.imya, summaKop);
  const nomer = staryy
    ? staryy.id
    : zakazy.zavestiPlatezh(l.db, zakaz.id, l.oplata.imya, null, summaKop);

  const schet = await l.oplata.vystavit({ zakaz, nomer, summaKop });
  return { adres: schet.adres, soobshchenie: schet.soobshchenie, summaKop };
}

/** Чем кончился разбор уведомления. Наружу уходит только `otvet`. */
export type ItogUvedomleniya = {
  /** Что ответить поставщику. */
  otvet: string;
  /** Код ответа HTTP. */
  kod: number;
  /** Для журнала и проверок: что именно произошло. */
  chto:
    | 'podpis_ne_soshlas'
    | 'net_scheta'
    | 'summa_ne_ta'
    | 'uzhe_prinyat'
    | 'oplachen'
    | 'zakaz_zakryt';
};

/**
 * Принять уведомление об оплате.
 *
 * Порядок шагов здесь — это и есть защита, и менять его нельзя.
 *
 *   1. ПОДПИСЬ. Не сошлась — не бывает ничего: ни записи, ни ответа
 *      «принято». Иначе «оплачено» может сказать кто угодно.
 *   2. СЧЁТ. Номер должен найтись у нас. Чужой номер — не наш платёж.
 *   3. СУММА. Пришло не столько, сколько выставляли, — это повод
 *      разбираться руками, а не засчитывать заказ.
 *   4. ОТМЕТКА ПЛАТЕЖА. Здесь же отсекается повтор: второе
 *      уведомление уходит в `uzhe_prinyat` и не делает ничего.
 *   5. И ТОЛЬКО ПОТОМ заказ.
 */
export async function prinyatUvedomlenie(
  l: Lavka,
  pary: Record<string, string>,
): Promise<ItogUvedomleniya> {
  const u = l.oplata.razobratUvedomlenie(pary);
  if (!u) {
    zhurnal.vnimanie('оплата: уведомление с несошедшейся подписью — отклонено');
    return { otvet: 'bad sign', kod: 403, chto: 'podpis_ne_soshlas' };
  }

  const platezh = zakazy.platezhPo(l.db, u.nomer);
  if (!platezh || platezh.postavshchik !== l.oplata.imya) {
    zhurnal.vnimanie(`оплата: счёт № ${u.nomer} не найден`);
    return { otvet: 'no invoice', kod: 404, chto: 'net_scheta' };
  }

  if (platezh.summa_kop !== u.summaKop) {
    /* Пришло не столько, сколько выставляли. Засчитать такое значило бы
       выдать доступ за другие деньги; отказать молча — оставить человека
       без заказа и без объяснения. Поэтому: не засчитываем и зовём людей. */
    zhurnal.oshibka(
      `оплата: по счёту № ${u.nomer} ждали ${platezh.summa_kop} коп., пришло ${u.summaKop}`,
    );
    void uved
      .komande(
        l,
        `Оплата не сошлась по сумме.\nСчёт № ${u.nomer}, заказ № ${platezh.zakaz_id}.\n` +
          `Ждали ${rubli(platezh.summa_kop)}, пришло ${rubli(u.summaKop)}.\n` +
          'Заказ НЕ отмечен оплаченным — разберитесь руками.',
      )
      .catch(() => undefined);
    return { otvet: 'sum mismatch', kod: 400, chto: 'summa_ne_ta' };
  }

  if (!zakazy.otmetitPlatezhOplachennym(l.db, platezh.id)) {
    /* Повтор. Отвечаем «принято»: уведомление своё, подпись сошлась,
       работа сделана в прошлый раз. Не ответить значило бы обречь
       Робокассу на повторы до скончания века. */
    return { otvet: otvetPrinyato(l, u.nomer), kod: 200, chto: 'uzhe_prinyat' };
  }

  const zakaz = zakazy.po(l.db, platezh.zakaz_id);
  if (!zakaz) {
    zhurnal.oshibka(`оплата: платёж № ${u.nomer} ссылается на несуществующий заказ`);
    return { otvet: otvetPrinyato(l, u.nomer), kod: 200, chto: 'zakaz_zakryt' };
  }

  const srok = srokVydachi(new Date(), raspisanie(l.db, l.n));
  if (zakazy.otmetitOplachennym(l.db, zakaz.id, srok.do, null)) {
    zakazy.sobytie(l.db, zakaz.id, 'оплачено через Робокассу', null, `счёт № ${u.nomer}`);
    void soobshchitObOplate(l, zakaz.id).catch(() => undefined);
    return { otvet: otvetPrinyato(l, u.nomer), kod: 200, chto: 'oplachen' };
  }

  /* ДЕНЬГИ ПРИШЛИ ПО ЗАКРЫТОМУ ЗАКАЗУ. Так бывает: человек ушёл
     платить, а за это время истёк час на код и заказ отменился.
     Деньги настоящие, и оставить их нигде нельзя — кладём на баланс
     покупателя и зовём людей. Это то же правило, по которому деньги
     возвращаются на баланс при отмене. */
  koshelek.popolnit(
    l.db,
    zakaz.tg_id,
    u.summaKop,
    `оплата по заказу № ${zakaz.id}, который к тому времени закрылся`,
    null,
  );
  zakazy.sobytie(l.db, zakaz.id, 'оплата пришла по закрытому заказу — деньги на баланс', null, `счёт № ${u.nomer}`);
  zhurnal.vnimanie(`оплата: заказ № ${zakaz.id} уже не ждал оплаты, ${u.summaKop} коп. ушли на баланс`);
  void uved
    .komande(
      l,
      `Оплата пришла по заказу № ${zakaz.id}, который уже закрыт (${zakaz.status}).\n` +
        `${rubli(u.summaKop)} зачислены покупателю на баланс.`,
    )
    .catch(() => undefined);
  void uved
    .cheloveku(
      l,
      zakaz.tg_id,
      `Оплата по заказу № ${zakaz.id} пришла, когда заказ уже был закрыт.\n\n` +
        `${rubli(u.summaKop)} зачислены на ваш баланс — их можно потратить на новый заказ. ` +
        'Если что-то не так, напишите в поддержку.',
    )
    .catch(() => undefined);
  return { otvet: otvetPrinyato(l, u.nomer), kod: 200, chto: 'zakaz_zakryt' };
}

/**
 * Что отвечать поставщику на принятое уведомление.
 *
 * У Робокассы это `OK<номер счёта>`; у заглушки отвечать нечего,
 * но и уведомлений от неё не бывает.
 */
function otvetPrinyato(l: Lavka, nomer: number): string {
  return l.oplata.imya === 'robokassa' ? `OK${nomer}` : 'ok';
}

/** Сказать покупателю и команде, что заказ оплачен. */
async function soobshchitObOplate(l: Lavka, zakazId: number): Promise<void> {
  const z = zakazy.po(l.db, zakazId);
  if (!z) return;
  const r = raspisanie(l.db, l.n);
  const srok = srokVydachi(new Date(), r);
  await uved.cheloveku(
    l,
    z.tg_id,
    `Оплата по заказу № ${z.id} получена. Спасибо.\n\n` +
      `${z.nazvanie}\n\nПомощник возьмёт заказ в работу — доступ придёт ${kogdaPridet(srok, r)}.`,
  );
  await uved.komande(l, `Заказ № ${z.id} оплачен: ${z.nazvanie}. Можно брать в работу.`);
}
