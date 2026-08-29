import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
const p = await c.newPage();
await p.goto(process.argv[2], { waitUntil: 'networkidle' });
await p.waitForTimeout(700);
console.log('  пометка «скоро» на странице:', await p.locator('.shelf__soon').count());
console.log('  отключённых полок:', await p.locator('.shelf__trigger[disabled]').count());
await p.getByRole('button', { name: /ChatGPT/ }).first().click();
await p.waitForTimeout(900);
const r = await p.evaluate(() => {
  const sh = [...document.querySelectorAll('.shelf')].find((e) => e.textContent.includes('ChatGPT'));
  return { open: sh.className.includes('shelf--open'),
           tariffs: [...sh.querySelectorAll('.tariff__short')].map((e) => e.textContent),
           badges: [...sh.querySelectorAll('.tariff__badge')].map((e) => e.textContent) };
});
console.log('  полка ChatGPT раскрыта:', r.open);
console.log('  тарифы:', r.tariffs.join(' · '));
console.log('  отметки:', r.badges.join(' · '));
await p.getByRole('button', { name: /12 месяцев/ }).first().click();
await p.waitForTimeout(500);
await p.getByRole('button', { name: 'СБП', exact: true }).click();
await p.waitForTimeout(600);
console.log('  в чеке:', await p.locator('.order__item-name').textContent());
await b.close();
