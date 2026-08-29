/**
 * Перелив внутри капли света: правда ли внутри неё что-то движется
 * и сколько там цветов.
 *
 * Замер разделён на два, иначе он ничего не доказывает. Если гнать
 * все анимации разом, то «картинка внутри меняется» получится и от
 * колыхания самого контура — то есть проверка перелива засчитает
 * ровно то, что переливом не является.
 *
 *   перелив — колыхание и дыхание заморожены, крутится только
 *             градиент внутри долей;
 *   контур  — наоборот: градиент заморожен, крутятся доли.
 *
 * Мера движения — размах КАЖДОГО пикселя за цикл (max − min по
 * фазам), усреднённый по сердцевине. Средняя разница между соседними
 * фазами не годится: она падает при увеличении числа фаз, и вердикт
 * начинает зависеть от аргумента командной строки.
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
    const pick = (test) => document.getAnimations().filter((a) => test(a.animationName || ''));
    const spark = pick((n) => n.startsWith('spark-'));
    const shape = pick((n) => n.startsWith('led-wobble') || n === 'led-breathe');
    [...spark, ...shape].forEach((a) => { a.pause(); a.currentTime = 0; });
    window.__spark = spark;
    window.__shape = shape;
    return { spark: spark.map((a) => ({ n: a.animationName, d: a.effect.getTiming().duration })),
             shape: shape.map((a) => ({ n: a.animationName, d: a.effect.getTiming().duration })) };
  });

  if (!periods.spark.length || !periods.shape.length) {
    console.log(`  НЕТ АНИМАЦИЙ (перелив ${periods.spark.length}, контур ${periods.shape.length}) — проба устарела, поправьте имена в скрипте`);
    bad++; await c.close(); continue;
  }

  const box = await p.locator('.steps__led').boundingBox();
  const sweep = async (which) => {
    const out = [];
    for (let i = 0; i < PHASES; i++) {
      await p.evaluate(([w, f]) => {
        window[w].forEach((a) => { a.currentTime = a.effect.getTiming().duration * f; });
      }, [which, i / PHASES]);
      await p.waitForTimeout(90);
      out.push(PNG.sync.read(await p.screenshot({
        clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      })));
    }
    // Возвращаем эту группу в исходную фазу, чтобы следующий проход
    // мерил только своё движение.
    await p.evaluate((w) => { window[w].forEach((a) => { a.currentTime = 0; }); }, which);
    return out;
  };
  const shots = await sweep('__spark');
  const shapes = await sweep('__shape');
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
  // Разброс тона считается ПО КРУГУ: тон замкнут, и у сливового с
  // янтарным разность концов через ноль давала 343° вместо 70°.
  // Берём наибольший пустой сектор и вычитаем его из полного круга.
  hues.sort((a, z) => a - z);
  let span = 0;
  if (hues.length > 1) {
    let gap = 0;
    for (let i = 1; i < hues.length; i++) gap = Math.max(gap, hues[i] - hues[i - 1]);
    gap = Math.max(gap, hues[0] + 360 - hues[hues.length - 1]);
    span = 360 - gap;
  }

  // Размах каждого пикселя за цикл, усреднённый по сердцевине.
  // Мера не зависит от числа фаз: с ростом фаз она сходится, а не
  // падает, как средняя разница между соседними кадрами.
  let swingSum = 0, swingMax = 0;
  for (const o of inside) {
    let s = 0;
    for (let ch = 0; ch < 3; ch++) {
      let mn = 255, mx = 0;
      for (const png of shots) { const v = png.data[o + ch]; if (v < mn) mn = v; if (v > mx) mx = v; }
      s += mx - mn;
    }
    s /= 3;
    swingSum += s; if (s > swingMax) swingMax = s;
  }
  const swing = swingSum / inside.length;

  // Силуэт: сколько пикселей кадра занимает сама капля. Считается по
  // ВТОРОМУ проходу, где крутится контур, а градиент стоит.
  const areas = shapes.map((png) => {
    const bg = [png.data[0], png.data[1], png.data[2]];
    let n = 0;
    for (let i = 0; i < W * H; i++) {
      const o = i << 2;
      if (Math.abs(png.data[o] - bg[0]) + Math.abs(png.data[o + 1] - bg[1]) + Math.abs(png.data[o + 2] - bg[2]) > 120) n++;
    }
    return n;
  });
  const aMin = Math.min(...areas), aMax = Math.max(...areas);
  const wobble = (aMax - aMin) / aMin * 100;

  // Порог по числу цветов невысок намеренно: капля 12 css-px, и
  // при пятибитном квантовании даже насыщенный градиент даёт
  // меньше сотни различимых оттенков. Главное — что их много
  // больше одного, что цвета разные и что внутри капли за цикл
  // действительно ходит краска, а не колышется её контур.
  const ok = bins.size >= 60 && span >= 25 && swing >= 20 && wobble >= 2;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok ' : 'НЕТ'} ${theme === 'dark' ? 'тёмная' : 'светлая'}: капля ${(W / SCALE).toFixed(0)}x${(H / SCALE).toFixed(0)} css-px, ${PHASES} фаз, ${inside.length} пикселей сердцевины`);
  console.log(`      перелив: ${periods.spark.map((q) => `${q.n} ${(q.d / 1000).toFixed(1)} с`).join(', ')}`);
  console.log(`      контур:  ${periods.shape.map((q) => `${q.n} ${(q.d / 1000).toFixed(1)} с`).join(', ')}`);
  console.log(`      различных цветов в сердцевине ${bins.size}, разброс тона ${span.toFixed(0)}°`);
  console.log(`      насыщенность ${sMin.toFixed(2)}–${sMax.toFixed(2)}, светлота ${lMin.toFixed(2)}–${lMax.toFixed(2)}`);
  console.log(`      размах пикселя сердцевины за цикл перелива: ${swing.toFixed(1)} уровня в среднем, ${swingMax.toFixed(1)} наибольший`);
  console.log(`      площадь силуэта при неподвижном градиенте ${(aMin / SCALE / SCALE).toFixed(0)}–${(aMax / SCALE / SCALE).toFixed(0)} css-px², колебание контура ${wobble.toFixed(1)} %`);
}

await b.close();
console.log(bad ? '\nПЕРЕЛИВА НЕТ ИЛИ ОН СЛИШКОМ СЛАБ' : '\nВнутри капли живой перелив в обеих темах');
process.exit(bad ? 1 : 0);
