import { chromium } from 'playwright';
const OUT = process.argv[2];
const URL = process.argv[3];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const theme of ['светлая', 'тёмная']) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme === 'тёмная' ? 'dark' : 'light');
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/fonts-${theme}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log('снято');
