/**
 * Каталог для бота.
 *
 * ПРАЙС ЖИВЁТ В БАЗЕ, а `src/lib/catalog.ts` из корня репозитория —
 * его засев. Так стало вместе с админ-панелью: цены и уровни правит
 * живой человек из браузера, и ждать выкладки ради цифры нельзя.
 *
 * Раньше здесь было «источник один и тот же, что у сайта», и это
 * по-прежнему верно в момент засева. Дальше стороны расходятся: бот
 * читает базу, витрина — файл, потому что сайт статический и базы
 * не видит. Свести их можно выгрузкой из панели: она отдаёт готовый
 * кусок `catalog.ts`, его кладут в файл и выкладывают сайт.
 *
 * Форма данных при этом ОДНА (`Product`, `Plan`) — типы по-прежнему
 * берутся из файла каталога, и разъехаться им негде.
 */

export { getCatalog, findPlan, formatPrice, poCene } from '../../../src/lib/catalog.js';
export type { Catalog, Product, Plan } from '../../../src/lib/catalog.js';

import { priceOf } from '../../../src/lib/catalog.js';
import type { Plan, Product } from '../../../src/lib/catalog.js';
import type { Baza } from '../db/index.js';
import * as bdKatalog from '../db/katalog.js';

/** Товары в том порядке, в каком они стоят на витрине. */
export function tovary(db: Baza): Product[] {
  return bdKatalog.produkty(db);
}

export function tovar(db: Baza, id: string): Product | null {
  return bdKatalog.produkt(db, id);
}

/** Уровень подписки с его продуктом. null — если его больше нет. */
export function tarif(db: Baza, planId: string): { product: Product; plan: Plan } | null {
  return bdKatalog.uroven(db, planId);
}

/**
 * ВЫБРАННОЕ — это продукт И необязательный уровень подписки.
 *
 * У Claude Pro и Seedance уровней нет вовсе: подписка одна, и это
 * свойство продукта, а не пустое место в прайсе. На сайте такой
 * продукт кладётся в чек нажатием по самой карточке; в боте — тем же
 * способом: карточка сразу и есть выбор.
 *
 * Поэтому идентификатор в кнопках покупки — это ЛИБО уровень, ЛИБО
 * продукт без уровней. Столкнуться они не могут: у уровня
 * идентификатор вида `<продукт>-<уровень>`.
 */
export type Vybor = { product: Product; plan: Plan | null };

/** Найти выбранное по идентификатору кнопки. null — его больше нет. */
export function vybor(db: Baza, id: string): Vybor | null {
  const uroven = tarif(db, id);
  if (uroven) return uroven;
  const p = tovar(db, id);
  // У продукта С уровнями по его собственному идентификатору
  // выбирать нечего: уровень не назван.
  return p && p.plans.length === 0 ? { product: p, plan: null } : null;
}

/** Название для чека, карточки заказа и очереди администратора. */
export function nazvanieVybora(v: Vybor): string {
  return v.plan ? v.plan.title : v.product.name;
}

/** Идентификатор, под которым выбранное живёт в базе. */
export function idVybora(v: Vybor): string {
  return v.plan ? v.plan.id : v.product.id;
}

/** Цена выбранного в копейках. Ноль — «цены ещё нет», см. ниже. */
export function kopeykiVybora(v: Vybor): number {
  const rub = priceOf(v.product, v.plan);
  return rub === null ? 0 : Math.round(rub * 100);
}

/**
 * Цена в копейках.
 *
 * В базе деньги хранятся целыми копейками, а не рублями с точкой:
 * дробное число рублей рано или поздно даст 1989.9999999 в отчёте,
 * и объяснять это придётся живому человеку.
 *
 * НОЛЬ ЗДЕСЬ ЗНАЧИТ «ЦЕНЫ ЕЩЁ НЕТ». В каталоге это `null`, но
 * колонка `cena_kop` объявлена NOT NULL, и переписывать схему ради
 * пустого прайса незачем. Наружу ноль как цена не выходит нигде:
 * его показывает `rubliIli`, а он печатает слово, а не «0 ₽».
 */
export function kopeyki(plan: Plan): number {
  return plan.priceRub === null ? 0 : Math.round(plan.priceRub * 100);
}

/**
 * Цена для показа человеку. Ноль — это «цены ещё нет», и печатать
 * его как «0 ₽» нельзя: ноль читается как «бесплатно».
 */
export function rubliIli(kop: number): string {
  return kop > 0 ? rubli(kop) : 'уточняется';
}

/** «1 990 ₽» из копеек. */
export function rubli(kop: number): string {
  const r = kop / 100;
  const celoe = Number.isInteger(r);
  return `${r.toLocaleString('ru-RU', {
    minimumFractionDigits: celoe ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;
}
