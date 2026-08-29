/**
 * Есть ли инерция на самом деле.
 *
 * Даём ОДИН щелчок колеса и пишем положение прокрутки на каждом кадре.
 * Нативная прокрутка прыгает за один-два кадра. Инерционная едет
 * десятки кадров с затухающей скоростью.
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const env = await page.evaluate(() => ({
  lenisClass: document.documentElement.className,
  hasLenisAttr: document.documentElement.hasAttribute('data-lenis'),
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  gsapTicker: typeof window.gsap !== 'undefined',
  preventNodes: document.querySelectorAll('[data-lenis-prevent]').length,
  scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
  bodyOverflow: getComputedStyle(document.body).overflowX,
  htmlOverflow: getComputedStyle(document.documentElement).overflowY,
}));
console.log('── окружение ──');
for (const [k, v] of Object.entries(env)) console.log(`  ${k}: ${v}`);

const curve = await page.evaluate(async () => {
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 300));
  const pts = [];
  let running = true;
  const t0 = performance.now();
  const tick = () => {
    pts.push([Math.round(performance.now() - t0), Math.round(window.scrollY)]);
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // один «щелчок» колеса
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 300, deltaMode: 0, bubbles: true, cancelable: true }));
  document.documentElement.dispatchEvent(new WheelEvent('wheel', { deltaY: 300, deltaMode: 0, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 1600));
  running = false;
  return pts;
});

const moved = curve.filter((p, i) => i === 0 || p[1] !== curve[i - 1][1]);
console.log('\n── кривая прокрутки после одного щелчка колеса ──');
console.log(`  всего кадров записано: ${curve.length}`);
console.log(`  кадров, где положение изменилось: ${moved.length}`);
console.log(`  итоговое смещение: ${curve.at(-1)[1]} px`);
if (moved.length > 1) {
  const dur = moved.at(-1)[0] - moved[1][0];
  console.log(`  движение длилось: ${dur} мс`);
  console.log(`  первые точки (мс:px): ${moved.slice(0, 12).map(([t, y]) => `${t}:${y}`).join('  ')}`);
  const speeds = [];
  for (let i = 2; i < moved.length; i++) speeds.push(moved[i][1] - moved[i - 1][1]);
  console.log(`  шаг за кадр, начало → конец: ${speeds.slice(0, 6).join(', ')} … ${speeds.slice(-6).join(', ')}`);
  console.log(`  ${dur > 250 && moved.length > 10 ? 'ИНЕРЦИЯ ЕСТЬ' : 'ИНЕРЦИИ НЕТ — прокрутка нативная'}`);
} else {
  console.log('  прокрутка не сдвинулась вовсе');
}
await browser.close();
