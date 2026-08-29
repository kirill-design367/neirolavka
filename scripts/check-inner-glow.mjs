/**
 * Свет изнутри границ: насколько он вообще заметен и где.
 *
 * Снимаем плашку со свечением и без него и смотрим, как отличается
 * яркость по мере удаления от края внутрь. У свечения не должно быть
 * ступеньки — это свет, а не обводка.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
await c.addInitScript(() => localStorage.setItem('neirolavka-theme', 'dark'));
const p = await c.newPage();
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.evaluate(() => { const el = document.querySelector('.referral');
  window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 60); });
await p.waitForTimeout(900);
await p.evaluate(() => { const s = document.createElement('style');
  s.id = 'probe'; s.textContent = '.referral__content{visibility:hidden!important}'; document.head.appendChild(s); });

const grab = async (on) => {
  await p.evaluate((o) => {
    document.getElementById('probe').textContent =
      '.referral__content{visibility:hidden!important}' + (o ? '' : '.referral__glow{display:none!important}');
  }, on);
  await p.waitForTimeout(250);
  const box = await p.locator('.referral').boundingBox();
  return PNG.sync.read(await p.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 900 - box.y) } }));
};
const on = await grab(true), off = await grab(false);
const W = on.width, H = on.height;

// Прирост яркости по расстоянию от края (кратчайшему до любой стороны).
const bins = new Map();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.min(x, y, W - 1 - x, H - 1 - y);
  const o = (y * W + x) * 4;
  const g = (on.data[o] - off.data[o] + on.data[o + 1] - off.data[o + 1] + on.data[o + 2] - off.data[o + 2]) / 3;
  const k = Math.floor(d / 8) * 8;
  const e = bins.get(k) || [0, 0];
  e[0] += g; e[1]++; bins.set(k, e);
}
const rows = [...bins.entries()].sort((a, z) => a[0] - z[0]).slice(0, 14);
console.log(`  плашка ${W}x${H}, тёмная тема`);
console.log('  прирост яркости от края внутрь (уровни из 255):');
for (const [d, [sum, n]] of rows) console.log(`      ${String(d).padStart(3)}–${String(d + 7).padStart(3)} px: ${(sum / n).toFixed(2)}`);
const first = rows[0][1][0] / rows[0][1][1];
// Ступеньки быть не должно: соседние полосы отличаются плавно.
let jump = 0;
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1][1][0] / rows[i - 1][1][1], z = rows[i][1][0] / rows[i][1][1];
  jump = Math.max(jump, Math.abs(a - z));
}
console.log(`  у самой кромки ${first.toFixed(2)} уровня, наибольший шаг между соседними полосами ${jump.toFixed(2)}`);
await b.close();
