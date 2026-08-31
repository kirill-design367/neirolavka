/**
 * Пузыри на WebGL: число, отклик на курсор, лопание, кадры и то,
 * что слой не мешает интерфейсу.
 *
 * Мерить пузыри на живой странице попиксельно нельзя: краска у них
 * бледная, а вокруг заголовок, плашки и карточки, и любое «самое
 * плотное пятно точек» оказывается сглаженной кромкой буквы. Первая
 * версия этой проверки так и попалась — она нашла «пятно» внутри
 * слова «Нейролавка» и потом три замера подряд выдавала БИТ В БИТ
 * одинаковые числа, потому что мерила неподвижный текст и была этим
 * довольна.
 *
 * Поэтому на время замера всё содержимое первого экрана, кроме
 * холста, прячется через visibility. Остаётся фон страницы и пузыри
 * на нём — и тогда маска краски это просто «отличие от фона».
 * Проверки, которым нужна настоящая страница (курсор, клики,
 * перекрытие интерфейса, кадры), идут по нетронутой разметке.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
if (!URL) {
  console.log('нужен адрес: node scripts/check-bubbles.mjs <url>');
  process.exit(1);
}

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHUNK = /_next\/static\/chunks\//;
/** Кусок с Three.js — самый тяжёлый на сайте. Следующий за ним
 *  собственный код страницы весит вдвое меньше. */
const BIG = 350_000;
let bad = 0;
const browser = await chromium.launch({ executablePath: EXE });

/** Маска краски: отличие от фона страницы. Работает только когда
 *  всё, кроме холста, спрятано, — иначе меряется не то. */
function inkMask(png, bg) {
  const { width: W, height: H, data } = png;
  const m = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const d = (Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2])) / 3;
    m[i] = d > 1.5 ? d : 0;
  }
  return m;
}

/** Плотные пятна точек, от самого плотного к менее плотным.
 *  Возвращается список, а не одно пятно: самое плотное место на
 *  экране — это часто ДВА наложившихся пузыря, и мерить на нём
 *  «раздулась ли оболочка» бессмысленно, потому что средний радиус
 *  там задаётся расстоянием между пятнами. Замер от этого гулял
 *  от 8 до 20 % на неизменной странице. Разбирать список должен
 *  вызывающий: он знает, какого размера пузырь бывает. */
function densestList(m, W, H, box) {
  const spots = [];
  for (let y = box; y < H - box; y += 8) {
    for (let x = box; x < W - box; x += 8) {
      let s = 0;
      for (let j = -box; j <= box; j += 3) {
        for (let i = -box; i <= box; i += 3) s += m[(y + j) * W + (x + i)];
      }
      if (s > 0) spots.push({ x, y, sum: s });
    }
  }
  spots.sort((a, b) => b.sum - a.sum);
  // Подавление соседей: два окна в двадцати пикселях — одно и то же пятно.
  const out = [];
  for (const sp of spots) {
    if (out.some((o) => Math.hypot(o.x - sp.x, o.y - sp.y) < box)) continue;
    out.push(sp);
    if (out.length >= 12) break;
  }
  return out;
}

/** Средний радиус краски ОДНОГО пятна вокруг его собственного центра
 *  тяжести.
 *
 *  Два уточнения, без которых мера врёт. Первое: центр берётся сам,
 *  а не задаётся, — пузырь всё время плывёт, и его сдвиг выдал бы
 *  себя за раздувание оболочки. Второе: окно сжимается вокруг
 *  найденного центра за три прохода. В широкое окно попадает соседний
 *  пузырь, и тогда меряется расстояние между двумя пятнами, а не
 *  размер одного: замер прыгал с 27 до 38 px на неизменной странице. */
