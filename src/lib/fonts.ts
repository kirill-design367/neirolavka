import localFont from 'next/font/local';

/**
 * Гарнитуры самохостятся через next/font/local: он сам кладёт файлы
 * в _next/static/media, подставляет basePath, вешает preload и
 * подгоняет метрики запасного шрифта, поэтому подмена не двигает вёрстку.
 *
 * Обе прошли проверку cmap: полная русская азбука, Ё,
 * украинско-белорусский набор, ₽, «», №, тире. Скрипт проверки —
 * scripts/audit-fonts.py.
 */

/** Дисплейная. Дмитрий Гренев, кириллица нарисована как основной алфавит. */
export const akt = localFont({
  src: [{ path: '../fonts/akt.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-akt',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'sans-serif'],
});

/** Текстовая. Александра Королькова и Виталий Кузьмин, ParaType. */
export const golos = localFont({
  src: [{ path: '../fonts/golos-text.woff2', weight: '400 900', style: 'normal' }],
  variable: '--font-golos',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'sans-serif'],
});
