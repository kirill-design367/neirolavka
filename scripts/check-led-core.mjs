/**
 * Перелив внутри капли света: правда ли внутри неё что-то движется
 * и сколько там цветов.
 *
 * Анимации перелива и колыхания прокручиваются по времени вручную,
 * поэтому фазы берутся детерминированно, а не «как повезёт». Каплю
 * снимаем при большом увеличении и считаем по её пикселям — цвета,
 * разброс тона, а также насколько картинка меняется от фазы к фазе.
 *
 * Свечение вокруг капли в счёт не идёт: берём только круг по её
 * собственному размеру.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const PHASES = Number(process.argv[3] ?? 16);
const SCALE = 8;

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

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;

for (const theme of ['light', 'dark']) {
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU', deviceScaleFactor: SCALE });
  await c.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await p.locator('.steps').scrollIntoViewIfNeeded();
  await p.waitForTimeout(900);

  // Капля стоит на месте: цикл дорожки останавливаем в середине пути.
  const periods = await p.evaluate(() => {
    const cyc = document.querySelector('.steps__track-fill').getAnimations()[0].effect.getTiming().duration;
    [...document.querySelectorAll('.steps__track-fill,.steps__led,.step__node,.step__halo')]
      .flatMap((e) => e.getAnimations())
      .forEach((a) => { if (a.effect.getTiming().duration === cyc) { a.pause(); a.currentTime = cyc * 0.3; } });
    // Анимации перелива и колыхания — у долей и их псевдоэлементов.
    const inner = document.getAnimations().filter((a) => {
      const n = a.animationName || '';
      return n.startsWith('spark-') || n.startsWith('led-wobble') || n === 'led-breathe';
    });
    inner.forEach((a) => a.pause());
    window.__inner = inner;
    return inner.map((a) => ({ n: a.animationName, d: a.effect.getTiming().duration }));
  });

  if (!periods.length) {
    console.log('  НЕТ АНИМАЦИЙ ПЕРЕЛИВА — проба устарела, поправьте имена в скрипте');
    bad++; await c.close(); continue;
  }

  const box = await p.locator('.steps__led').boundingBox();
  const shots = [];
  for (let i = 0; i < PHASES; i++) {
    await p.evaluate((f) => {
      window.__inner.forEach((a) => { a.currentTime = (a.effect.getTiming().duration * f) % a.effect.getTiming().duration; });
    }, i / PHASES);
    await p.waitForTimeout(90);
    shots.push(PNG.sync.read(await p.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    })));
  }
  await c.close();

  const W = shots[0].width, H = shots[0].height;
  const cx = (W - 1) / 2, cy = (H - 1) / 2, rad = Math.min(W, H) / 2 - 1;
  const inside = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if (Math.hypot(x - cx, y - cy) <= rad * 0.86) inside.push((y * W + x) << 2);

  const bins = new Set();
  const hues = [];
  let sMin = 1, sMax = 0, lMin = 1, lMax = 0;
  for (const png of shots) for (const o of inside) {
    const [r, g, bl] = [png.data[o], png.data[o + 1], png.data[o + 2]];
    bins.add((r >> 3) * 1024 + (g >> 3) * 32 + (bl >> 3));
    const [h, s, l] = hsl(r, g, bl);
    if (s > 0.08) hues.push(h);
    if (s < sMin) sMin = s; if (s > sMax) sMax = s;
    if (l < lMin) lMin = l; if (l > lMax) lMax = l;
  }
  hues.sort((a, z) => a - z);
  const span = hues.length ? hues[Math.floor(hues.length * 0.97)] - hues[Math.floor(hues.length * 0.03)] : 0;

  // Насколько меняется картинка внутри капли от фазы к фазе.
  let moveSum = 0, moveMax = 0;
  for (let i = 1; i < shots.length; i++) {
    let d = 0;
    for (const o of inside) d += Math.abs(shots[i].data[o] - shots[i - 1].data[o]) +
      Math.abs(shots[i].data[o + 1] - shots[i - 1].data[o + 1]) +
      Math.abs(shots[i].data[o + 2] - shots[i - 1].data[o + 2]);
    d /= inside.length * 3;
    moveSum += d; if (d > moveMax) moveMax = d;
  }

  // Силуэт: сколько пикселей кадра занимает сама капля (контур дышит).
  const areas = shots.map((png) => {
    const bg = [png.data[0], png.data[1], png.data[2]];
    let n = 0;
    for (let i = 0; i < W * H; i++) {
      const o = i << 2;
      if (Math.abs(png.data[o] - bg[0]) + Math.abs(png.data[o + 1] - bg[1]) + Math.abs(png.data[o + 2] - bg[2]) > 120) n++;
    }
    return n;
  });
  const aMin = Math.min(...areas), aMax = Math.max(...areas);

  // Порог по числу цветов невысок намеренно: капля 12 css-px, и
  // при пятибитном квантовании даже насыщенный градиент даёт
  // меньше сотни различимых оттенков. Главное — что их много
  // больше одного и что картинка от фазы к фазе меняется.
  const ok = bins.size >= 60 && span >= 25 && moveSum / (shots.length - 1) >= 3;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok ' : 'НЕТ'} ${theme === 'dark' ? 'тёмная' : 'светлая'}: капля ${(W / SCALE).toFixed(0)}x${(H / SCALE).toFixed(0)} css-px, ${PHASES} фаз, ${inside.length} пикселей сердцевины`);
  console.log(`      периоды внутри: ${periods.map((q) => `${q.n} ${(q.d / 1000).toFixed(1)} с`).join(', ')}`);
  console.log(`      различных цветов в сердцевине ${bins.size}, разброс тона ${span.toFixed(0)}°`);
  console.log(`      насыщенность ${sMin.toFixed(2)}–${sMax.toFixed(2)}, светлота ${lMin.toFixed(2)}–${lMax.toFixed(2)}`);
  console.log(`      сдвиг картинки между соседними фазами: ${(moveSum / (shots.length - 1)).toFixed(2)} уровня в среднем, ${moveMax.toFixed(2)} наибольший`);
  console.log(`      площадь силуэта ${(aMin / SCALE / SCALE).toFixed(0)}–${(aMax / SCALE / SCALE).toFixed(0)} css-px², колебание ${((aMax - aMin) / aMin * 100).toFixed(1)} %`);
}

await b.close();
console.log(bad ? '\nПЕРЕЛИВА НЕТ ИЛИ ОН СЛИШКОМ СЛАБ' : '\nВнутри капли живой перелив в обеих темах');
process.exit(bad ? 1 : 0);
