import type { Metadata, Viewport } from 'next';
import { akt, golos } from '@/lib/fonts';
import { themeInitScript } from '@/lib/theme';
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
  // Цвет строки браузера совпадает с фоном темы, чтобы на телефоне
  // не было светлой полосы над тёмной страницей.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4dbc5' },
    { media: '(prefers-color-scheme: dark)', color: '#0c2223' },
  ],
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
