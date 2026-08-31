import localFont from 'next/font/local';

/**
 * Гарнитуры самохостятся через next/font/local: он сам кладёт файлы
 * в _next/static/media, подставляет basePath, вешает preload и
 * подгоняет метрики запасного шрифта, поэтому подмена не двигает вёрстку.
 *
 * display: 'optional', а не 'swap'. При swap браузер СНАЧАЛА рисует
 * текст запасным шрифтом и только потом меняет его на настоящий —
 * подмена происходит на глазах, и это видно как «страница
 * догружается». При optional он даёт файлу около ста миллисекунд:
 * успел — текст с первого кадра набран настоящей гарнитурой и подмены
 * не бывает вовсе; не успел — остаётся запасной, с подогнанными
 * метриками, то есть без перестановки строк.
 *
 * Ставка на то, что успеет, не на удачу: оба файла нарезаны до нужного
 * репертуара, лежат на своём домене и предзагружаются ссылкой в head.
 *
 * Обе прошли проверку cmap: полная русская азбука, Ё,
 * украинско-белорусский набор, ₽, «», №, тире. Скрипт проверки —
 * scripts/audit-fonts.py.
 */

/** Дисплейная. Дмитрий Гренев, кириллица нарисована как основной алфавит. */
export const akt = localFont({
  src: [{ path: '../fonts/akt.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-akt',
  display: 'optional',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'sans-serif'],
});

/** Текстовая. Александра Королькова и Виталий Кузьмин, ParaType. */
export const golos = localFont({
  src: [{ path: '../fonts/golos-text.woff2', weight: '400 900', style: 'normal' }],
  variable: '--font-golos',
  display: 'optional',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'sans-serif'],
});
