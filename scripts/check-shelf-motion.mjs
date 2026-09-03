/**
 * Витрина: кромка холста теней и ряд кадров перехода между карточками.
 *
 * Две вещи, которые ломаются молча и обе видны только по пикселям.
 *
 * 1. Кромка холста. Холст теней лежит за карточками и обязан быть
 *    настолько больше блока, чтобы тень успела сойти на нет ВНУТРИ
 *    него. Если не успевает, под витриной появляется ровная прямая
 *    линия во всю ширину — глаз ловит её мгновенно, а все остальные
 *    проверки молчат: и контраст, и геометрия, и разрешения в порядке.
 *    Меряется вклад холста в картинку: два снимка, с холстом и без,
 *    и перепад этого вклада на последней строке, где он ещё заметен.
 *
 * 2. Переход между карточками. Должен читаться ОДНИМ движением.
 *    Признак двух движений виден в ряду кадров: скорость нарастает,
 *    проваливается и поднимается второй раз. Это и меряется — ПРОВАЛ
 *    между двумя горбами, в долях наибольшей скорости.
 *
 *    Меряется по СКОРОСТИ (расстояние, делённое на время кадра),
 *    а не по расстоянию за кадр. Это не педантизм: браузер здесь
 *    выдаёт кадры по 17–27 мс, и уронённый кадр удваивает пройденное
 *    за него расстояние. Ряд шагов от этого превращается в пилу,
 *    и мера, построенная на нём, меряет доставку кадров, а не
 *    движение. Скорость к длине кадра равнодушна.
 *
 *    Ряд скорости перед разбором сглаживается по трём кадрам:
 *    дрожание длины кадра ±5 мс на 20 мс — это ±25 % шума, из-за
 *    которого одиночный провал возникает на ровном месте.
 *
 *    Пик при этом искать не надо вовсе, и это главное. Прежняя мера
 *    брала «первый существенный пик» и считала подъёмы после него;
 *    на дрожащем ряду первым пиком оказывался случайный зубец
 *    в самом начале разгона, и остаток разгона до настоящего пика
 *    шёл в зачёт как «повторный». Отсюда и брались числа ×1.40–×2.25
 *    на ОДНОЙ И ТОЙ ЖЕ исправной сборке при пороге 1.25: порог лежал
 *    внутри собственного разброса меры, и вердикт был жребием.
 *    Проверка краснела на бегунке через раз при неизменном коде.
 *
 *    Нынешняя мера на десяти прогонах исправной сборки даёт 0.0–2.2 %,
 *    на прежних таймингах (0.95 с движения и 0.35 с задержки створки,
 *    то есть настоящий распад надвое) — 18.2–20.5 %, на ступенчатой
 *    кривой — 30.6–32.5 %. Порог 12 % лежит вчетверо выше шума
 *    и в полтора раза ниже поломки.
 *
 *    Скачок между соседними кадрами считается по тому же сглаженному
 *    ряду скорости и по той же причине. На исправной сборке 16–18 %
 *    (десять прогонов), на ступенчатой кривой 37–52 %. Прежняя
 *    запись, по расстоянию за кадр, давала 32–53 % на исправной
 *    сборке при пороге 45 % — то есть была таким же жребием.
 *
 *    Уронённые кадры больше не отбраковывают прогон. Обе меры к ним
 *    равнодушны по построению (восемь из десяти прогонов с числами
 *    0.0–2.2 % шли с уронёнными кадрами), а отбраковка сама была
 *    источником красноты: «меньше трёх чистых прогонов» на машине,
 *    где чистых почти не бывает. Сколько прогонов шло с уронёнными
 *    кадрами, проверка печатает — это сведения о машине, не вердикт.
 *
 * Парение карточек на время замера выключается: иначе меряется оно.
 *
 * Запуск: node scripts/check-shelf-motion.mjs http://localhost:4173/neirolavka/
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
if (!URL) {
  console.error('Укажите адрес: node scripts/check-shelf-motion.mjs <url>');
  process.exit(2);
}

/** Перепад вклада холста на кромке, уровней яркости на пиксель. */
const EDGE_MAX = 0.6;
/** Длина перехода, мс. Нижняя граница — чтобы проверка падала и тогда,
    когда переход исчез вовсе, а не только когда он растянулся. */
const DUR_MIN = 450;
const DUR_MAX = 800;
/** Кадров в переходе. Меньше — значит его почти нет. */
const FRAMES_MIN = 20;
/** Провал между горбами сглаженной скорости, доля наибольшей скорости.
    0 — скорость нарастает и падает одним горбом. */
const PROVAL_MAX = 0.12;
/** Скачок сглаженной скорости между соседними кадрами, доля наибольшей. */
const JERK_MAX = 0.28;

