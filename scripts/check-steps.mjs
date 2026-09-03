/**
 * Светодиод по дорожке шагов: проверяем геометрию и работу цикла.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
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
      const core = document.querySelector('.steps__led-core');
      if (!core) throw new Error('нет .steps__led-core — проба устарела');
      const fill = document.querySelector('.steps__track-fill');
      const halo = document.querySelector('.step__halo');
      // Все три цифры, а не первая: у них разное ожидаемое поведение.
      // Первая горит весь цикл — свет рождается на ней и уже не гаснет;
      // у остальных ровно два состояния, тёмное и зелёное.
      const nodes = [...document.querySelectorAll('.step__node')];
      const nums = [...document.querySelectorAll('.step__num')];
      const acc = { led: new Set(), fill: new Set(), halo: new Set(), num: new Set(),
                    // Силуэт капли. Он ОБЯЗАН быть постоянным: светодиод
                    // с меняющейся формой читается артефактом отрисовки,
                    // а не движущимся предметом. Живость даёт дыхание
                    // ореола, а не пляска контура.
                    shape: new Set(), bg: new Set(), border: new Set(),
                    bgN: nodes.map(() => new Set()), numN: nums.map(() => new Set()) };
      const t0 = performance.now();
      await new Promise((res) => { const t = () => {
        acc.led.add(getComputedStyle(led).translate);
        acc.fill.add(getComputedStyle(fill).transform);
        acc.halo.add(getComputedStyle(halo).opacity);
        acc.num.add(getComputedStyle(nums[1]).color);
        nodes.forEach((n, i) => acc.bgN[i].add(getComputedStyle(n).backgroundColor));
        nums.forEach((n, i) => acc.numN[i].add(getComputedStyle(n).color));
        acc.shape.add([getComputedStyle(core).transform, getComputedStyle(core).borderRadius,
                       getComputedStyle(led).width, getComputedStyle(led).height].join('|'));
        acc.bg.add(getComputedStyle(nodes[1]).backgroundColor);
        // Обводки у кружка быть не должно вовсе — следим за ШИРИНОЙ.
        acc.border.add(getComputedStyle(nodes[1]).borderTopWidth);
        performance.now() - t0 < 6800 ? requestAnimationFrame(t) : res(); }; requestAnimationFrame(t); });
      return { led: acc.led.size, fill: acc.fill.size, halo: acc.halo.size, num: acc.num.size,
               shape: acc.shape.size, bg: acc.bg.size, border: acc.border.size,
               bgN: acc.bgN.map((v) => v.size), numN: acc.numN.map((v) => v.size),
               zero: [...acc.border].every((v) => v === '0px'), widths: [...acc.border].join('/') };
    });

    const okGeom = geom.dir === (w < 500 ? 'vertical' : 'horizontal') && geom.trackEnd <= 2 && geom.at.length === 3;
    const okMove = rm
      ? (move.led === 1 && move.fill === 1 && move.halo === 1 && move.num === 1 &&
         move.shape === 1 && move.bg === 1 && move.border === 1 && move.zero)
      // У заливки узла и цифры ровно два состояния — так и задумано:
      // промежуточные цвета делали цифру нечитаемой (см. steps.css).
      // А у ПЕРВОЙ цифры состояние одно: свет рождается на ней
      // и до конца цикла не гаснет, поэтому тёмной её не застать
      // ни на одном кадре. Двойка здесь означала бы, что цифра
      // гаснет вслед за каплей, — то, от чего ушли.
      // Обводки нет вовсе: её ширина обязана оставаться нулевой.
      // Силуэт ровно один: см. комментарий у acc.shape.
      : (move.led > 20 && move.fill > 20 && move.halo > 5 &&
         move.shape === 1 && move.bg === 2 && move.num === 2 && move.border === 1 && move.zero &&
         move.bgN[0] === 1 && move.numN[0] === 1 &&
         move.bgN.slice(1).every((v) => v === 2) && move.numN.slice(1).every((v) => v === 2));
    if (!okGeom || !okMove) bad++;
    console.log(`  ${okGeom && okMove ? 'ok ' : 'НЕТ'} ${name}${rm ? ', движение выключено' : ''}: ` +
      `дорожка ${geom.dir}, длина ${geom.len}, конец в ${geom.trackEnd} px от центра последнего кружка, ` +
      `доли ${geom.at.join('/')}`);
    console.log(`      за полный цикл: капля ${move.led} положений и ${move.shape} состояний контура, заливка ${move.fill}, ` +
      `свечение ${move.halo}, силуэт капли ${move.shape} (должен быть 1), ` +
      `цветов фона у цифр ${move.bgN.join('/')} (ждём ${rm ? '1/1/1' : '1/2/2'}), у самих цифр ${move.numN.join('/')}, ` +
      `ширина обводки ${move.widths}`);
    await c.close();
  }
}
await b.close();
console.log(bad ? `\nПроблем: ${bad}` : '\nСветодиод работает в обеих раскладках, при выключенном движении стоит');
process.exit(bad ? 1 : 0);
