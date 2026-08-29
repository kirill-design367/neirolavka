/**
 * Поля и промежутки раскладки: чек должен стоять у правого края
 * с тем же полем, с каким содержимое стоит у левого, а между
 * колонками — заметный воздух.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;
for (const w of [1920, 1512, 1366]) {
  const c = await b.newContext({ viewport: { width: w, height: 900 }, locale: 'ru-RU' });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const main = document.querySelector('.layout__main').getBoundingClientRect();
    const side = document.querySelector('.order__paper').getBoundingClientRect();
    return { left: Math.round(main.left), gap: Math.round(side.left - main.right),
             right: Math.round(innerWidth - side.right), panel: Math.round(side.width) };
  });
  const okGap = r.gap >= 100 || w < 1500;
  const okSym = Math.abs(r.left - r.right) <= 2;
  if (!okGap || !okSym) bad++;
  console.log(`  ${okGap && okSym ? 'ok ' : 'НЕТ'} ${w}: поле слева ${r.left}, промежуток ${r.gap}, поле справа ${r.right}, чек ${r.panel}`);
  await c.close();
}
await b.close();
console.log(bad ? `\nНе сходится в ${bad} случаях` : '\nПоля симметричны, промежуток в норме');
process.exit(bad ? 1 : 0);
