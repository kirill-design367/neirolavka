/**
 * Стык между секциями: резкий перепад фона по вертикали.
 * Идём сверху вниз по узкой полосе слева от содержимого и смотрим,
 * насколько сильно меняется цвет фона от строки к строке.
 * Плавный переход даёт мелкие шаги, стык — один большой скачок.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import { PNG } from 'pngjs';
const URL = process.argv[2];
const b = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
let bad = 0;
for (const theme of ['light', 'dark']) {
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU', reducedMotion: 'reduce' });
  await c.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const buf = await p.screenshot({ fullPage: true, clip: undefined });
  const png = PNG.sync.read(buf);
  // узкая полоса у левого края — там нет карточек, только фон секций
  const X = 20;
  const col = [];
  for (let y = 0; y < png.height; y++) {
    const i = (png.width * y + X) << 2;
    col.push([png.data[i], png.data[i + 1], png.data[i + 2]]);
  }
  let worst = 0, worstY = 0;
  for (let y = 1; y < col.length; y++) {
    const d = Math.hypot(col[y][0]-col[y-1][0], col[y][1]-col[y-1][1], col[y][2]-col[y-1][2]);
    if (d > worst) { worst = d; worstY = y; }
  }
  const ok = worst < 6;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok ' : 'СТЫК'} ${theme === 'dark' ? 'тёмная' : 'светлая'}: самый резкий перепад фона ${worst.toFixed(1)} из 255 на высоте ${worstY} px`);
  await c.close();
}
await b.close();
console.log(bad ? '\nЕсть резкие стыки' : '\nРезких стыков нет, фон течёт непрерывно');
process.exit(bad ? 1 : 0);
