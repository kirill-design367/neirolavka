/**
 * Способ отрисовки заголовка: сплошная заливка против background-clip.
 *
 * Цвет краски в обеих съёмках один и тот же (--c-brand), различаться
 * может только способ вывода текста. Значит расхождение — это разница
 * отрисовки, а не разница палитры.
 *
 * Границы штрихов ищутся построчно и сопоставляются по близости,
 * а не по номеру: иначе одна лишняя точка сдвигает весь список.
 *
 * Второй прогон — с включённым субпиксельным сглаживанием текста:
 * так рисует обычный браузер на экране пользователя, и именно там
 * разница между способами вывода становится заметной.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const measure = async (browser, SCALE, theme) => {
  const c = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU',
                                       deviceScaleFactor: SCALE, reducedMotion: 'reduce' });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const grab = async (mode) => {
    await p.evaluate(([m, t]) => {
      const root = document.documentElement;
      root.dataset.theme = t;
      root.style.colorScheme = t;
      const paint = getComputedStyle(root).getPropertyValue('--c-brand').trim();
      const rule = m === 'clip'
        ? `.hero__title{background-image:linear-gradient(104deg,${paint} 0%,${paint} 100%) !important;` +
          '-webkit-background-clip:text !important;background-clip:text !important;color:transparent !important}'
        : '.hero__title{background-image:none !important;-webkit-background-clip:border-box !important;' +
          `background-clip:border-box !important;color:${paint} !important}`;
      let s = document.getElementById('probe');
      if (!s) { s = document.createElement('style'); s.id = 'probe'; document.head.appendChild(s); }
      s.textContent = rule;
    }, [mode, theme]);
    await p.waitForTimeout(280);
    return PNG.sync.read(await p.locator('.hero__title').screenshot());
  };

  const solid = await grab('solid');
  const clip = await grab('clip');
  await c.close();
  const W = solid.width, H = solid.height;

  const cover = (png) => {
    const bg = [png.data[0], png.data[1], png.data[2]];
    const a = new Float64Array(W * H);
    let maxd = 1;
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      const d = Math.abs(png.data[o] - bg[0]) + Math.abs(png.data[o + 1] - bg[1]) + Math.abs(png.data[o + 2] - bg[2]);
      a[i] = d; if (d > maxd) maxd = d;
    }
    for (let i = 0; i < a.length; i++) a[i] /= maxd;
    return a;
  };
  const cs = cover(solid), cc = cover(clip);

  let diff = 0, maxd = 0;
  for (let i = 0; i < W * H; i++) { const d = Math.abs(cs[i] - cc[i]); if (d > 0.02) diff++; if (d > maxd) maxd = d; }
  const ink = (a) => a.reduce((s, v) => s + v, 0);
  const is = ink(cs), ic = ink(cc);

  // Границы штрихов внутри одной строки, сопоставленные по близости.
  let worst = 0, sum = 0, cnt = 0;
  for (let y = 0; y < H; y++) {
    const row = (a) => { const e = [];
      for (let x = 1; x < W; x++) { const p0 = a[y * W + x - 1], p1 = a[y * W + x];
        if ((p0 < 0.5) !== (p1 < 0.5)) e.push(x - 1 + (0.5 - p0) / (p1 - p0)); } return e; };
    const es = row(cs), ec = row(cc);
    for (const v of es) {
      let best = Infinity;
      for (const u of ec) { const d = Math.abs(u - v); if (d < best) best = d; }
      if (best < 4) { sum += best; cnt++; if (best > worst) worst = best; }
    }
  }
  return { W, H, diff, maxd, is, ic, worst: worst / SCALE, avg: (sum / (cnt || 1)) / SCALE, cnt };
};

for (const [args, label] of [[[], 'сглаживание по серому (как в headless по умолчанию)'],
                             [['--enable-lcd-text', '--force-device-scale-factor=1'], 'субпиксельное сглаживание текста']]) {
  const b = await chromium.launch({ executablePath: EXEC, args });
  console.log(`\n  ${label}`);
  for (const SCALE of [1, 2]) {
    for (const theme of ['light', 'dark']) {
      const r = await measure(b, SCALE, theme);
      console.log(`    dpr ${SCALE}, ${theme}: ${r.W}x${r.H}; пикселей с разным покрытием ${r.diff} (${(r.diff / (r.W * r.H) * 100).toFixed(2)} %), ` +
        `наибольшая разница покрытия ${r.maxd.toFixed(3)}`);
      console.log(`      краски: сплошная ${r.is.toFixed(0)}, через обрезку ${r.ic.toFixed(0)}, разница ${((r.ic - r.is) / r.is * 100).toFixed(2)} %`);
      console.log(`      сдвиг границ штрихов (${r.cnt} точек): наибольший ${r.worst.toFixed(3)} css-px, средний ${r.avg.toFixed(3)} css-px`);
    }
  }
  await b.close();
}
