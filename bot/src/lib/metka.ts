/**
 * Метка рекламного канала — для бота.
 *
 * Тонкая обёртка над `src/lib/metka.ts` из корня, по тому же образцу,
 * что и каталог: правила сборки и разбора метки должны быть ОДНИ
 * на сайт и на бота. Сайт собирает payload, бот его разбирает,
 * а между ними Telegram со своими ограничениями на `start` —
 * две копии этих правил разъехались бы на первой правке, и метка
 * начала бы теряться молча.
 */

export {
  kodMetki,
  metkaIzAdresa,
  metkaIzPayload,
  sobratPayload,
  razobratPayload,
  PREDEL_KODA,
  KLYUCH_METKI,
  KLYUCH_ZAKAZA,
} from '../../../src/lib/metka.js';
