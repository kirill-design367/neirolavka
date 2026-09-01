/**
 * На что похожа прокрутка: на инерционную или на нативную.
 *
 * Настоящее колесо даёт не ровный поток, а щелчки с паузами. Именно
 * на таком вводе видно разницу между режимами Lenis: при duration
 * каждый щелчок заново запускает твин фиксированной длительности
 * с нулевой начальной скоростью, и движение получается ступенчатым.
 *
 * Меряем: сколько кадров страница реально движется, ровно ли идёт шаг
 * (рывок — изменение шага между соседними кадрами) и сколько раз
 * скорость падает почти до нуля посреди прокрутки (провалы = ступеньки).
 *
 * Запуск: node scripts/measure-scroll-feel.mjs <url> [зона]
 *   зона: «слева» (над содержимым) или «панель» (над панелью заказа)
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const ZONE = process.argv[3] ?? 'слева';
const browser = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /6 месяцев/ }).first().click().catch(() => {});
await page.waitForTimeout(500);

let x = 420, y = 500;
if (ZONE === 'панель') {
  const b = await page.locator('.order__paper').boundingBox();
  x = Math.round(b.x + b.width / 2); y = Math.round(b.y + b.height / 2);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.mouse.move(x, y);

const r = await page.evaluate(async () => {
  const pts = [];
  let run = true, lastY = window.scrollY, last = performance.now();
  const tick = () => {
    const t = performance.now();
    pts.push([+(t - last).toFixed(1), window.scrollY - lastY]);
    last = t; lastY = window.scrollY;
    if (run) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { pts, ready: true };
});

// восемь «щелчков» колеса с паузой, как у настоящей мыши
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, 110);
  await page.waitForTimeout(110);
}
await page.waitForTimeout(1200);

const out = await page.evaluate(() => {
  const pts = window.__pts || null;
  return pts;
});

// собираем заново — проще снять всё внутри страницы
const res = await page.evaluate(async () => {
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 400));
  const d = [];
  let run = true, lastY = window.scrollY, last = performance.now();
  const tick = () => {
    const t = performance.now();
    d.push([+(t - last).toFixed(1), +(window.scrollY - lastY).toFixed(2)]);
    last = t; lastY = window.scrollY;
    if (run) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  for (let i = 0; i < 8; i++) {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 110, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 110));
  }
  await new Promise((r) => setTimeout(r, 1200));
  run = false;
  return d.slice(2);
});

const moving = res.filter(([, dy]) => Math.abs(dy) > 0.01);
const steps = moving.map(([, dy]) => dy);
const avg = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const jerk = steps.slice(1).map((v, i) => Math.abs(v - steps[i]));
const mean = avg(steps);
// Ступенька — это ДОЛИНА: скорость просела и снова выросла. Просто
// низкая скорость не годится в признак: у затухания длинный хвост,
// и он давал бы ложные срабатывания.
let valleys = 0, deepest = 0;
for (let i = 2; i < steps.length - 2; i++) {
  const before = Math.max(steps[i - 2], steps[i - 1]);
  const after = Math.max(steps[i + 1], steps[i + 2]);
  const around = Math.min(before, after);
  if (around > mean * 0.3 && steps[i] < around * 0.55) {
    valleys++;
    deepest = Math.max(deepest, 1 - steps[i] / around);
  }
}

console.log(`── зона: ${ZONE} ──`);
console.log(`  кадров с движением:        ${moving.length}`);
console.log(`  суммарно прокручено:       ${Math.round(steps.reduce((s, v) => s + v, 0))} px`);
console.log(`  средний шаг за кадр:       ${mean.toFixed(2)} px`);
console.log(`  рывок между кадрами:       средний ${avg(jerk).toFixed(2)} px, макс ${Math.max(...jerk).toFixed(1)} px`);
console.log(`  ступенек (долин скорости):  ${valleys}${valleys ? `, глубочайшая ${Math.round(deepest * 100)}%` : ''}`);
console.log(`  хвост затухания:            ${moving.length ? (moving.length * 16.7 / 1000).toFixed(2) : 0} с`);
await browser.close();
