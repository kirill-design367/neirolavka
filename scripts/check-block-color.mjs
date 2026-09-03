/**
 * Цветные блоки: насколько насыщен и как меняется их фон.
 *
 * Снимаем подложку блока в нескольких фазах цикла и считаем по
 * пикселям: насыщенность в HSL, разброс тона и светлоту. Текст в
 * кадр не берём — замеряется только плашка под ним.
 *
 * Запуск: node scripts/check-block-color.mjs <url> [фаз] [мс цикла]
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const PHASES = Number(process.argv[3] ?? 6);
const SPAN = Number(process.argv[4] ?? 67000);

const hsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, s, l];
};

const b = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });

for (const [theme, sel, hide, label] of [
  ['dark', '.referral', '.referral__content', 'реферальный блок'],
  // Карточки условий сняты: проба меряет насыщенность и РАЗБРОС ТОНА
  // цветной плашки по фазам цикла, а плашка стала ровным деревом —
  // размах светлоты и разброс тона у неё нули во всех фазах. Печатать
  // три нуля и называть это проверкой нельзя.
  ['light', '.referral', '.referral__content', 'реферальный блок'],
]) {
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  await c.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.evaluate((a) => { const el = document.querySelector(a);
    if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 140); }, sel);
  await p.waitForTimeout(900);
  // Текст на время замера прячем: меряется только подложка.
  await p.evaluate((h) => {
    const st = document.createElement('style');
    st.textContent = `${h} { visibility: hidden !important; }`;
    document.head.appendChild(st);
  }, hide);
  await p.waitForTimeout(200);
  const box = await p.locator(sel).boundingBox();

  const stats = [];
  for (let i = 0; i < PHASES; i++) {
    if (i) await p.waitForTimeout(SPAN / PHASES);
    // Снимаем область страницы, а не элемент: анимированный элемент
    // Playwright ждёт «до устойчивости» и не дожидается никогда.
    const buf = await p.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 900 - box.y) } });
    const png = PNG.sync.read(buf);
    let sSum = 0, lMin = 1, lMax = 0, n = 0;
    const hues = [];
    for (let y = 0; y < png.height; y += 3) for (let x = 0; x < png.width; x += 3) {
      const o = (y * png.width + x) * 4;
      const [h, s, l] = hsl(png.data[o], png.data[o + 1], png.data[o + 2]);
      sSum += s; if (l < lMin) lMin = l; if (l > lMax) lMax = l; n++;
      if (s > 0.05) hues.push(h);
    }
    hues.sort((q, w) => q - w);
    const span = hues.length ? hues[Math.floor(hues.length * 0.95)] - hues[Math.floor(hues.length * 0.05)] : 0;
    stats.push({ s: sSum / n, lMin, lMax, span, w: png.width, h: png.height });
  }
  const avg = (k) => stats.reduce((a, s) => a + s[k], 0) / stats.length;
  console.log(`  ${label}, ${theme === 'dark' ? 'тёмная' : 'светлая'}: плашка ${stats[0].w}x${stats[0].h}, ${PHASES} фаз`);
  console.log(`      насыщенность в среднем ${avg('s').toFixed(3)} (по фазам ${stats.map((s) => s.s.toFixed(3)).join(', ')})`);
  console.log(`      светлота от ${avg('lMin').toFixed(3)} до ${avg('lMax').toFixed(3)}, размах внутри плашки ${(avg('lMax') - avg('lMin')).toFixed(3)}`);
  console.log(`      разброс тона в кадре ${avg('span').toFixed(0)}°`);
  await c.close();
}
await b.close();