function spread(m, W, H, cx0, cy0, box) {
  let mx = cx0;
  let my = cy0;
  let r = box / 2;
  let ink = 0;
  for (let pass = 0; pass < 3; pass++) {
    const lim = pass === 0 ? box : Math.min(box, r * 1.9);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    let num = 0;
    const from = Math.max(0, Math.floor(my - lim));
    const to = Math.min(H - 1, Math.ceil(my + lim));
    for (let y = from; y <= to; y++) {
      const xa = Math.max(0, Math.floor(mx - lim));
      const xb = Math.min(W - 1, Math.ceil(mx + lim));
      for (let x = xa; x <= xb; x++) {
        const v = m[y * W + x];
        if (!v) continue;
        const d = Math.hypot(x - mx, y - my);
        if (d > lim) continue;
        sx += v * x;
        sy += v * y;
        sw += v;
        num += v * d;
      }
    }
    if (!sw) return { r: 0, ink: 0, edge: 0, cx: mx, cy: my };
    mx = sx / sw;
    my = sy / sw;
    r = num / sw;
    ink = sw;
  }
  // Край пятна: девяносто пятый процентиль расстояния. Это и есть
  // видимый радиус пузыря — средний радиус вдвое меньше, потому что
  // краска у оболочки сгущается к силуэту.
  const ds = [];
  for (let y = Math.max(0, Math.floor(my - box)); y <= Math.min(H - 1, Math.ceil(my + box)); y++) {
    for (let x = Math.max(0, Math.floor(mx - box)); x <= Math.min(W - 1, Math.ceil(mx + box)); x++) {
      const v = m[y * W + x];
      if (!v) continue;
      const d = Math.hypot(x - mx, y - my);
      if (d <= r * 1.9) ds.push(d);
    }
  }
  ds.sort((a, b) => a - b);
  return { r, ink, edge: ds.length ? ds[Math.floor(ds.length * 0.95)] : r, cx: mx, cy: my };
}

