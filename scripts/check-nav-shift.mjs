/**
 * Переключение темы не должно двигать шапку. Снимаем положение
 * каждого элемента шапки до и после переключения и сравниваем
 * с точностью до сотой пикселя.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
let bad = 0;
for (const w of [1512, 1366, 390]) {
  const c = await b.newContext({ viewport: { width: w, height: 900 }, locale: 'ru-RU', reducedMotion: 'reduce' });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const snap = () => p.evaluate(() =>
    [...document.querySelectorAll('.nav *')].map((el) => {
      const r = el.getBoundingClientRect();
      // у SVG className — объект, берём baseVal
      const cls = typeof el.className === 'string' ? el.className : (el.className?.baseVal ?? '');
      return { k: cls.split(/\s+/).filter(Boolean)[0] || el.tagName.toLowerCase(),
               // движок и иконки переключателя обязаны двигаться — это и есть
               // переключение; из проверки на паразитный сдвиг их исключаем
               skip: /theme-toggle__(thumb|icon)/.test(cls) || el.closest('.theme-toggle__thumb') !== null,
               x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2) };
    }));
  const before = await snap();
  await p.click('.theme-toggle');
  await p.waitForTimeout(700);
  const after = await snap();
  const moved = before.map((b0, i) => ({ ...b0, dx: Math.abs(b0.x - after[i].x),
                                          dy: Math.abs(b0.y - after[i].y),
                                          dw: Math.abs(b0.w - after[i].w) }))
                      .filter((x) => !x.skip && (x.dx > 0.01 || x.dy > 0.01 || x.dw > 0.01));
  if (moved.length) bad++;
  console.log(`  ${moved.length ? 'СДВИГ' : 'ok   '} ширина ${w}: сдвинулось элементов ${moved.length} из ${before.length}`);
  for (const m of moved.slice(0, 5))
    console.log(`      .${m.k} dx=${m.dx.toFixed(2)} dy=${m.dy.toFixed(2)} dw=${m.dw.toFixed(2)}`);
  await c.close();
}
await b.close();
console.log(bad ? '\nШапка едет' : '\nШапка не сдвигается ни на пиксель');
process.exit(bad ? 1 : 0);
