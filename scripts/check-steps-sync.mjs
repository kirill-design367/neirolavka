/**
 * Дорожка шагов: совпадает ли конец подсвеченного участка с точкой.
 *
 * Анимации ставятся на паузу и прокручиваются по времени вручную,
 * поэтому замер не зависит от того, в какой момент сделан снимок.
 * Сравниваем край заливки и центр точки в пикселях.
 */
import { chromium } from 'playwright';

const URL = process.argv[2];

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const parse = (c) => c.match(/[\d.]+/g).map(Number).slice(0, 3);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;

for (const [w, name, theme] of [[1512, 'десктоп, светлая', 'light'], [1512, 'десктоп, тёмная', 'dark'],
                                [390, 'мобильная, светлая', 'light'], [390, 'мобильная, тёмная', 'dark']]) {
  const c = await b.newContext({ viewport: { width: w, height: 900 }, locale: 'ru-RU',
                                 isMobile: w < 500, hasTouch: w < 500 });
  await c.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  await p.locator('.steps').scrollIntoViewIfNeeded();
  await p.waitForTimeout(700);

  const r = await p.evaluate(() => {
    const fill = document.querySelector('.steps__track-fill');
    const led = document.querySelector('.steps__led');
    const thread = document.querySelector('.steps__thread');
    const nodes = [...document.querySelectorAll('.step__node')];
    const horiz = thread.dataset.trackDir === 'horizontal';
    // Берём анимации, привязанные к циклу дорожки; колыхание капли
    // живёт своей длительностью и в разбор времени не идёт.
    const cyc = fill.getAnimations()[0].effect.getTiming().duration;
    const anims = [...fill.getAnimations(), ...led.getAnimations(), ...nodes.flatMap((n) => n.getAnimations())]
      .filter((a) => a.effect.getTiming().duration === cyc);
    anims.forEach((a) => a.pause());

    // «Зажжён» определяем по близости фона к брендовому цвету, а не
    // по отклонению от первого кадра: у первого узла первый кадр и
    // есть зажжённый, и отсчёт от него дал бы обратную картину.
    const rgb = (c) => c.match(/[\d.]+/g).map(Number).slice(0, 3);
    const brand = rgb(getComputedStyle(document.documentElement).getPropertyValue('--c-brand') ||
                      getComputedStyle(fill).backgroundColor);
    const dist = (c) => { const m = rgb(c);
      return Math.hypot(m[0] - brand[0], m[1] - brand[1], m[2] - brand[2]); };
    const out = [];
    // Отсчёт идёт с четвёртого повтора, а не с первого: у второго и
    // третьего узла задержка в 2.2 и 4.4 с, и внутри неё анимация
    // вообще не применяет стилей — первый повтор показывает не то,
    // что видит человек через пару секунд после загрузки.
    const N = 200;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * cyc + cyc * 3;
      anims.forEach((a) => { a.currentTime = t; });
      const f = fill.getBoundingClientRect();
      const l = led.getBoundingClientRect();
      const fs = getComputedStyle(fill), ls = getComputedStyle(led);
      const edge = horiz ? f.right : f.bottom;
      const dot = horiz ? l.left + l.width / 2 : l.top + l.height / 2;
      const ext = horiz ? f.width : f.height;
      const nodeState = nodes.map((n, k) => {
        const st = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        return { d: -dist(st.backgroundColor),
                 c: horiz ? r.left + r.width / 2 : r.top + r.height / 2,
                 bg: st.backgroundColor,
                 col: getComputedStyle(n.querySelector('.step__num')).color,
                 bw: st.borderTopWidth };
      });
      out.push({ t: +((t - cyc * 3) / cyc).toFixed(3), gap: +(edge - dot).toFixed(2), ext: +ext.toFixed(1),
                 fo: +(+fs.opacity).toFixed(2), lo: +(+ls.opacity).toFixed(2), dot, nodes: nodeState });
    }
    anims.forEach((a) => a.play());
    return { cycle: cyc, horiz, len: getComputedStyle(thread).getPropertyValue('--track-len').trim(), out,
             count: nodes.length };
  });

  // Считаем расхождение только там, где видно и заливку, и точку,
  // и где у заливки уже есть длина.
  const vis = r.out.filter((s) => s.fo > 0.05 && s.lo > 0.05 && s.ext > 1);
  const worst = vis.reduce((m, s) => (Math.abs(s.gap) > Math.abs(m.gap) ? s : m), { gap: 0, t: 0 });
  const len = parseFloat(r.len) || 1;
  const blind = r.out.filter((s) => s.fo > 0.05 && s.ext > 1 && s.lo <= 0.05).length;

  // Момент, когда узел горит ярче всего, и где в этот момент капля.
  const arrive = [];
  for (let k = 0; k < r.count; k++) {
    let best = r.out[0], bd = -1;
    for (const s of r.out) if (s.nodes[k].d > bd) { bd = s.nodes[k].d; best = s; }
    arrive.push({ k, t: best.t, off: +(best.dot - best.nodes[k].c).toFixed(2),
                  bg: best.nodes[k].bg, col: best.nodes[k].col, bw: best.nodes[k].bw, amp: +bd.toFixed(1) });
  }
  const worstArr = arrive.reduce((m, a) => (Math.abs(a.off) > Math.abs(m.off) ? a : m), arrive[0]);

  // Контраст цифры на фоне узла во ВСЕХ фазах, включая разгорание
  // и затухание: середина перехода — самое опасное место.
  let wc = { r: 99 };
  for (const s2 of r.out) for (const n of s2.nodes) {
    const cr = ratio(parse(n.col), parse(n.bg));
    if (cr < wc.r) wc = { r: cr, t: s2.t, col: n.col, bg: n.bg };
  }

  const ok = Math.abs(worst.gap) <= 1.5 && blind === 0 && Math.abs(worstArr.off) <= 6 && wc.r >= 4.5;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok ' : 'НЕТ'} ${name}: дорожка ${r.horiz ? 'горизонтальная' : 'вертикальная'} ${len.toFixed(0)} px, цикл ${r.cycle} мс, ${r.out.length} проб`);
  console.log(`      наибольший обгон заливки: ${worst.gap} px (${(worst.gap / len * 100).toFixed(1)} % дорожки) на доле цикла ${worst.t}`);
  console.log(`      проб, где заливка видна, а капли нет: ${blind} из ${r.out.length}`);
  for (const a of arrive)
    console.log(`      узел ${a.k + 1} ярче всего на доле ${a.t}, капля в ${a.off} px от его центра; фон ${a.bg}, цифра ${a.col}, обводка ${a.bw}`);
  console.log(`      худший контраст цифры за цикл: ${wc.r.toFixed(2)}:1 на доле ${wc.t} (цифра ${wc.col} на ${wc.bg})`);
  await c.close();
}

console.log(bad ? 'ЗАЛИВКА И ТОЧКА РАСХОДЯТСЯ' : 'Заливка заканчивается на точке');
await b.close();
process.exit(bad ? 1 : 0);