for (const vp of [
  { name: 'десктоп', w: 1512, h: 900, lo: 10, hi: 12, mobile: false },
  { name: 'мобильная', w: 390, h: 844, lo: 6, hi: 7, mobile: true },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    locale: 'ru-RU',
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  // Отложенная загрузка. Считать любые куски бессмысленно: своя
  // разметка и своя логика грузятся сразу и должны. Смотрим на вес
  // и на МОМЕНТ: тяжёлый кусок обязан прийти только после первого
  // действия человека, а до него страницу ничто не должно тормозить.
  //
  // Вес берётся РАСПАКОВАННЫЙ, а не из content-length: сервер выдачи
  // сжимает, и заголовок показывает 140 КБ вместо 520. Проверка,
  // настроенная на несжатый размер, на сжатой выдаче объявляла, что
  // Three.js не загрузился вовсе.
  let touched = false;
  const bodies = [];
  page.on('response', (r) => {
    if (!CHUNK.test(r.url())) return;
    const when = touched;
    bodies.push(r.body().then((b) => ({ len: b.length, when })).catch(() => null));
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  const line = [];
  let vpBad = 0;
  const fail = (s) => { vpBad++; line.push('  НЕТ ' + s); };
  const ok = (s) => line.push('  ok  ' + s);

  const count = () => page.evaluate(() => {
    const c = document.querySelector('.bubbles');
    return c ? Number(c.dataset.bubbles ?? -1) : -1;
  });

  // До первого действия человека пузырей быть не должно вовсе.
  const idleCount = await count();

  // Действие: шевелим указателем. Дальше пузыри должны появиться.
  touched = true;
  await page.mouse.move(vp.w / 2, 140);
  await page.mouse.move(vp.w / 2 + 4, 144);
  await page.waitForTimeout(3200);

  const n0 = await count();
  if (n0 >= vp.lo && n0 <= vp.hi) ok(`пузырей ${n0}, допуск ${vp.lo}–${vp.hi}`);
  else fail(`пузырей ${n0}, ожидалось ${vp.lo}–${vp.hi}`);



  if (errors.length) fail(`ошибок в консоли: ${errors.length} — ${errors[0]}`);
  else ok('ошибок в консоли нет');

  // ─── Слой не ловит мышь ───────────────────────────────────
  const under = await page.evaluate(() => {
    let hits = 0;
    for (let y = 40; y < window.innerHeight - 10; y += 60) {
      for (let x = 20; x < window.innerWidth - 10; x += 60) {
        if (document.elementFromPoint(x, y)?.classList?.contains('bubbles')) hits++;
      }
    }
    return hits;
  });
  if (under === 0) ok('слой мышь не ловит: холст не оказался под курсором ни разу');
  else fail(`холст оказался под курсором ${under} раз`);

  const heroBox = await page.locator('.hero').boundingBox();
  const leadBox = await page.locator('.hero__lead').boundingBox();
  const bg = (await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim()))
    .match(/\d+/g).slice(0, 3).map(Number);

  /** Спрятать / вернуть всё содержимое первого экрана, кроме холста. */
  const bare = (on) => page.evaluate((v) => {
    let st = document.getElementById('bubble-probe');
    if (!st) { st = document.createElement('style'); st.id = 'bubble-probe'; document.head.appendChild(st); }
    st.textContent = v ? '.hero > *:not(canvas.bubbles){visibility:hidden!important}' : '';
  }, on);

  // Снимаем не элемент целиком, а ВИДИМУЮ его часть по прямоугольнику.
  // Съёмка элемента прокручивает страницу, если он выше окна, и тогда
  // координаты найденного пятна перестают совпадать с координатами
  // мыши. Плюс в кадр элемента попадают закреплённые соседи — липкая
  // шапка сверху и полоса заказа снизу: на телефоне «самым плотным
  // пятном точек» оказывалась именно полоса заказа, и замер выдавал
  // 29.9 → 30.0 на любом действии.
  const barBox = await page.locator('.bar').boundingBox().catch(() => null);
  const barH = barBox && barBox.y < vp.h ? vp.h - barBox.y + 8 : 0;
  // Прямоугольник берём у ХОЛСТА, а не у секции: холст выходит из
  // колонки влево до кромки окна, и по секции была бы видна только
  // часть поля.
  const cvBox = (await page.locator('.bubbles').boundingBox()) ?? heroBox;
  const cvLeft = Math.max(0, cvBox.x);
  const cvRight = Math.min(vp.w, cvBox.x + cvBox.width);
  const clip = {
    x: cvLeft,
    y: cvBox.y + 4,
    width: Math.max(80, cvRight - cvLeft),
    height: Math.max(120, Math.min(cvBox.height, vp.h - cvBox.y - barH) - 8),
  };
  /** Сдвиг от начала снимка к странице. */
  const OX = clip.x;
  const OY = clip.y;
  const shot = async () => PNG.sync.read(await page.screenshot({ clip }));

  // ─── Отклик на курсор ─────────────────────────────────────
  // Пятно ищем только в ВИДИМОЙ части первого экрана. На телефоне
  // первый экран выше окна, и Playwright, снимая элемент целиком,
  // прокручивает страницу — координаты пятна тогда перестают
  // совпадать с координатами мыши, и курсор уезжает мимо пузыря.
  // Так и вышло в первой версии: на десктопе отклик +27 %, на
  // телефоне ноль, хотя код один и тот же.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(heroBox.x + 6, heroBox.y + 40);
  await page.waitForTimeout(1400);
  await bare(true);

  const BOX = 60;
  // Берём не самое плотное пятно, а самое плотное ОДИНОЧНОЕ: край
  // пятна должен укладываться в наибольший радиус пузыря с запасом.
  // Наибольший радиус — 34 px на десктопе и 28 на телефоне; краска
  // выходит за него на размер точки и на мягкий край, отсюда запас.
  const maxEdge = vp.mobile ? 40 : 48;
  let spot = null;
  let png = await shot();
  // Пузыри плывут и временами наползают друг на друга. Если сейчас
  // одиночного нет — ждём и смотрим снова, а не объявляем поломку.
  for (let attempt = 0; attempt < 4 && !spot; attempt++) {
    if (attempt) { await page.waitForTimeout(1500); png = await shot(); }
    const pm = inkMask(png, bg);
    for (const cand of densestList(pm, png.width, png.height, 44)) {
      const st = spread(pm, png.width, png.height, cand.x, cand.y, BOX);
      if (st.ink > 0 && st.edge > 6 && st.edge <= maxEdge) { spot = { x: st.cx, y: st.cy }; break; }
    }
  }
  if (!spot) {
    fail('одиночного пузыря не нашлось за четыре попытки — либо их слишком много, либо они слиплись');
    spot = { x: png.width / 2, y: png.height / 2 };
  }

  const sample = async (n, cx, cy) => {
    let r = 0;
    let edge = 0;
    let x = cx;
    let y = cy;
    for (let i = 0; i < n; i++) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const p = await shot();
      const st = spread(inkMask(p, bg), p.width, p.height, Math.round(x), Math.round(y), BOX);
      r += st.r;
      edge += st.edge;
      x = st.cx; // окно едет за пузырём
      y = st.cy;
      await page.waitForTimeout(80);
    }
    return { r: r / n, edge: edge / n, x, y };
  };

  const calm = await sample(5, spot.x, spot.y);

  await bare(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(OX + calm.x, OY + calm.y);
  await page.waitForTimeout(900);

  // Прицеливаемся заново. Пузырь всё время плывёт, и за полторы
  // секунды ожидания уходит из-под курсора: отжим тогда получается
  // краевой, и замер гулял от 9 до 45 % на неизменной странице.
  await bare(true);
  const mid = await sample(2, calm.x, calm.y);
  await bare(false);
  await page.mouse.move(OX + mid.x, OY + mid.y);
  await page.waitForTimeout(700);
  await bare(true);
  const pressed = await sample(5, mid.x, mid.y);
  await bare(false);

  const grow = calm.r ? (pressed.r / calm.r - 1) * 100 : 0;
  const how = vp.mobile
    ? 'на указатель (на живом телефоне наведения нет, там это же движение запускает касание)'
    : 'на курсор';
  if (grow >= 12) ok(`оболочка отзывается ${how}: средний радиус краски ${calm.r.toFixed(1)} → ${pressed.r.toFixed(1)} px, +${grow.toFixed(0)} %`);
  else fail(`отклика ${how} не видно: ${calm.r.toFixed(1)} → ${pressed.r.toFixed(1)} px, +${grow.toFixed(0)} % при пороге 12 %`);

  // ─── Курсор-указатель над пузырём ─────────────────────────
  // Ищем точку внутри пятна, где под курсором именно секция: над
  // текстом и ссылками курсор свой, и подменять его нечем.
  let cursorSeen = vp.mobile ? 'нет наведения' : null;
  for (const [dx, dy] of vp.mobile ? [] : [[0, 0], [18, 0], [-18, 0], [0, 18], [0, -18], [13, 13], [-13, -13]]) {
    const cx = OX + pressed.x + dx;
    const cy = OY + pressed.y + dy;
    const isHero = await page.evaluate(([x, y]) =>
      document.elementFromPoint(x, y)?.classList?.contains('hero'), [cx, cy]);
    if (!isHero) continue;
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(140);
    cursorSeen = await page.evaluate(() => document.querySelector('.hero').style.cursor);
    if (cursorSeen === 'pointer') break;
  }
  if (cursorSeen === 'нет наведения') line.push('  —   сенсорный экран: наведения нет, курсор не проверяется');
  else if (cursorSeen === 'pointer') ok('над пузырём курсор становится указателем');
  else if (cursorSeen === null) line.push('  —   над пятном везде лежит текст, курсор не проверен');
  else fail(`над пузырём курсор «${cursorSeen || 'обычный'}», ожидался pointer`);

  // ─── Полоса подзаголовка чистая ───────────────────────────
  await page.mouse.move(heroBox.x + heroBox.width - 4, heroBox.y + heroBox.height + 200);
  await page.waitForTimeout(1200);
  await bare(true);
  const lp = await shot();
  const lm = inkMask(lp, bg);
  let dirty = 0;
  const y0 = Math.max(0, Math.round(leadBox.y - OY));
  const y1 = Math.min(lp.height, Math.round(leadBox.y + leadBox.height - OY));
  // Полоса — прямоугольник строк, а не вся ширина холста: холст шире
  // колонки, и слева и справа от текста пузырям плавать можно.
  const x0 = Math.max(0, Math.round(leadBox.x - OX));
  const x1 = Math.min(lp.width, Math.round(leadBox.x + leadBox.width - OX));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (lm[y * lp.width + x] > 0) dirty++;
  }
  await bare(false);
  const bandArea = Math.max(0, y1 - y0) * Math.max(0, x1 - x0);
  if (dirty === 0) ok(`полоса подзаголовка чиста: 0 окрашенных пикселей из ${bandArea}`);
  else fail(`в полосе подзаголовка ${dirty} окрашенных пикселей из ${bandArea}`);

  // ─── Лопание и возврат ────────────────────────────────────
  let popped = 0;
  let tries = 0;
  const step = vp.mobile ? 26 : 34;
  outer:
  for (let y = 30; y < Math.min(heroBox.height, vp.h) - 20; y += step) {
    for (let x = 20; x < heroBox.width - 20; x += step) {
      tries++;
      await page.mouse.click(heroBox.x + x, heroBox.y + y);
      await page.waitForTimeout(40);
      if ((await count()) < n0) { popped = tries; break outer; }
    }
  }
  if (popped) ok(`лопнул с ${popped}-й попытки`);
  else fail('пузырь не лопнул ни разу');

  await page.waitForTimeout(2400);
  const n1 = await count();
  if (n1 === n0) ok(`через 2.4 с снова ${n1}`);
  else fail(`после паузы пузырей ${n1}, было ${n0}`);

  // ─── Клик по ссылке ───────────────────────────────────────
  const chip = page.locator('.hero__chip').first();
  if (await chip.isVisible()) {
    const before = await count();
    await chip.click();
    await page.waitForTimeout(900);
    const after = await count();
    const scrolled = await page.evaluate(() => window.scrollY);
    if (after === before && scrolled > 40) ok(`клик по ссылке: пузырей ${before} → ${after}, прокрутка 0 → ${Math.round(scrolled)}`);
    else fail(`клик по ссылке: пузырей ${before} → ${after}, прокрутка ${Math.round(scrolled)}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
  } else {
    line.push('  —   чипов нет на этой ширине, перекрытие интерфейса проверено через elementFromPoint');
  }

  // ─── Кадры ────────────────────────────────────────────────
  const frames = await page.evaluate(() => new Promise((res) => {
    const t = [];
    let last = 0;
    const tick = (now) => {
      if (last) t.push(now - last);
      last = now;
      if (t.length < 240) requestAnimationFrame(tick);
      else res(t);
    };
    requestAnimationFrame(tick);
  }));
  const sorted = [...frames].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const slow = frames.filter((v) => v > 17).length;
  const fpsLine = `кадры: медиана ${med.toFixed(2)} мс (${(1000 / med).toFixed(1)} fps), 95-й ${p95.toFixed(2)} мс, дольше 17 мс — ${slow} из ${frames.length} (${(slow / frames.length * 100).toFixed(1)} %)`;
  if (slow / frames.length <= 0.05) ok(fpsLine);
  else fail(fpsLine);

  // ─── Отложенная загрузка ──────────────────────────────────
  const infos = (await Promise.all(bodies)).filter(Boolean);
  const biggest = infos.reduce((a, i) => Math.max(a, i.len), 0);
  const bigBefore = infos.filter((i) => i.len >= BIG && !i.when).length;
  const bigAfter = infos.filter((i) => i.len >= BIG && i.when).length;
  if (bigBefore === 0 && idleCount <= 0) ok('до первого действия человека Three.js не грузится и пузырей нет');
  else fail(`до первого действия загружено тяжёлых кусков ${bigBefore}, пузырей ${idleCount}`);
  if (bigAfter > 0) ok(`после действия Three.js пришёл: тяжёлых кусков ${bigAfter}, самый большой ${(biggest / 1024).toFixed(0)} КБ распакованных`);
  else fail('тяжёлого куска не пришло вовсе — Three.js не загрузился');

  console.log(`── ${vp.name} ${vp.w}×${vp.h} ──`);
  for (const l of line) console.log(l);
  console.log();
  bad += vpBad;
  await ctx.close();
}

// ─── Выключенное движение: холста нет вовсе ─────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, reducedMotion: 'reduce', locale: 'ru-RU' });
  const page = await ctx.newPage();
  const sizes = [];
  page.on('response', (r) => {
    if (CHUNK.test(r.url())) sizes.push(r.body().then((b) => b.length).catch(() => 0));
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.mouse.move(700, 200);
  await page.mouse.move(704, 204);
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(3000);
  const present = await page.evaluate(() => !!document.querySelector('.bubbles'));
  const big = (await Promise.all(sizes)).filter((n) => n >= BIG).length;
  console.log('── выключенное движение ──');
  if (!present && big === 0) console.log('  ok  даже после движения мышью и прокрутки холста нет, тяжёлый кусок не загружался');
  else {
    if (present) console.log('  НЕТ холст остался на странице');
    if (big) console.log(`  НЕТ тяжёлых кусков загружено: ${big}`);
    bad++;
  }
  console.log();
  await ctx.close();
}

await browser.close();
console.log(bad ? 'ПУЗЫРИ РАБОТАЮТ НЕ ТАК' : 'Пузыри держат число, отзываются на курсор, лопаются и интерфейсу не мешают');
process.exit(bad ? 1 : 0);
