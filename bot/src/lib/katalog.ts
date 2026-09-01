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

import { getCatalog, findPlan } from '../../../src/lib/catalog.js';
import type { Plan, Product } from '../../../src/lib/catalog.js';

/** Товары в том порядке, в каком они стоят на витрине сайта. */
export function tovary(): Product[] {
  return getCatalog().products;
}

export function tovar(id: string): Product | null {
  return tovary().find((p) => p.id === id) ?? null;
}

/** Тариф с его товаром. null — если тарифа в каталоге больше нет. */
export function tarif(planId: string): { product: Product; plan: Plan } | null {
  return findPlan(planId);
}

/**
 * Цена в копейках.
 *
 * В базе деньги хранятся целыми копейками, а не рублями с точкой:
 * дробное число рублей рано или поздно даст 1989.9999999 в отчёте,
 * и объяснять это придётся живому человеку.
 */
export function kopeyki(plan: Plan): number {
  return Math.round(plan.priceRub * 100);
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