let bad = false;
const ok = (t) => console.log(`  ok   ${t}`);
const no = (t) => { bad = true; console.log(`  ПЛОХО ${t}`); };

const browser = await chromium.launch({
  executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'),
});

// ─── 1. Кромка холста теней ───────────────────────────────────────
console.log('\n── кромка холста теней ──');
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 }, locale: 'ru-RU' });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  // Пузыри лежат закреплённым холстом по всему окну и видны на любой
  // высоте прокрутки — в том числе за прозрачным блоком витрины.
  // Замер ниже вычитает два снимка друг из друга, и порог у него —
  // доли уровня на пиксель: между снимками пузыри проезжают, их дрейф
  // ложится на всю площадь кадра и записывается в счёт холсту теней.
  // Прячем на ВСЁ время замера, а не между снимками: иначе первый
  // снимок уже содержит краску, которой во втором не будет.
  await page.addStyleTag({ content: 'canvas.bubbles{display:none!important}' });
  // Сцена поднимается по первому действию человека — шевелим мышью.
  await page.mouse.move(300, 300);
  await page.mouse.move(304, 304);
  await page.evaluate(() => document.querySelector('.shop')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(2200);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '.pcard{animation:none!important}';
    document.head.appendChild(st);
  });
  await page.waitForTimeout(400);

  const live = await page.evaluate(() => !!document.querySelector('.shelf3d[data-3d]'));
  if (!live) {
    no(`${theme}: сцена не поднялась — мерить нечего`);
    await ctx.close();
    continue;
  }

  const g = await page.evaluate(() => {
    const r = document.querySelector('.shelf3d').getBoundingClientRect();
    return [r.x, r.y, r.width, r.height].map(Math.round);
  });
  // Запас кадра ЗАВЕДОМО больше запаса холста: иначе за кромку
  // холста принимается кромка снимка, и проверка врёт в свою пользу.
  const pad = 110;
  const clip = {
    x: Math.max(0, g[0] - pad),
    y: Math.max(0, g[1] - pad),
    width: Math.min(1400 - Math.max(0, g[0] - pad), g[2] + pad * 2),
    height: Math.min(1200 - Math.max(0, g[1] - pad), g[3] + pad * 2),
  };
  const on = PNG.sync.read(await page.screenshot({ clip }));
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '.shelf3d__gl{display:none!important}';
    document.head.appendChild(st);
  });
  await page.waitForTimeout(300);
  const off = PNG.sync.read(await page.screenshot({ clip }));

  const W = on.width, H = on.height;
  const d = (i) =>
    Math.abs(on.data[i] - off.data[i]) +
    Math.abs(on.data[i + 1] - off.data[i + 1]) +
    Math.abs(on.data[i + 2] - off.data[i + 2]);
  const rows = new Array(H).fill(0);
  const cols = new Array(W).fill(0);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = d((y * W + x) * 4);
      rows[y] += v;
      cols[x] += v;
    }
  const perRow = rows.map((v) => v / W);
  const perCol = cols.map((v) => v / H);
  const seen = perRow.reduce((a, v) => a + v, 0);
  if (seen < 1) {
    no(`${theme}: холст не рисует ничего — проверка стала пустой`);
    await ctx.close();
    continue;
  }
  const lastRow = perRow.reduce((acc, v, y) => (v > 0.6 ? y : acc), -1);
  const firstCol = perCol.findIndex((v) => v > 0.6);
  const lastCol = perCol.reduce((acc, v, x) => (v > 0.6 ? x : acc), -1);
  const stepBottom = Math.abs(perRow[lastRow] - (perRow[lastRow + 1] ?? 0));
  const stepLeft = Math.abs(perCol[firstCol] - (perCol[firstCol - 1] ?? 0));
  const stepRight = Math.abs(perCol[lastCol] - (perCol[lastCol + 1] ?? 0));

  if (lastRow >= H - 2) {
    no(`${theme}: тень доходит до нижней кромки СНИМКА — запас кадра мал, число ниже не значит ничего`);
  }
  const worst = Math.max(stepBottom, stepLeft, stepRight);
  const line = `${theme}: перепад вклада холста — низ ${stepBottom.toFixed(2)}, слева ${stepLeft.toFixed(2)}, справа ${stepRight.toFixed(2)} уровня на пиксель при пороге ${EDGE_MAX}`;
  worst <= EDGE_MAX ? ok(line) : no(line);
  await ctx.close();
}

