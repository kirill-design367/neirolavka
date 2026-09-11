/**
 * Промокод — для бота.
 *
 * Тонкая обёртка над `src/lib/promokod.ts` из корня, по тому же
 * образцу, что каталог и метка канала: правила кода должны быть ОДНИ
 * на сайт и на бота. Сайт чистит введённое и кладёт код в payload,
 * бот достаёт его оттуда и ищет в базе — две копии правил разъехались
 * бы на первой правке, и человек видел бы скидку в чеке, а в заказе
 * её бы не было.
 */

export {
  kodPromo,
  skidkaKop,
  kOplateKop,
  otkazSlovami,
  PREDEL_KODA,
  KLYUCH_PROMO,
} from '../../../src/lib/promokod.js';
export type { OtkazPromo, ItogPromo } from '../../../src/lib/promokod.js';
