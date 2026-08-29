/**
 * Момент загорания узла — замер ПО ВИДИМОЙ КАРТИНКЕ.
 *
 * Координата центра капли тут ничего не доказывает: у капли
 * аморфный контур и свечение вокруг, её видимый край доходит до
 * кружка заметно раньше центра. Поэтому всё меряется по пикселям.
 *
 * Как: анимации цикла прокручиваются по времени вручную мелким
 * шагом вокруг ожидаемого прихода капли к каждому узлу. Время
 * отсчитывается НЕ с первого повтора: у второго и третьего узла
 * задержка в 2.2 и 4.4 с, и внутри неё анимация вообще не применяет
 * стилей — там не видно ни преждевременного разгорания, ни чего-либо
 * ещё. Поэтому ко всем моментам прибавляется три полных цикла. Перелив и
 * колыхание при этом замораживаются, иначе форма капли гуляет от
 * кадра к кадру и центр «плавает».
 *
 * Для каждого кадра считается
 *   — яркость ВИДИМОГО узла над его же ПОГАШЕННЫМ состоянием,
 *     снятым отдельным кадром на полцикла в стороне (в общем опорном
 *     кадре первый узел горит, и отсчёт от него дал бы обратную
 *     картину). Берётся не диск кружка, а половина круга радиусом
 *     чуть больше кружка — со стороны, КУДА капля ещё не дошла.
 *     Диска мало: свечение узла лежит кольцом снаружи кружка, и по
 *     одной заливке преждевременной вспышки не увидеть вовсе.
 *     Половина нужна, чтобы в замер не попадал свет самой капли.
 *     Полоска дорожки из этой половины тоже выкидывается: в опорном
 *     кадре она уже залита, и без этого набегает постоянная разница
 *     в несколько уровней — как раз того же порядка, что и искомая
 *     преждевременная вспышка.
 *
 * Загоранием считается первый кадр, где эта яркость поднялась над
 * погашенным состоянием на два уровня из 255. Порог АБСОЛЮТНЫЙ, а не
 * доля от максимума: максимум набирает заливка кружка, она в разы
 * ярче ореола, и любой порог в долях от неё преждевременного
 * разгорания ореола просто не замечает.
 *   — одномерный профиль лишнего света вдоль дорожки: пик профиля
 *     это видимый центр капли, а край — там, где профиль спадает
 *     до двадцатой части пика.
 *
 * Прямо в момент прихода капля лежит НА кружке, и по картинке её
 * там уже не отделить от загоревшегося узла. Поэтому видимый центр
 * снимается на подходе, пока капля чиста от кружка, по этим точкам
 * строится прямая (движение равномерное), и по ней вычисляется
 * момент, когда центр капли проходит через центр кружка. Разница
 * этого момента и момента загорания — и есть искомое расхождение;
 * в пикселях оно пересчитывается по измеренной же скорости.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const STEP_MS = Number(process.argv[3] ?? 8);
// Нижняя граница окна. Обычно окно всё равно шире: оно считается из
// скорости капли, иначе на телефоне она не успевает отойти от кружка.
const HALF_MS = Number(process.argv[4] ?? 320);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;
// Одна и та же геометрия, снятая в двух темах, даёт для метода
// независимую оценку одного и того же момента. Расхождение между
// ними и есть точность метода — печатать доли пикселя, которых у
// него нет, нельзя.
const cross = new Map();

for (const [w, name] of [[1512, 'десктоп'], [390, 'мобильная']]) {
  for (const theme of ['light', 'dark']) {
    const c = await b.newContext({ viewport: { width: w, height: 900 }, locale: 'ru-RU',
                                   isMobile: w < 500, hasTouch: w < 500 });
    await c.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
    const p = await c.newPage();
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    await p.locator('.steps__thread').scrollIntoViewIfNeeded();
    await p.waitForTimeout(800);

    const setup = await p.evaluate(() => {
      const thread = document.querySelector('.steps__thread');
      const fill = document.querySelector('.steps__track-fill');
      const cyc = fill.getAnimations()[0].effect.getTiming().duration;
      const horiz = thread.dataset.trackDir === 'horizontal';
      // Перелив и колыхание замораживаем: форма капли должна быть
      // одинаковой во всех кадрах, иначе её центр гуляет сам по себе.
      document.getAnimations().forEach((a) => {
        const n = a.animationName || '';
        if (n.startsWith('spark-') || n.startsWith('led-wobble') || n === 'led-breathe') { a.pause(); a.currentTime = 0; }
      });
      window.__cyc = document.getAnimations().filter((a) => a.effect.getTiming().duration === cyc);
      window.__cyc.forEach((a) => a.pause());
      const base = thread.getBoundingClientRect();
      const nodes = [...document.querySelectorAll('.step__node')].map((n) => {
        const r = n.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2,
                 at: parseFloat(getComputedStyle(n.closest('.step')).getPropertyValue('--at')) || 0 };
      });
      const led = document.querySelector('.steps__led').getBoundingClientRect();
      return { cyc, horiz, nodes, ledSize: Math.round(led.width),
               trackLen: parseFloat(getComputedStyle(thread).getPropertyValue('--track-len')) || 0,
               run: parseFloat(getComputedStyle(thread).getPropertyValue('--run')) || 0.78,
               band: { x: Math.round(base.left), y: Math.round(base.top),
                       w: Math.round(base.width), h: Math.round(base.height) } };
    });

    // Снимаем узкую полосу вокруг дорожки, а не весь экран: кадров
    // много, и полный снимок делает замер невыносимо долгим.
    const PAD = 44;
    const clip = { x: Math.max(0, setup.band.x - PAD), y: Math.max(0, setup.band.y - PAD),
                   width: setup.band.w + PAD * 2, height: setup.band.h + PAD * 2 };
    clip.width = Math.min(clip.width, w - clip.x);
    clip.height = Math.min(clip.height, 900 - clip.y);
    const OFFSET = setup.cyc * 3;
    const at = async (ms) => {
      await p.evaluate((t) => { window.__cyc.forEach((a) => { a.currentTime = t; }); }, ms + OFFSET);
      await p.waitForTimeout(18);
      return PNG.sync.read(await p.screenshot({ clip }));
    };

    const lum = (d, o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    // Кадр без капли и без заливки: самое начало цикла.
    const ref = await at(0.0001);

    const NODES = setup.nodes.map((n) => ({ ...n, cx: n.cx - clip.x, cy: n.cy - clip.y }));
    const BAND = { x: setup.band.x - clip.x, y: setup.band.y - clip.y, w: setup.band.w, h: setup.band.h };

    // Окно подбирается под скорость капли, а не задаётся числом:
    // на телефоне дорожка вдвое короче, капля идёт вдвое медленнее,
    // и за фиксированные 260 мс она не успевает отойти от кружка —
    // чистых кадров для прямой не остаётся вовсе.
    const speedGuess = setup.trackLen / (setup.run * setup.cyc);   // px за мс
    const HALF = Math.min(1500, Math.max(HALF_MS, (NODES[0].r + 8 + 110) / speedGuess));
    const FINE = 300;

    // Один проход по времени на все узлы сразу: кадр снимается один
    // раз и разбирается для каждого узла. Мелкий шаг — только рядом с
    // ожидаемым загоранием, дальше он не нужен: там ловится прямая.
    const times = new Set();
    const add = (t) => times.add(Math.round(t * 100) / 100);
    for (const nd of NODES) {
      const e = nd.at * setup.run * setup.cyc;
      for (let t = e - FINE; t <= e + FINE; t += STEP_MS) add(t);
      for (let t = e - HALF; t <= e + HALF; t += 40) add(t);
    }
    const sorted = [...times].sort((a, z) => a - z);
    const shots = new Map();
    for (const t of sorted) shots.set(t, await at(((t % setup.cyc) + setup.cyc) % setup.cyc));

    // Погашенное состояние каждого узла: полцикла в стороне от его
    // загорания там, где он заведомо не горит.
    const dark = [];
    for (const nd of NODES) {
      const t = ((nd.at * setup.run * setup.cyc + setup.cyc * 0.5) % setup.cyc + setup.cyc) % setup.cyc;
      dark.push(await at(t));
    }

    const out = [];
    for (let k = 0; k < NODES.length; k++) {
      const nd = NODES[k];
      const base = dark[k];
      const expect = nd.at * setup.run * setup.cyc;
      const frames = [];
      const mine = sorted.filter((t) => Math.abs(t - expect) <= HALF);
      for (const t of mine) {
        const png = shots.get(t);
        if (!png) continue;
        // Яркость видимого узла со стороны, куда капля ещё не дошла.
        const R = nd.r + 12;
        let nSum = 0, nN = 0;
        for (let y = Math.round(nd.cy - R); y <= Math.round(nd.cy + R); y++)
          for (let x = Math.round(nd.cx - R); x <= Math.round(nd.cx + R); x++) {
            if (Math.hypot(x - nd.cx, y - nd.cy) > R) continue;
            if (setup.horiz ? x < nd.cx + 2 : y < nd.cy + 2) continue;
            if (setup.horiz ? Math.abs(y - nd.cy) <= 3 : Math.abs(x - nd.cx) <= 3) continue;
            if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
            const o = (png.width * y + x) << 2;
            nSum += Math.abs(lum(png.data, o) - lum(base.data, o)); nN++;
          }
        // Профиль лишнего света вдоль дорожки, мимо дисков узлов.
        // Столбцы узлов выкидываются целиком, и с запасом на их
        // свечение: внутри кружка капля от загоревшегося узла уже
        // неотличима, а его ореол шире самого кружка и без запаса
        // перебивает пик капли — на телефоне, где узлы стоят вдвое
        // теснее, из-за этого прямая движения уезжала на 15 px.
        const prof = [];
        if (setup.horiz) {
          for (let x = BAND.x; x < BAND.x + BAND.w; x++) {
            if (NODES.some((q) => Math.abs(x - q.cx) < q.r + 18)) { prof.push(null); continue; }
            let s = 0;
            for (let y = Math.round(nd.cy - 26); y <= Math.round(nd.cy + 26); y++) {
              const o = (png.width * y + x) << 2;
              s += Math.max(0, Math.abs(lum(png.data, o) - lum(ref.data, o)));
            }
            prof.push({ pos: x, v: s });
          }
        } else {
          for (let y = BAND.y; y < BAND.y + BAND.h; y++) {
            if (NODES.some((q) => Math.abs(y - q.cy) < q.r + 18)) { prof.push(null); continue; }
            let s = 0;
            for (let x = Math.round(nd.cx - 26); x <= Math.round(nd.cx + 26); x++) {
              const o = (png.width * y + x) << 2;
              s += Math.max(0, Math.abs(lum(png.data, o) - lum(ref.data, o)));
            }
            prof.push({ pos: y, v: s });
          }
        }
        const real = prof.filter(Boolean);
        const peak = real.reduce((m, q) => (q.v > m.v ? q : m), { v: -1, pos: NaN });
        const thr = peak.v * 0.05;
        const ahead = real.filter((q) => q.v > thr);
        const edgeF = ahead.length ? Math.max(...ahead.map((q) => q.pos)) : NaN;
        const edgeB = ahead.length ? Math.min(...ahead.map((q) => q.pos)) : NaN;
        frames.push({ t, lit: nSum / nN, dot: peak.pos, edgeF, edgeB });
      }
      const near = frames.filter((f) => Math.abs(f.t - expect) <= FINE);
      const maxLit = Math.max(...near.map((f) => f.lit));
      const LIT_THRESHOLD = 2;
      const onset = near.find((f) => f.lit >= LIT_THRESHOLD);
      // Фон замера: насколько «яркость» гуляет там, где узел заведомо
      // погашен. Если это не заметно меньше порога, замеру грош цена.
      const quiet = near.filter((f) => f.t < expect - 260).map((f) => f.lit);
      const noise = quiet.length ? Math.max(...quiet) : NaN;
      const centre = setup.horiz ? nd.cx : nd.cy;

      // Кадры, где капля чиста от кружка и недалеко от него: по ним
      // строится прямая движения.
      // В подгонку идут только кадры, где капля далеко от ЛЮБОГО
      // узла: рядом с чужим светящимся узлом пик профиля — это его
      // ореол, а не капля.
      const clean = frames.filter((f) => Number.isFinite(f.dot) &&
        Math.abs(f.dot - centre) < 170 &&
        NODES.every((q) => Math.abs(f.dot - (setup.horiz ? q.cx : q.cy)) > q.r + 22));
      let speed = NaN, tCross = NaN;
      if (clean.length >= 6) {
        const n = clean.length;
        const mt = clean.reduce((a, f) => a + f.t, 0) / n;
        const md = clean.reduce((a, f) => a + f.dot, 0) / n;
        let num = 0, den = 0;
        for (const f of clean) { num += (f.t - mt) * (f.dot - md); den += (f.t - mt) ** 2; }
        speed = num / den;                       // px за мс
        tCross = mt + (centre - md) / speed;     // когда центр капли на центре кружка
      }
      // Видимый радиус капли: насколько её передний край опережает центр.
      const rad = clean.length
        ? clean.map((f) => Math.abs(f.edgeF - f.dot)).sort((a, z) => a - z)[clean.length >> 1]
        : NaN;

      out.push({
        k, expect, maxLit, speed, tCross, rad, noise,
        onsetT: onset ? onset.t : NaN,
        dt: onset ? onset.t - tCross : NaN,
        dpx: onset ? (onset.t - tCross) * speed : NaN,
        clean: clean.length,
      });
    }
    await c.close();

    if (!setup.nodes.length) {
      console.log('  УЗЛОВ НА СТРАНИЦЕ НЕТ — проба устарела, мерить нечего');
      bad++; continue;
    }
    const usable = out.filter((o) => Number.isFinite(o.dpx));
    const worst = usable.length ? usable.reduce((m, o) => (Math.abs(o.dpx) > Math.abs(m.dpx) ? o : m), usable[0]) : null;
    // Шум замера обязан быть заметно ниже порога загорания, иначе
    // «первый кадр, где стало светлее» — это просто дрожание кадра.
    const noisy = out.filter((o) => Number.isFinite(o.noise) && o.noise > 1);
    const ok = usable.length === out.length && !noisy.length &&
      usable.every((o) => Math.abs(o.dpx) <= 4);
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok ' : 'НЕТ'} ${name}, ${theme === 'dark' ? 'тёмная' : 'светлая'}: шаг пробы ${STEP_MS} мс, окно ±${HALF.toFixed(0)} мс, капля ${setup.ledSize} css-px`);
    for (const o of out) {
      if (!Number.isFinite(o.dpx)) {
        console.log(`      узел ${o.k + 1}: прямую движения построить не по чему (${o.clean} чистых кадров)`);
        continue;
      }
      console.log(`      узел ${o.k + 1}: центр капли на центре кружка в ${o.tCross.toFixed(0)} мс, узел стал светлее в ${o.onsetT.toFixed(0)} мс — ` +
        `разница ${o.dt >= 0 ? '+' : ''}${o.dt.toFixed(0)} мс = ${o.dpx >= 0 ? '+' : ''}${o.dpx.toFixed(1)} px хода`);
      console.log(`               скорость ${(o.speed * 1000).toFixed(0)} px/с, видимый радиус капли ${o.rad.toFixed(0)} px, ` +
        `${o.clean} чистых кадров, шум замера ${Number.isFinite(o.noise) ? o.noise.toFixed(2) : '—'} при пороге 2.00`);
    }
    if (noisy.length) console.log(`      ШУМ ЗАМЕРА ВЫШЕ ДОПУСТИМОГО у узлов ${noisy.map((o) => o.k + 1).join(', ')} — числам верить нельзя`);
    if (worst) console.log(`      наибольшее расхождение: ${worst.dpx >= 0 ? '+' : ''}${worst.dpx.toFixed(1)} px (плюс — узел загорелся позже прихода)`);
    for (const o of usable) {
      const key = `${w}:${o.k}`;
      const e = cross.get(key) || [];
      e.push({ theme, tCross: o.tCross, speed: o.speed });
      cross.set(key, e);
    }
  }
}
await b.close();

// Точность метода: насколько две темы расходятся в оценке ОДНОГО и
// того же момента при одинаковой геометрии.
let worstRepro = 0;
for (const [key, arr] of cross) {
  if (arr.length < 2) continue;
  const dt = Math.abs(arr[0].tCross - arr[1].tCross);
  const dpx = dt * ((arr[0].speed + arr[1].speed) / 2);
  if (dpx > worstRepro) worstRepro = dpx;
}
console.log(`\n  Воспроизводимость метода: одна и та же геометрия в двух темах даёт оценку` +
  ` прихода, расходящуюся до ${worstRepro.toFixed(1)} px. Расхождения меньше этого числа` +
  ` метод не различает — доли пикселя в строках выше в пределах его собственной погрешности.`);
console.log(bad ? '\nЗАГОРАНИЕ НЕ СОВПАДАЕТ С ПРИХОДОМ КАПЛИ' : '\nУзлы загораются в момент прихода капли');
process.exit(bad ? 1 : 0);
