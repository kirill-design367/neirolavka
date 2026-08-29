/**
 * Проверка страницы в настоящем браузере: все ли запросы отдались,
 * нет ли ошибок в консоли, применилась ли тема до первой отрисовки,
 * какой получился сдвиг вёрстки.
 *
 * Запуск: node scripts/verify-live.mjs http://localhost:4173/neirolavka/
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

let bad = 0;
for (const path of ['', 'fonts/']) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  const page = await ctx.newPage();

  const failed = [];
  const console_ = [];
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  // Отменённые предзагрузки next/link — не сбой: их прерывает
  // закрытие вкладки, а не сервер.
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
    failed.push(`СБОЙ ${r.url()} — ${r.failure()?.errorText}`);
  });
  page.on('console', (m) => { if (m.type() === 'error') console_.push(m.text()); });
  page.on('pageerror', (e) => console_.push(String(e)));

  const url = URL + path;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    display: getComputedStyle(document.querySelector('h1, .fonts__title')).fontFamily,
    fontsLoaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    cls: performance.getEntriesByType('layout-shift').reduce((s, e) => s + (e.hadRecentInput ? 0 : e.value), 0),
  }));

  console.log(`\n── ${url}`);
  console.log(`   тема: ${info.theme}, фон: ${info.bg}`);
  console.log(`   гарнитура заголовка: ${info.display}`);
  console.log(`   загруженные гарнитуры: ${info.fontsLoaded.join(', ') || 'нет'}`);
  console.log(`   CLS: ${info.cls.toFixed(4)}`);
  console.log(`   неудачных запросов: ${failed.length}${failed.length ? '\n     ' + failed.join('\n     ') : ''}`);
  console.log(`   ошибок в консоли: ${console_.length}${console_.length ? '\n     ' + console_.join('\n     ') : ''}`);
  if (failed.length || console_.length || info.cls > 0.001) bad++;
  await ctx.close();
}

await browser.close();
console.log(bad ? `\nПроблемы на ${bad} страницах` : '\nОбе страницы чистые');
process.exit(bad ? 1 : 0);
