/**
 * Кнопка перехода в бот должна быть видна на экране при любом выборе
 * и на любой высоте окна. Проверяем не «на глаз», а сравнивая
 * прямоугольник кнопки с областью видимости.
 *
 * Запуск: node scripts/check-order-panel.mjs <url>
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const SIZES = [[1920, 1080], [1512, 820], [1366, 768]];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;

for (const [w, h] of SIZES) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ru-RU' });
    await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const states = [];
    const probe = async (label) => {
      const r = await page.evaluate(() => {
        const cta = document.querySelector('.order__cta');
        const paper = document.querySelector('.order__paper');
        if (!cta || !paper) return null;
        const c = cta.getBoundingClientRect();
        const p = paper.getBoundingClientRect();
        return {
          ctaTop: c.top, ctaBottom: c.bottom,
          paperTop: p.top, paperBottom: p.bottom,
          vh: innerHeight,
          scrolls: document.querySelector('.order__scroll').scrollHeight >
                   document.querySelector('.order__scroll').clientHeight,
        };
      });
      if (!r) return;
      const visible = r.ctaTop >= 0 && r.ctaBottom <= r.vh;
      states.push({ label, visible, ...r });
      if (!visible) bad++;
    };

    await probe('ничего не выбрано');
    // Тариф берётся с ВЫБРАННОЙ карточки: у остальных тарифы скрыты,
    // и это не поломка, а устройство витрины.
    await page.locator('.pcard--active .tariff').first().click({ force: true });
    await page.waitForTimeout(800);
    await probe('выбран тариф');
    await page.getByRole('button', { name: 'СБП', exact: true }).click();
    await page.waitForTimeout(700);
    await probe('выбрана оплата');

    console.log(`\n── ${w}×${h}, ${theme === 'dark' ? 'тёмная' : 'светлая'} ──`);
    for (const s of states) {
      console.log(
        `  ${s.visible ? 'видна   ' : 'НЕ ВИДНА'} кнопка ${s.ctaTop.toFixed(0)}–${s.ctaBottom.toFixed(0)} ` +
        `из ${s.vh} · панель ${s.paperTop.toFixed(0)}–${s.paperBottom.toFixed(0)} ` +
        `· прокрутка внутри: ${s.scrolls ? 'да' : 'нет'} · ${s.label}`,
      );
    }
    await ctx.close();
  }
}
await browser.close();
console.log(bad ? `\nКнопка вне экрана в ${bad} случаях` : '\nКнопка видна во всех состояниях и на всех высотах');
process.exit(bad ? 1 : 0);
