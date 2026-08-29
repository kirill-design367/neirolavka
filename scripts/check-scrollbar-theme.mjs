/**
 * Полоса прокрутки и фон страницы: приходят ли они к конечному цвету
 * одновременно.
 *
 * Замер идёт ПО ПИКСЕЛЯМ, а не по объявленному цвету. Для этого нужен
 * настоящий браузер с окном: в headless полосы прокрутки наложенные,
 * ширины не занимают и в снимок не попадают вовсе. Поэтому скрипт
 * запускается так:
 *
 *   xvfb-run -a node scripts/check-scrollbar-theme.mjs <url>
 *
 * На странице создаётся прокручиваемый пробник с прозрачным фоном —
 * у него настоящая полоса, покрашенная тем же наследуемым
 * scrollbar-color, что и у окна. Кадры снимаются потоком через
 * Page.startScreencast, поэтому это именно покадровая съёмка, а не
 * несколько отдельных снимков.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: CHROME, headless: false });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

// Пробник и точка чистого фона страницы.
const probe = await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'sb-probe';
  d.style.cssText = 'position:fixed;left:24px;top:120px;width:140px;height:240px;' +
                    'overflow-y:scroll;z-index:99999;background:transparent;pointer-events:none';
  d.innerHTML = '<div style="height:1200px"></div>';
  document.body.appendChild(d);
  const r = d.getBoundingClientRect();
  const barW = d.offsetWidth - d.clientWidth;

  // Точка, где виден именно фон страницы, а не карточка поверх него.
  let bg = null;
  for (let y = 200; y < 880 && !bg; y += 20) {
    for (let x = 1490; x > 1200; x -= 20) {
      const el = document.elementFromPoint(x, y);
      if (el && (el === document.body || el === document.documentElement)) { bg = { x, y }; break; }
    }
  }
  return { x: r.x, y: r.y, w: r.width, h: r.height, barW, bg };
});

if (!probe.barW) {
  console.log('  НЕТ полосы прокрутки в этом браузере: ширина полосы 0.');
  console.log('  Запускайте под xvfb-run — в headless полосы наложенные и не рисуются.');
  await browser.close();
  process.exit(1);
}
if (!probe.bg) {
  console.log('  НЕ НАЙДЕНА точка чистого фона страницы — правьте поиск в скрипте.');
  await browser.close();
  process.exit(1);
}

// Где внутри полосы ползунок, а где дорожка.
const THUMB = { x: Math.round(probe.x + probe.w - probe.barW / 2), y: Math.round(probe.y + 40) };
const TRACK = { x: THUMB.x, y: Math.round(probe.y + probe.h - 20) };

const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ t: f.metadata.timestamp * 1000, data: f.data });
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
});

await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
await page.waitForTimeout(160);
const t0 = await page.evaluate(() => {
  document.querySelector('.theme-toggle').click();
  return performance.timeOrigin + performance.now();
});
await page.waitForTimeout(900);
await cdp.send('Page.stopScreencast');
await browser.close();

const pick = (png, p) => { const o = (png.width * p.y + p.x) << 2; return [png.data[o], png.data[o + 1], png.data[o + 2]]; };
const rows = [];
for (const f of frames) {
  const png = PNG.sync.read(Buffer.from(f.data, 'base64'));
  if (png.width < 1512) continue;
  rows.push({ t: f.t - t0, thumb: pick(png, THUMB), track: pick(png, TRACK), bg: pick(png, probe.bg) });
}
const after = rows.filter((r) => r.t >= -30);
if (after.length < 6) {
  console.log(`  СЛИШКОМ МАЛО КАДРОВ: ${after.length}. Замер недействителен.`);
  process.exit(1);
}

const same = (a, b) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1 && Math.abs(a[2] - b[2]) <= 1;
const settle = (key) => {
  const fin = after[after.length - 1][key];
  // Первый кадр, начиная с которого цвет уже не меняется до конца.
  for (let i = 0; i < after.length; i++) {
    let ok = true;
    for (let j = i; j < after.length; j++) if (!same(after[j][key], fin)) { ok = false; break; }
    if (ok) return { t: after[i].t, c: fin };
  }
  return { t: NaN, c: fin };
};
const steps = (key) => new Set(after.map((r) => r[key].join(','))).size;

const s = {};
for (const k of ['thumb', 'track', 'bg']) s[k] = { ...settle(k), n: steps(k) };

const label = { thumb: 'ползунок полосы', track: 'дорожка полосы', bg: 'фон страницы' };
console.log(`  кадров за переход: ${after.length}, шаг ${(after[after.length - 1].t / (after.length - 1)).toFixed(1)} мс`);
console.log(`  точка ползунка ${THUMB.x},${THUMB.y}; дорожки ${TRACK.x},${TRACK.y}; фона ${probe.bg.x},${probe.bg.y}`);
for (const k of ['bg', 'thumb', 'track'])
  console.log(`  ${label[k].padEnd(16)} различных цветов за переход ${String(s[k].n).padStart(3)}, ` +
              `конечный rgb(${s[k].c.join(',')}) достигнут на ${s[k].t.toFixed(0)} мс`);

const spread = Math.max(s.bg.t, s.thumb.t, s.track.t) - Math.min(s.bg.t, s.thumb.t, s.track.t);
const jumpy = ['thumb', 'track'].filter((k) => s[k].n <= 2);
console.log(`  разброс окончания: ${spread.toFixed(0)} мс`);
if (jumpy.length) console.log(`  СКАЧКОМ: ${jumpy.map((k) => label[k]).join(', ')} — цвет меняется без промежуточных значений`);
const ok = spread <= 60 && !jumpy.length;
console.log(ok ? '  Полоса и фон приходят к цвету одновременно' : '  ПОЛОСА И ФОН РАСХОДЯТСЯ');
process.exit(ok ? 0 : 1);
