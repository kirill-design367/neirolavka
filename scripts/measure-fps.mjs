/**
 * Замер плавности на настоящей прокрутке.
 *
 * Мы не «смотрим, кажется ли гладко»: страница прокручивается колесом,
 * а в это время пишутся интервалы между кадрами через requestAnimationFrame
 * и длинные кадры через PerformanceObserver('long-animation-frame').
 *
 * Запуск: node scripts/measure-fps.mjs http://localhost:4173/neirolavka/ [замедление]
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const SLOWDOWN = Number(process.argv[3] ?? 1);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();

const cdp = await ctx.newCDPSession(page);
if (SLOWDOWN > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });

await page.goto(URL, { waitUntil: 'networkidle' });
// Прогрев. Тяжёлое украшение первого экрана грузится по первому
// действию человека, и без прогрева его разбор попадает в замер
// прокрутки одним длинным кадром: на замедленном процессоре это
// было 316 мс и 18 % просевших кадров вместо трёх. Мерить надо
// установившуюся прокрутку, а цену загрузки — отдельно.
await page.mouse.move(300, 200);
await page.mouse.move(304, 204);
await page.waitForTimeout(3500);

await page.evaluate(() => {
  window.__frames = [];
  window.__loaf = [];
  let last = performance.now();
  const tick = (t) => {
    window.__frames.push(t - last);
    last = t;
    window.__raf = requestAnimationFrame(tick);
  };
  window.__raf = requestAnimationFrame(tick);
  try {
    window.__obs = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__loaf.push(e.duration);
    });
    window.__obs.observe({ type: 'long-animation-frame', buffered: false });
  } catch { /* браузер без LoAF */ }
});

// Настоящая прокрутка колесом: Lenis перехватывает именно её.
const height = await page.evaluate(() => document.body.scrollHeight);
const steps = 90;
for (let i = 0; i < steps; i++) {
  await page.mouse.wheel(0, height / steps);
  await page.waitForTimeout(16);
}
await page.waitForTimeout(400);

const r = await page.evaluate(() => {
  cancelAnimationFrame(window.__raf);
  window.__obs?.disconnect();
  // Первые кадры после старта наблюдения — шум установки.
  const f = window.__frames.slice(3);
  const sorted = [...f].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.floor((sorted.length - 1) * p)];
  return {
    frames: f.length,
    avg: f.reduce((s, x) => s + x, 0) / f.length,
    p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted.at(-1),
    over17: f.filter((x) => x > 17).length,
    over33: f.filter((x) => x > 33).length,
    loaf: window.__loaf.length,
    loafMax: window.__loaf.length ? Math.max(...window.__loaf) : 0,
  };
});

await browser.close();

const fps = 1000 / r.p50;
console.log(`\n── Прокрутка, замедление процессора ×${SLOWDOWN} ──`);
console.log(`  кадров записано:      ${r.frames}`);
console.log(`  медиана кадра:        ${r.p50.toFixed(2)} мс  (${fps.toFixed(1)} fps)`);
console.log(`  средний кадр:         ${r.avg.toFixed(2)} мс`);
console.log(`  95-й процентиль:      ${r.p95.toFixed(2)} мс`);
console.log(`  99-й процентиль:      ${r.p99.toFixed(2)} мс`);
console.log(`  худший кадр:          ${r.max.toFixed(2)} мс`);
console.log(`  кадров дольше 17 мс:  ${r.over17} (${(r.over17 / r.frames * 100).toFixed(1)}%)`);
console.log(`  кадров дольше 33 мс:  ${r.over33} (${(r.over33 / r.frames * 100).toFixed(1)}%)`);
console.log(`  длинных кадров LoAF:  ${r.loaf}, худший ${r.loafMax.toFixed(0)} мс`);
