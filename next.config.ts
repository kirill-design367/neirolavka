import type { NextConfig } from 'next';

/**
 * basePath вынесен в переменную окружения: на GitHub Pages это «/neirolavka»,
 * на своём домене — пустая строка. Задаётся через NEXT_PUBLIC_BASE_PATH.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
};

export default nextConfig;
