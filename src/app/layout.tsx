import type { Metadata, Viewport } from 'next';
import { akt, golos } from '@/lib/fonts';
import { THEME_BAR, themeInitScript } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Нейролавка — доступ к Claude и ChatGPT',
  description:
    'Лавка, где доступ к нейросетям покупают за две минуты: выбрали тариф, оплатили привычным способом, получили доступ в боте.',
  applicationName: 'Нейролавка',
  openGraph: {
    title: 'Нейролавка — доступ к Claude и ChatGPT',
    description: 'Выбрали тариф, оплатили картой, СБП или USDT, получили доступ в боте.',
    locale: 'ru_RU',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Цвет строки браузера — ОДИН, под тему по умолчанию. Дальше его
  // ведёт сама страница: блокирующий скрипт ставит цвет сохранённой
  // темы до первой отрисовки, переключатель меняет вместе с темой.
  //
  // Media-запроса здесь быть не должно. Пока он стоял, на телефоне
  // с тёмной системой строка браузера уходила в тёмный над светлой
  // страницей, и сайт читался открывшимся тёмным. Системная тема
  // на этом сайте не учитывается вовсе.
  themeColor: THEME_BAR.light,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      data-theme="light"
      className={`${akt.variable} ${golos.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Тема проставляется до первой отрисовки — вспышки не бывает. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
