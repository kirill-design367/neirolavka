import type { NextConfig } from 'next';

/**
 * Сайт живёт в КОРНЕ своего домена (neirolavka.ru), поэтому basePath
 * и assetPrefix здесь больше нет.
 *
 * Они стояли ради GitHub Pages, где страница лежала в подпапке с именем
 * репозитория. После переезда на свой сервер подпапки нет, а пустой
 * basePath — это ровно то же самое, что его отсутствие, только с лишней
 * переменной окружения, о которую можно споткнуться: собрали с
 * NEXT_PUBLIC_BASE_PATH из старого окружения — и все пути уехали
 * в несуществующий /neirolavka.
 *
 * trailingSlash остаётся: выдача — папки с index.html, и nginx настроен
 * ровно под неё (см. deploy/nginx/neirolavka.conf).
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
};

export default nextConfig;
