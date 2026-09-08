/**
 * Каталог для бота.
 *
 * Источник ОДИН и тот же, что у сайта: src/lib/catalog.ts из корня
 * репозитория. Бот его импортирует напрямую, а не копирует к себе —
 * скопированный прайс разъезжается с настоящим на первой же правке,
 * и человек видит на сайте одну цену, а в боте другую.
 *
 * Файл каталога намеренно не тянет ничего из Next, поэтому обычный
 * импорт работает и в боте. tsconfig бота включает его в сборку.
 */

export { getCatalog, findPlan, formatPrice } from '../../../src/lib/catalog.js';
export type { Catalog, Product, Plan } from '../../../src/lib/catalog.js';

import { getCatalog, findPlan, priceOf } from '../../../src/lib/catalog.js';
import type { Plan, Product } from '../../../src/lib/catalog.js';

/** Товары в том порядке, в каком они стоят на витрине сайта. */
export function tovary(): Product[] {
  return getCatalog().products;
}

export function tovar(id: string): Product | null {
  return tovary().find((p) => p.id === id) ?? null;
}

/** Уровень подписки с его продуктом. null — если его больше нет. */
export function tarif(planId: string): { product: Product; plan: Plan } | null {
  return findPlan(planId);
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
export function vybor(id: string): Vybor | null {
  const uroven = findPlan(id);
  if (uroven) return uroven;
  const p = tovar(id);
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
