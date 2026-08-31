/**
 * Скриншоты всех блоков в обеих темах на трёх разрешениях.
 * Запуск: node scripts/screenshots.mjs <папка> <url>
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2];
const URL = process.argv[3] ?? 'http://localhost:4173/';

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1512x820', width: 1512, height: 820 },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const shotBlock = async (page, sel, file) => {
  const el = page.locator(sel).first();
  if (!(await el.count())) return;
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1100); // дать появлению доиграть
  await page.screenshot({ path: file });
};

for (const vp of VIEWPORTS) {
  for (const theme of ['светлая', 'тёмная']) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: !!vp.mobile, hasTouch: !!vp.mobile, locale: 'ru-RU',
    });
    await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme === 'тёмная' ? 'dark' : 'light');
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const p = (n, what) => `${OUT}/${vp.name}-${theme}-${n}-${what}.png`;

    // 1. Первый экран: навигация, шапка, условия, пустой чек
    await page.screenshot({ path: p(1, 'первый-экран') });

    // Сцена витрины ждёт первого действия человека — будим её,
    // иначе на снимках останется плоская раскладка.
    await page.mouse.move(60, 200);
    await page.mouse.move(64, 204);
    await page.waitForTimeout(300);

    // 2. Витрина: три продукта, у выбранного раскрыты тарифы
    await shotBlock(page, '.shop', p(2, 'витрина'));

    // 3. Собранный заказ
    await page.locator('.pcard--active .tariff').first().click();
    await page.waitForTimeout(400);
    const pay = page.getByRole('button', { name: /СБП/ }).first();
    await pay.click();
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.screenshot({ path: p(3, 'заказ-собран') });

    // 4. Выбран другой продукт: карточка вышла вперёд, тарифы раскрылись
    await page.locator('.pcard').nth(1).locator('.pcard__face').click();
    await page.waitForTimeout(1100);
    await shotBlock(page, '.shop', p(4, 'витрина-chatgpt'));

    // 5. Шаги
    await shotBlock(page, '.steps', p(5, 'как-устроено'));
    // 6. Реферальная программа
    await shotBlock(page, '.referral', p(6, 'рефералка'));
    // 7. Отзывы в подвале
    await shotBlock(page, '.reviews', p(7, 'отзывы'));
    // 8. Низ подвала
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1100);
    await page.screenshot({ path: p(8, 'подвал') });

    // 9. Страница целиком
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await page.screenshot({ path: p(9, 'целиком'), fullPage: true });

    await ctx.close();
  }
}
await browser.close();
console.log('снято');