// ─── 2. Ряд кадров перехода ───────────────────────────────────────
console.log('\n── переход между карточками ──');
{
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.addStyleTag({ content: '.pcard{animation:none!important}' });
  await page.mouse.move(300, 300);
  await page.mouse.move(304, 304);
  await page.evaluate(() => document.querySelector('.shop')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(2500);
  await page.mouse.move(20, 20);
  await page.waitForTimeout(1200);

  const runs = [];
  for (let k = 0; k < 5; k++) {
    const series = await page.evaluate(async (i) => {
      const cards = [...document.querySelectorAll('.pcard')];
      const cur = cards.findIndex((e) => e.classList.contains('pcard--active'));
      const pick = (cur + 1 + (i % (cards.length - 1))) % cards.length;
      const snap = () =>
        cards.flatMap((e) => {
          const r = e.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        });
      const frames = [];
      let stop = false;
      const t0 = performance.now();
      const tick = () => {
        frames.push({ t: performance.now() - t0, v: snap() });
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      await new Promise((r) => setTimeout(r, 16));
      cards[pick].querySelector('.pcard__face')?.click();
      await new Promise((r) => setTimeout(r, 2600));
      stop = true;
      return frames;
    }, k);

    const steps = [];
    for (let i = 1; i < series.length; i++) {
      let s = 0;
      for (let j = 0; j < series[i].v.length; j++) s += Math.abs(series[i].v[j] - series[i - 1].v[j]);
      steps.push({ t: series[i].t, dt: series[i].t - series[i - 1].t, d: s });
    }
    const EPS = 0.35;
    const first = steps.findIndex((s) => s.d > EPS);
    let last = -1;
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].d > EPS) { last = i; break; }
    if (first < 0) { runs.push(null); await page.waitForTimeout(900); continue; }
    const live = steps.slice(first, last + 1);
    const ms = live[live.length - 1].t - steps[first].t + live[0].dt;

    // Скорость, а не расстояние за кадр: см. шапку файла.
    const v = live.map((s) => s.d / s.dt);
    // Сглаживание по трём кадрам — тоже см. шапку.
    const sm = v.map((_, i) => {
      const a = v[Math.max(0, i - 1)], b = v[i], c = v[Math.min(v.length - 1, i + 1)];
      return (a + b + c) / 3;
    });
    const peak = Math.max(...sm);

    // Провал между двумя горбами. Для каждого кадра берём наибольшую
    // скорость слева от него и наибольшую справа; насколько кадр ниже
    // меньшей из них — это и есть глубина ямы, в которую движение
    // проваливается между двумя подъёмами. У движения одним горбом
    // такой ямы нет вовсе: слева от вершины меньше левый максимум,
    // справа — правый, и разность всюду нулевая.
    const L = [], R = [];
    { let m = -Infinity; for (let i = 0; i < sm.length; i++) { m = Math.max(m, sm[i]); L[i] = m; } }
    { let m = -Infinity; for (let i = sm.length - 1; i >= 0; i--) { m = Math.max(m, sm[i]); R[i] = m; } }
    let proval = 0;
    for (let i = 0; i < sm.length; i++) proval = Math.max(proval, (Math.min(L[i], R[i]) - sm[i]) / peak);

    let jerk = 0;
    for (let i = 1; i < sm.length; i++) jerk = Math.max(jerk, Math.abs(sm[i] - sm[i - 1]));

    // Уронённые кадры прогон больше не отбраковывают — обе меры к ним
    // равнодушны. Число таких прогонов печатается как сведения
    // о машине.
    const dropped = live.some((s) => s.dt > 25);
    runs.push({ frames: live.length, ms, proval, jerk: jerk / peak, dropped });
    await page.waitForTimeout(900);
  }
  await ctx.close();

  const good = runs.filter(Boolean);
  console.log(
    `  прогонов ${runs.length}, движение поймано в ${good.length}` +
    `, из них с уронёнными кадрами ${good.filter((r) => r.dropped).length}`
  );
  if (good.length < 3) {
    no('меньше трёх прогонов с движением — вердикт ставить не на чем');
  } else {
    const mid = (k) => {
      const v = good.map((r) => r[k]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    const ms = mid('ms'), frames = mid('frames'), proval = mid('proval'), jerk = mid('jerk');
    const l1 = `длина перехода ${ms.toFixed(0)} мс при коридоре ${DUR_MIN}–${DUR_MAX}, кадров ${frames}`;
    ms >= DUR_MIN && ms <= DUR_MAX && frames >= FRAMES_MIN ? ok(l1) : no(l1);
    const l2 = `провал между горбами скорости ${(proval * 100).toFixed(1)} % при пороге ${(PROVAL_MAX * 100).toFixed(0)} % — переход читается одним движением`;
    proval <= PROVAL_MAX ? ok(l2) : no(l2);
    const l3 = `наибольший скачок скорости ${(jerk * 100).toFixed(0)} % от наибольшей при пороге ${(JERK_MAX * 100).toFixed(0)} %`;
    jerk <= JERK_MAX ? ok(l3) : no(l3);
  }
}

await browser.close();
console.log(bad ? '\nВитрина: есть к чему придраться' : '\nВитрина: кромка холста чистая, переход одним движением');
process.exit(bad ? 1 : 0);
