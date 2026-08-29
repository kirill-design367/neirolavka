/**
 * Светодиод по дорожке шагов: проверяем геометрию и работу цикла.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;

for (const [w, name] of [[1512, 'десктоп'], [390, 'мобильная']]) {
  for (const rm of [false, true]) {
    const c = await b.newContext({ viewport: { width: w, height: 900 }, locale: 'ru-RU',
                                   isMobile: w < 500, hasTouch: w < 500,
                                   reducedMotion: rm ? 'reduce' : 'no-preference' });
    const p = await c.newPage();
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(500);
    await p.locator('.steps').scrollIntoViewIfNeeded();
    await p.waitForTimeout(700);

    const geom = await p.evaluate(() => {
      const th = document.querySelector('.steps__thread');
      const nodes = [...document.querySelectorAll('.step__node')];
      const base = th.getBoundingClientRect();
      return {
        dir: th.dataset.trackDir,
        len: getComputedStyle(th).getPropertyValue('--track-len').trim(),
        at: [...document.querySelectorAll('.step')].map((e) => getComputedStyle(e).getPropertyValue('--at').trim()),
        // совпадает ли конец дорожки с центром последнего кружка
        trackEnd: (() => {
          const t = document.querySelector('.steps__track').getBoundingClientRect();
          const n = nodes[nodes.length - 1].getBoundingClientRect();
          return th.dataset.trackDir === 'horizontal'
            ? Math.round(Math.abs(t.right - (n.left + n.width / 2)))
            : Math.round(Math.abs(t.bottom - (n.top + n.height / 2)));
        })(),
      };
    });

    const move = await p.evaluate(async () => {
      const led = document.querySelector('.steps__led');
      const fill = document.querySelector('.steps__track-fill');
      const halo = document.querySelector('.step__halo');
      const num = document.querySelector('.step__num');
      const acc = { led: new Set(), fill: new Set(), halo: new Set(), num: new Set() };
      const t0 = performance.now();
      await new Promise((res) => { const t = () => {
        acc.led.add(getComputedStyle(led).translate);
        acc.fill.add(getComputedStyle(fill).transform);
        acc.halo.add(getComputedStyle(halo).opacity);
        acc.num.add(getComputedStyle(num).color);
        performance.now() - t0 < 6800 ? requestAnimationFrame(t) : res(); }; requestAnimationFrame(t); });
      return { led: acc.led.size, fill: acc.fill.size, halo: acc.halo.size, num: acc.num.size };
    });

    const okGeom = geom.dir === (w < 500 ? 'vertical' : 'horizontal') && geom.trackEnd <= 2 && geom.at.length === 3;
    const okMove = rm ? (move.led === 1 && move.fill === 1 && move.halo === 1 && move.num === 1)
                      : (move.led > 20 && move.fill > 20 && move.halo > 5 && move.num > 2);
    if (!okGeom || !okMove) bad++;
    console.log(`  ${okGeom && okMove ? 'ok ' : 'НЕТ'} ${name}${rm ? ', движение выключено' : ''}: ` +
      `дорожка ${geom.dir}, длина ${geom.len}, конец в ${geom.trackEnd} px от центра последнего кружка, ` +
      `доли ${geom.at.join('/')}`);
    console.log(`      за полный цикл: точка ${move.led} положений, заливка ${move.fill}, кольцо ${move.halo}, цвет номера ${move.num}`);
    await c.close();
  }
}
await b.close();
console.log(bad ? `\nПроблем: ${bad}` : '\nСветодиод работает в обеих раскладках, при выключенном движении стоит');
process.exit(bad ? 1 : 0);
