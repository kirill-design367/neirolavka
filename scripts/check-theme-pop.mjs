/**
 * Не выскакивает ли что-нибудь в первый кадр смены темы.
 *
 * Градиент плашки объявлен только в тёмной теме, то есть само
 * свойство появляется скачком. Проверяем не свойство, а картинку:
 * снимок перед переключением и снимок сразу после него должны
 * отличаться настолько же, насколько отличается фон страницы за тот
 * же кадр, а не сильнее.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
await c.addInitScript(() => localStorage.setItem('neirolavka-theme', 'light'));
const p = await c.newPage();
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.evaluate(() => { const el = document.querySelector('.referral');
  window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 60); });
await p.waitForTimeout(900);
await p.evaluate(() => { const s = document.createElement('style');
  s.textContent = '.referral__content{visibility:hidden!important}'; document.head.appendChild(s); });
await p.waitForTimeout(200);

const box = await p.locator('.referral').boundingBox();
// Углы скруглены, и в них видно фон страницы — он в другой теме
// другой по определению. Отступаем от краёв, чтобы мерить плашку.
const M = 28;
const clip = { x: box.x + M, y: box.y + M, width: box.width - 2 * M,
               height: Math.min(box.height, 900 - box.y) - 2 * M };
const shot = async () => PNG.sync.read(await p.screenshot({ clip }));

const before = await shot();

// Гонки с переходом тут не нужны: вместо того чтобы ловить первый
// кадр, ставим тёмную тему и вручную держим все переменные плашки
// на светлых значениях. Это и есть нулевой момент перехода.
const light = await p.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return ['--c-fill', '--c-fill-1', '--c-fill-2', '--c-fill-3', '--c-fill-glow']
    .map((k) => [k, cs.getPropertyValue(k).trim()]);
});
await p.evaluate((vals) => {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.style.colorScheme = 'dark';
  const st = document.createElement('style');
  st.textContent = `:root{${vals.map(([k, v]) => `${k}:${v} !important`).join(';')}}`;
  document.head.appendChild(st);
}, light);
await p.waitForTimeout(400);
const after = await shot();
const bg = light.map(([k, v]) => `${k} ${v}`).join(', ');

let worst = 0, sum = 0, n = 0;
for (let i = 0; i < before.data.length; i += 4) {
  const d = Math.max(Math.abs(before.data[i] - after.data[i]),
                     Math.abs(before.data[i + 1] - after.data[i + 1]),
                     Math.abs(before.data[i + 2] - after.data[i + 2]));
  if (d > worst) worst = d;
  sum += d; n++;
}
console.log(`  плашка ${before.width}x${before.height} без скруглённых углов`);
console.log(`  переменные удержаны на светлых значениях: ${bg}`);
console.log(`  в нулевой момент перехода плашка отличается: наибольший канал ${worst} из 255, средний ${(sum / n).toFixed(2)}`);
console.log(worst <= 12 ? '  Появления градиента не видно' : '  ГРАДИЕНТ ВЫСКАКИВАЕТ');
await b.close();
process.exit(worst <= 12 ? 0 : 1);
