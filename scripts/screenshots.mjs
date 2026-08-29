import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2];
const URL = process.argv[3] || 'http://localhost:4173/';
const VIEWPORTS = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1512', width: 1512, height: 820 },
  { name: '390',  width: 390,  height: 844, mobile: true },
];
const THEMES = ['light', 'dark'];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: !!vp.mobile,
      hasTouch: !!vp.mobile,
      locale: 'ru-RU',
    });
    await ctx.addInitScript(t => localStorage.setItem('neirolavka-theme', t), theme);
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    // Раскрываем Claude, выбираем тариф и оплату — снимаем заполненное состояние
    await page.screenshot({ path: `${OUT}/${vp.name}-${theme}-1-первый-экран.png` });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/${vp.name}-${theme}-9-подвал.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(700);

    // Claude раскрыт с первого кадра — снимаем как есть,
    // затем проверяем саму механику на ChatGPT и обратно.
    await page.screenshot({ path: `${OUT}/${vp.name}-${theme}-2-тарифы.png` });

    await page.getByRole('button', { name: /6 месяцев/ }).first().click();
    await page.waitForTimeout(500);
    const payBtn = vp.mobile ? page.getByRole('button', { name: 'СБП', exact: true })
                             : page.getByRole('button', { name: /СБП/ }).first();
    await payBtn.click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${vp.name}-${theme}-3-заказ-собран.png` });

    await page.screenshot({ path: `${OUT}/${vp.name}-${theme}-4-целиком.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log('снято');
