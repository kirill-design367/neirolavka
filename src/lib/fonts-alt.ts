import localFont from 'next/font/local';

/**
 * Третий вариант набора. Живёт отдельным модулем намеренно:
 * next/font выпускает объявление на каждый вызов localFont в модуле,
 * поэтому, лежи Onest рядом с Akt и Golos, он предзагружался бы
 * и на главной, где не нужен, — лишние 45 КБ на каждый визит.
 *
 * Дмитрий Волошин и Андрей Кудрявцев, кириллица как основной алфавит.
 */
export const onest = localFont({
  src: [{ path: '../fonts/onest.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-onest',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'sans-serif'],
  // Предзагрузку выключаем: next/font иначе поднимает подсказку
  // на все маршруты, включая главную, где Onest не используется.
  preload: false,
});
