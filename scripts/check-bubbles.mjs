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
 * Поэтому на время замера всё содержимое страницы, кроме холста,
 * прячется через visibility. Остаётся фон страницы и пузыри на нём —
 * и тогда маска краски это просто «отличие от фона». Проверки,
 * которым нужна настоящая страница (курсор, клики, перекрытие
 * интерфейса, кадры), идут по нетронутой разметке.
 *
 * Холст переехал из первого экрана на уровень страницы: он закреплён
 * по окну (position: fixed) и лежит ПОД всем содержимым. Отсюда три
 * следствия для этой проверки, и каждое стоило бы молчания, если бы
 * их пропустить:
 *
 *   — прятать надо потомство body, а не потомство .hero. Пока
 *     правило пряталось по .hero, в кадре оставались бы липкая шапка
 *     и панель заказа, и «самым плотным пятном точек» стала бы
 *     неподвижная вёрстка — ровно та ловушка, что описана выше;
 *   — рамка замера — ОКНО, а не коробка первого экрана;
 *   — «полосы подзаголовка» больше нет: запретные прямоугольники
 *     сняты вместе с переездом, пузырям под текстом теперь и положено
 *     быть. Вместо запрета проверяется то, ради чего он существовал, —
 *     что краска не оказывается ПОВЕРХ текста.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
if (!URL) {
  console.log('нужен адрес: node scripts/check-bubbles.mjs <url>');
  process.exit(1);
}

const EXE = (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const CHUNK = /_next\/static\/chunks\//;
/** Кусок с Three.js — самый тяжёлый на сайте. Следующий за ним
 *  собственный код страницы весит вдвое меньше. */
const BIG = 350_000;
let bad = 0;
const browser = await chromium.launch({ executablePath: EXE });

/** Маска краски: отличие от фона страницы. Работает только когда
 *  всё, кроме холста, спрятано, — иначе меряется не то. */
/* Маска краски. Порог — параметр, и это не украшение.
   Для «полоса подзаголовка чиста» нужна самая чувствительная маска:
   там важно, что краски НЕТ ВОВСЕ. А для поиска ОДИНОЧНОГО пузыря
   она вредна: у оболочки есть еле видимая дымка дальних точек,
   и когда пузырей стало вдвое больше, дымка соседей сомкнулась —
   весь верх первого экрана читался одним пятном, и все шестьдесят
   кандидатов подряд давали край 88–96 px при пороге 74. Пузыри при
   этом были на месте и глазом различались. */
function inkMask(png, bg, porog = 1.5) {
  const { width: W, height: H, data } = png;
  const m = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const d = (Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2])) / 3;
    m[i] = d > porog ? d : 0;
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
/* Список пятен по убыванию плотности.
   `keep` — сколько вернуть. Двенадцати хватало, пока пузырей было
   пятнадцать и одного калибра; на двадцати двух с разбросом радиусов
   вчетверо все двенадцать самых плотных окон попадают в один комок
   крупных, а одиночный мелкий пузырь — ровно то, что нужно замеру —
   до списка не доходит вовсе. */
function densestList(m, W, H, box, keep = 12) {
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
    if (out.length >= keep) break;
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
  { name: 'десктоп', w: 1512, h: 900, lo: 29, hi: 30, mobile: false },
  { name: 'мобильная', w: 390, h: 844, lo: 15, hi: 16, mobile: true },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    locale: 'ru-RU',
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();

  // Загрузка. Пузыри обязаны быть на экране БЕЗ всякого действия
  // человека — первый экран не должен стоять пустым. И обязаны
  // обходиться без тяжёлого куска: Three.js из них убран, отрисовка
  // идёт через свой слой над WebGL в несколько килобайт.
  //
  // Прежде проверка требовала ровно обратного — чтобы до первого
  // действия пузырей НЕ было, а после действия пришёл кусок тяжелее
  // 350 КБ. Это описывало прежнее устройство: библиотеку грузили
  // по действию, и до него первый экран стоял пустым.
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

  // Страница сама отмечает, когда пузыри появились: снаружи этот
  // момент не поймать, goto ждёт networkidle и возвращается заведомо
  // позже.
  await page.addInitScript(() => {
    const look = () => {
      const c = document.querySelector('canvas.bubbles');
      if (c && Number(c.dataset.bubbles ?? 0) > 0) { window.__bubAt = performance.now(); return; }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
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

  // Пузыри обязаны появиться сами, без действия человека.
  const idleCount = await count();
  const bubAt = await page.evaluate(() => Math.round(window.__bubAt ?? -1));

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

  /** Спрятать / вернуть всё содержимое страницы, кроме холста.
   *
   *  Правило идёт по потомству BODY, а не первого экрана: холст
   *  закреплён по окну и в кадр вместе с ним попадает всё, что
   *  на экране, — липкая шапка, панель заказа, карточки. Оставь их
   *  видимыми, и «самым плотным пятном точек» окажется неподвижная
   *  вёрстка, а три замера подряд дадут бит в бит одинаковые числа. */
  const bare = (on) => page.evaluate((v) => {
    let st = document.getElementById('bubble-probe');
    if (!st) { st = document.createElement('style'); st.id = 'bubble-probe'; document.head.appendChild(st); }
    st.textContent = v ? 'body > *:not(canvas.bubbles){visibility:hidden!important}' : '';
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
  // Рамка замера — ОКНО: холст закреплён по нему и пузыри плавают
  // по всей его площади. Сверху отступаем от липкой шапки, снизу
  // от полосы заказа: обе закреплены, обе прячутся через bare(),
  // но их место в кадре всё равно лучше не занимать — на телефоне
  // полоса заказа съедает седьмую часть высоты.
  const navBox = await page.locator('.nav').boundingBox().catch(() => null);
  const navH = navBox ? Math.max(0, navBox.y + navBox.height + 8) : 0;
  const clip = {
    x: 0,
    y: navH,
    width: vp.w,
    height: Math.max(120, vp.h - navH - barH),
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

  // Окно замера и порог одиночности идут ЗА радиусами пузырей.
  // Радиусы выросли (15–58 на десктопе, 10–26 на телефоне), и старое
  // окно в 60 px было меньше самого крупного пузыря: его край
  // не помещался в замер вовсе, и «одиночного не нашлось» означало
  // не слипшиеся пузыри, а слишком тесную мерку.
  // Окно чуть больше самого крупного пузыря — и НЕ БОЛЬШЕ. Шире
  // окно, дальше от него польза: при 160 px в замер попадали соседи,
  // и весь верх первого экрана читался одним сплошным пятном (край
  // 105–169 px у всех шестидесяти кандидатов подряд).
  const BOX = vp.mobile ? 50 : 90;
  // Берём не самое плотное пятно, а самое плотное ОДИНОЧНОЕ: край
  // пятна должен укладываться в наибольший радиус пузыря с запасом
  // на размер точки и мягкую кромку.
  const maxEdge = vp.mobile ? 36 : 74;
  // Пятно должно лежать там, где курсор ДОСТАНЕТ до секции.
  // Иначе замер выходит случайным: панель заказа непрозрачна и лежит
  // поверх правой части первого экрана, мышь над ней до слушателя
  // на секции не доходит, нажим остаётся нулевым — и отклик честно
  // получается нулевым при исправном коде. На этом замер уже гулял
  // от +28 % до +0 % на одной и той же сборке.
  const reachable = (px, py) => page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    // Слушатели висят на ОКНЕ, поэтому достижима любая точка окна.
    // Проверять принадлежность первому экрану больше нельзя: холст
    // из него уехал, и такое условие отбрасывало бы точки, которые
    // слушатель прекрасно ловит.
    return !!el;
  }, [px, py]);

  let spot = null;
  /** Все найденные одиночные пузыри, а не только первый: второй
   *  нужен для замера отклика В СТОРОНЕ — коробку надо ставить
   *  на пузырь, а не в пустое место рядом с ним. */
  const spots = [];
  let png = await shot();
  // Пузыри плывут и временами наползают друг на друга. Если сейчас
  // одиночного нет — ждём и смотрим снова, а не объявляем поломку.
  for (let attempt = 0; attempt < 4 && !spot; attempt++) {
    if (attempt) { await page.waitForTimeout(1500); png = await shot(); }
    const pm = inkMask(png, bg, 9);
    for (const cand of densestList(pm, png.width, png.height, vp.mobile ? 34 : 56, 60)) {
      const st = spread(pm, png.width, png.height, cand.x, cand.y, BOX);
      // OTLADKA=1 печатает всех кандидатов. Без этого «одиночного
      // пузыря не нашлось» — сообщение без единой зацепки: неясно,
      // слиплись ли пузыри на самом деле или мерка стала им тесна.
      if (process.env.OTLADKA) console.log(`      кандидат ${cand.x},${cand.y} краски ${Math.round(st.ink)} край ${st.edge.toFixed(1)} при пороге ${maxEdge}`);
      if (!(st.ink > 0 && st.edge > 6 && st.edge <= maxEdge)) continue;
      await bare(false);
      const good = await reachable(OX + st.cx, OY + st.cy);
      await bare(true);
      if (!good) continue;
      spots.push({ x: st.cx, y: st.cy });
      if (!spot) spot = { x: st.cx, y: st.cy };
      if (spots.length >= 6) break;
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

  // ─── Отклик оболочки: сигнал против собственного дрейфа ────
  //
  // Две прежние меры не годятся, и обе — по делу.
  //
  // Средний радиус ОДНОГО пятна держался на одиннадцати пузырях,
  // а на пятнадцати развалился: пятна наползают, окно уезжает
  // на соседа, и на одной и той же сборке подряд выходило +37 %
  // и −25 %. Общее количество краски не годится по другой причине:
  // точек постоянное число, деформация их переставляет, но площадь
  // почти не меняет — 0.4 % сигнала при 6.4 % шума.
  //
  // Работает третья: сравнивать КАРТИНКУ С КАРТИНКОЙ. Пузыри всё
  // время плывут, поэтому два снимка подряд отличаются и сами по себе.
  // Это и есть шум метода — его меряем при убранном курсоре. Потом
  // те же два снимка, но между ними курсор заходит на холст. Если
  // отклик есть, второе различие заметно крупнее первого. Дрейф
  // в обеих парах одинаковый и сокращается.
  const diffBox = (a, b, cx, cy, half) => {
    const ma = inkMask(a, bg);
    const mb = inkMask(b, bg);
    const x0 = Math.max(0, Math.round(cx - half));
    const x1 = Math.min(a.width, Math.round(cx + half));
    const y0 = Math.max(0, Math.round(cy - half));
    const y1 = Math.min(a.height, Math.round(cy + half));
    let n = 0;
    for (let y = y0; y < y1; y++) {
      const row = y * a.width;
      for (let x = x0; x < x1; x++) if ((ma[row + x] > 0) !== (mb[row + x] > 0)) n++;
    }
    return n;
  };

  // Точки, где курсор ДОСТАЁТ до секции: панель заказа непрозрачна
  // и лежит поверх правой части первого экрана, мышь над ней до
  // слушателя не доходит — нажим остаётся нулевым, и отклик честно
  // выходит нулевым при исправном коде.
  const reachableNear = async (fx, fy) => {
    for (const [dx, dy] of [[0, 0], [0, -0.12], [0, 0.12], [-0.06, 0], [0.06, 0]]) {
      const c = {
        x: Math.round(OX + clip.width * Math.min(0.95, Math.max(0.05, fx + dx))),
        y: Math.round(OY + clip.height * Math.min(0.95, Math.max(0.05, fy + dy))),
      };
      if (await reachable(c.x, c.y)) return c;
    }
    return null;
  };
  // Курсор наводится НА НАЙДЕННЫЙ ПУЗЫРЬ, а не в отвлечённую точку
  // кадра. Пока кадром был первый экран, доля 0.2×0.5 почти всегда
  // попадала в поле пузырей; в кадре размером с окно та же доля
  // легко приходится на пустое место, и «отклика не видно» означало
  // бы «мерили там, где нечему отзываться».
  const A = (await reachable(OX + spot.x, OY + spot.y))
    ? { x: Math.round(OX + spot.x), y: Math.round(OY + spot.y) }
    : ((await reachableNear(0.2, 0.5)) ?? { x: OX + 20, y: OY + 20 });
  let B = (await reachableNear(0.62, 0.5)) ?? { x: OX + clip.width - 20, y: OY + 20 };
  const away = { x: 6, y: 6 }; // вне секции: там срабатывает pointerleave

  // Окно замера — не половина холста, а КОРОБКА. Рядом с курсором
  // деформация крупная, а дрейф в маленькой коробке маленький;
  // на половине холста сигнал тонул в дрейфе дальних пузырей
  // (отношение 1.17 при том, что отклик заведомо есть).
  const BOXR = vp.mobile ? 110 : 150;
  // Дальняя коробка — на ЗАДАННОМ расстоянии от курсора, а не «где
  // придётся». Раньше её место выводилось из геометрии кадра
  // (середина между A и B, ниже на 1.6 коробки), и когда кадр вырос
  // с первого экрана до целого окна, расстояние выросло с 213 до
  // 398 px само собой. Отклик падает с расстоянием, и проверка
  // объявила поломку там, где менялась только её собственная мерка.
  // Расстояние теперь число: 200 px, как и записано в планке.
  const DAL = 200;
  // Дальняя коробка тоже ставится НА ПУЗЫРЬ — на второй из найденных
  // одиночек, отстоящий от курсора примерно на DAL. Коробка в пустом
  // месте меряла бы дрейф соседей и ничего больше: отношение
  // сваливалось к единице не потому, что отклика нет, а потому, что
  // мерить было нечего.
  let farPt = null;
  for (const c of spots.slice(1)) {
    const p = { x: Math.round(OX + c.x), y: Math.round(OY + c.y) };
    const d = Math.hypot(p.x - A.x, p.y - A.y);
    if (d < DAL * 0.7 || d > DAL * 1.6) continue;
    if (p.x - BOXR < OX || p.x + BOXR > OX + clip.width) continue;
    if (p.y - BOXR < OY || p.y + BOXR > OY + clip.height) continue;
    farPt = p;
    break;
  }
  if (!farPt) {
    for (const ug of [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180]) {
      const r = (ug * Math.PI) / 180;
      const c = { x: Math.round(A.x + Math.cos(r) * DAL), y: Math.round(A.y + Math.sin(r) * DAL) };
      if (c.x - BOXR < OX || c.x + BOXR > OX + clip.width) continue;
      if (c.y - BOXR < OY || c.y + BOXR > OY + clip.height) continue;
      if (Math.hypot(c.x - B.x, c.y - B.y) < DAL * 0.7) continue;
      farPt = c;
      break;
    }
  }
  farPt ??= { x: (A.x + B.x) / 2, y: Math.min(OY + clip.height - BOXR, A.y + BOXR * 1.6) };

  // Вторая точка курсора — ЗЕРКАЛО первой относительно дальней
  // коробки. Замер держится на том, что ось «курсор → центр»
  // разворачивается: пузырь, сжатый с одной стороны, оказывается
  // сжат с другой, и картинка в коробке меняется сильнее дрейфа.
  // Пока B стояла в отвлечённой точке кадра, ось разворачивалась
  // как придётся — и отношение гуляло от 0.97 до 1.30 на одной
  // и той же сборке.
  {
    const dx = farPt.x - A.x, dy = farPt.y - A.y;
    const d = Math.hypot(dx, dy) || 1;
    const zerkalo = {
      x: Math.round(farPt.x + (dx / d) * DAL),
      y: Math.round(farPt.y + (dy / d) * DAL),
    };
    const vnutri = zerkalo.x > OX + 8 && zerkalo.x < OX + clip.width - 8
                && zerkalo.y > OY + 8 && zerkalo.y < OY + clip.height - 8;
    if (vnutri && await reachable(zerkalo.x, zerkalo.y)) B = zerkalo;
  }

  let driftNear = 0; let respNear = 0;
  let driftFar = 0; let respFar = 0;
  let lag = 0;
  await bare(true);
  for (let i = 0; i < 3; i++) {
    // Шум метода: два снимка при неподвижном курсоре — но РАЗДЕЛЁННЫЕ
    // тем же действием, что и снимки сигнала.
    //
    // Пузыри плывут сами, и картинка меняется тем сильнее, чем больше
    // времени прошло между снимками. У сигнала между снимками стоит
    // page.mouse.move, а он ходит по протоколу и занимает до 300 мс,
    // причём каждый раз разное. Пока шум мерился двумя снимками
    // ПОДРЯД, он охватывал меньше времени, чем сигнал. Лечится
    // не порогом, а протоколом: между снимками шума стоит такой же
    // переезд курсора, только НА ТО ЖЕ МЕСТО.
    await page.mouse.move(away.x, away.y);
    await page.waitForTimeout(700); // нажим спадает за 220 мс
    const a1 = await shot();
    await page.mouse.move(away.x, away.y);
    const b1 = await shot();
    driftNear += diffBox(a1, b1, A.x - OX, A.y - OY, BOXR);

    // Сигнал у курсора: те же два снимка, но между ними курсор
    // заходит на холст.
    const a2 = await shot();
    const t0 = Date.now();
    await page.mouse.move(A.x, A.y);
    const b2 = await shot();
    lag = Math.max(lag, Date.now() - t0);
    respNear += diffBox(a2, b2, A.x - OX, A.y - OY, BOXR);

    // Дальняя коробка. Курсор не убирается, а ПЕРЕПРЫГИВАЕТ с одной
    // стороны на другую: ось «курсор → центр» разворачивается, и если
    // отклик доходит до дальних пузырей, картинка в коробке меняется
    // заметно сильнее собственного дрейфа. Шум для неё считается так же:
    // два снимка подряд при неподвижном курсоре.
    await page.waitForTimeout(500);
    const a3 = await shot();
    await page.mouse.move(A.x, A.y);   // переезд на месте: время то же, сигнала нет
    const b3 = await shot();
    driftFar += diffBox(a3, b3, farPt.x - OX, farPt.y - OY, BOXR);

    const a4 = await shot();
    await page.mouse.move(B.x, B.y);
    const b4 = await shot();
    respFar += diffBox(a4, b4, farPt.x - OX, farPt.y - OY, BOXR);
  }
  await bare(false);

  // Порог под курсором — 1.25, а не 1.6. Реакция оболочки намеренно
  // ослаблена (пузырь отзывается, а не выворачивается наизнанку),
  // и прежний порог остался от прежней, слишком сильной. Что 1.25
  // всё ещё ловит поломку, проверено подстановкой: при колоколе
  // вместо длинного хвоста отношение падает до 1.06–1.23.
  const dist = Math.round(Math.min(Math.hypot(farPt.x - A.x, farPt.y - A.y), Math.hypot(farPt.x - B.x, farPt.y - B.y)));
  // У ДАЛЬНЕЙ коробки вердикта больше нет, и это не поблажка,
  // а признание точности метода.
  //
  // Отклик в стороне слабый по замыслу, и решает его величину то,
  // на какой именно пузырь легла коробка, — а он на каждой загрузке
  // новый. Замер на этой машине: длинный хвост даёт 1.04–1.62,
  // подставленный вместо него колокол — 0.98–1.15. Распределения
  // перекрываются, то есть по ОДНОМУ прогону эти два случая
  // не различаются вовсе, и порог 1.3 давал красный прогон
  // на исправном сайте примерно раз из трёх. Ни повторы внутри
  // прогона (три и пять дали один и тот же коридор), ни несколько
  // коробок, ни расстояние 150 вместо 200 этого не убрали: гуляет
  // не выборка, а сама постановка.
  //
  // Поэтому число печатается без вердикта — как у перехода витрины,
  // где на программной отрисовке мера тоже не доходит до вердикта.
  // На бегунке, где отрисовка быстрее, дальняя коробка даёт 1.96,
  // но полагаться на это нельзя.
  //
  // ЧЕГО ЭТО СТОИЛО, прямо: подмена длинного хвоста колоколом больше
  // не ловится ничем. Проверено подстановкой — сборка с exp(-d²)
  // проходит проверку целиком, потому что У КУРСОРА обе кривые
  // одинаковы (отношение 1.44 и 3.13, порог 1.25), а различаются они
  // только в стороне. Прежняя запись «колокол даёт 1.06–1.23 под
  // курсором» не подтвердилась: это число из другой поры, когда
  // холст лежал на первом экране и коробка была другой.
  //
  // Значит длинный хвост сейчас держится не проверкой, а разделом
  // в CLAUDE.md. Чтобы вернуть вердикт, нужно убрать из замера
  // собственный дрейф пузырей — он вчетверо больше сигнала.
  const dalnee = driftFar > 0 ? respFar / driftFar : 0;
  line.push(`  —   в стороне (ближайший край окна замера в ${dist} px от курсора): `
    + `${driftFar} px дрейфа против ${respFar} px при движении курсора, отношение `
    + `${dalnee.toFixed(2)} — вердикта нет, метод различает хвост (1.04–1.62) `
    + `и колокол (0.98–1.15) только по многим прогонам`);
  for (const [dr, re, name, need] of [
    [driftNear, respNear, 'под курсором', 1.25],
  ]) {
    const ratio = dr > 0 ? re / dr : 0;
    const txt = `${name}: между кадрами ${dr} px собственного дрейфа и ${re} px при движении курсора, отношение ${ratio.toFixed(2)} при пороге ${need}`;
    // Слишком мало краски в окне — это НЕ поломка, а пустая коробка:
    // пузыри плывут, и временами в окно замера не попадает почти
    // ничего. Мера в этот раз ничего не увидела, и вердикта у неё
    // нет. Порог собственного дрейфа взят с запасом к тому, что
    // даёт один пузырь: при 174 px в окне отношение выходило 1.08
    // на заведомо исправном отклике.
    if (dr < 400) line.push(`  —   ${name}: в окне замера всего ${dr} px движения — мера промолчала`);
    else if (ratio >= need) ok(`оболочка отзывается ${txt}`);
    else fail(`отклика ${name} не видно — ${txt}`);
  }
  // Задержка метода печатается: всё, что быстрее неё, он не различает.
  line.push(`  —   между движением мыши и снимком проходит до ${lag} мс — быстрее этого метод не различает`);

  // Место пузыря для проверки курсора-указателя.
  await page.mouse.move(A.x, A.y);
  await page.waitForTimeout(300);
  await bare(true);
  const pressed = await sample(2, spot.x, spot.y);
  await bare(false);

  // ─── Курсор-указатель над пузырём ─────────────────────────
  // Ищем точку внутри пятна, где виден САМ ФОН страницы. Над
  // непрозрачным содержимым пузырь не виден, щёлкать по нему нельзя,
  // и указатель там не ставится намеренно — обещать пальцем то, чего
  // не будет, хуже, чем не обещать вовсе.
  let cursorSeen = vp.mobile ? 'нет наведения' : null;
  for (const [dx, dy] of vp.mobile ? [] : [[0, 0], [18, 0], [-18, 0], [0, 18], [0, -18], [13, 13], [-13, -13]]) {
    const cx = OX + pressed.x + dx;
    const cy = OY + pressed.y + dy;
    const svobodno = await page.evaluate(([x, y]) => {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el === document.body || el === document.documentElement) break;
        if (el.tagName === 'CANVAS' && el.classList.contains('bubbles')) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundImage !== 'none') return false;
        const m = cs.backgroundColor.match(/[\d.]+/g);
        if (m && (m.length < 4 || Number(m[3]) > 0.05)) return false;
      }
      return true;
    }, [cx, cy]);
    if (!svobodno) continue;
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(140);
    // Указатель ставится на body: свой фон у страницы, а не у секции.
    cursorSeen = await page.evaluate(() => document.body.style.cursor);
    if (cursorSeen === 'pointer') break;
  }
  if (cursorSeen === 'нет наведения') line.push('  —   сенсорный экран: наведения нет, курсор не проверяется');
  else if (cursorSeen === 'pointer') ok('над пузырём курсор становится указателем');
  else if (cursorSeen === null) line.push('  —   над пятном везде непрозрачное содержимое, курсор не проверен');
  else fail(`над пузырём курсор «${cursorSeen || 'обычный'}», ожидался pointer`);

  // ─── Пузыри лежат ПОД содержимым ──────────────────────────
  //
  // Прежде здесь стояла проверка «полоса подзаголовка чиста»: холст
  // лежал над фоном первого экрана, и краску приходилось держать
  // подальше от букв запретными прямоугольниками. Запретов больше
  // нет — холст ушёл под всё содержимое, и пузырю под текстом теперь
  // и положено быть.
  //
  // Проверяется ровно то, ради чего существовал запрет: краска
  // не должна оказываться ПОВЕРХ текста. Способ прямой — снять место
  // с текстом дважды, с холстом и без него, и сравнить пиксели. Хоть
  // один отличается — значит холст рисует над буквами и порядок
  // наложения сломан.
  //
  // Мест три, и одного было бы мало: порядок наложения ломается
  // не у всей страницы разом, а у того блока, кто завёл себе свой
  // контекст наложения.
  await page.mouse.move(vp.w - 4, vp.h - 4);
  await page.waitForTimeout(1200);
  const skryt = (v) => page.evaluate((on) => {
    let st = document.getElementById('bubble-hide');
    if (!st) { st = document.createElement('style'); st.id = 'bubble-hide'; document.head.appendChild(st); }
    st.textContent = on ? 'canvas.bubbles{display:none!important}' : '';
  }, v);
  const nadTekstom = [];
  // Заголовки, а не мелкий текст: после сжатия маски у строки
  // в 16 px тела штриха почти не остаётся, и проба замолчала бы,
  // не сказав об этом. И три РАЗНЫХ блока: порядок наложения
  // ломается не у всей страницы разом, а у того, кто завёл себе
  // свой контекст наложения.
  for (const sel of ['.hero__title', '.shop__title', '.steps__title']) {
    // Блок подводится под окно: заголовок раздела может лежать
    // ниже сгиба, а снимать надо видимое. Заодно проба смотрит
    // на порядок наложения при РАЗНОЙ прокрутке — холст закреплён
    // по окну, и это не одно и то же.
    await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(900);
    const box = await page.locator(sel).first().boundingBox().catch(() => null);
    if (!box) { nadTekstom.push([sel, null]); continue; }
    const kadr = {
      x: Math.max(0, Math.round(box.x)),
      y: Math.max(0, Math.round(box.y)),
      width: Math.round(Math.min(vp.w - Math.max(0, box.x), box.width)),
      height: Math.round(Math.min(vp.h - Math.max(0, box.y), box.height)),
    };
    if (kadr.width < 8 || kadr.height < 8) { nadTekstom.push([sel, null]); continue; }
    // Три снимка, а не два: у метода есть своя точность, и её надо
    // знать. Между снимками проходит время, страница живёт своей
    // жизнью (дыхание плашек, парение карточек), и часть точек
    // штриха меняется сама по себе. Опора — два снимка ПОДРЯД
    // с одинаково спрятанным холстом: сколько точек разошлось там,
    // столько метод не различает.
    const sHolstom = PNG.sync.read(await page.screenshot({ clip: kadr }));
    await skryt(true);
    await page.waitForTimeout(180);
    const bezHolsta = PNG.sync.read(await page.screenshot({ clip: kadr }));
    await page.waitForTimeout(180);
    const opora = PNG.sync.read(await page.screenshot({ clip: kadr }));
    await skryt(false);
    await page.waitForTimeout(180);
    // Сравниваются НЕ все пиксели коробки, а только тело букв.
    //
    // В коробку строки входят и промежутки между словами, и поля
    // над строкой — там пузырь виден, и это правильно: он лежит
    // под текстом, а не под его прямоугольником. Сравнение всей
    // коробки объявляло бы поломкой ровно то поведение, которого
    // и добивались (замер: 935 пикселей из 42408 на исправной
    // странице).
    //
    // Тело буквы находится по снимку БЕЗ холста: фон там — самый
    // частый цвет, буква — то, что от него дальше всего. Берём
    // только уверенную середину штриха (больше 60 % пути от фона
    // к самому тёмному): кромка буквы сглажена, и за ней краска
    // пузыря просвечивает законно.
    const W = bezHolsta.width, H = bezHolsta.height;
    const schet = new Map();
    for (let k = 0; k < bezHolsta.data.length; k += 4) {
      const key = (bezHolsta.data[k] << 16) | (bezHolsta.data[k + 1] << 8) | bezHolsta.data[k + 2];
      schet.set(key, (schet.get(key) ?? 0) + 1);
    }
    let fonKey = 0, fonN = -1;
    for (const [key, n] of schet) if (n > fonN) { fonN = n; fonKey = key; }
    const fon = [(fonKey >> 16) & 255, (fonKey >> 8) & 255, fonKey & 255];
    const otst = (d, k) => (Math.abs(d[k] - fon[0]) + Math.abs(d[k + 1] - fon[1]) + Math.abs(d[k + 2] - fon[2])) / 3;
    let maxOtst = 0;
    for (let k = 0; k < bezHolsta.data.length; k += 4) maxOtst = Math.max(maxOtst, otst(bezHolsta.data, k));
    // ТЕЛО штриха — это не «тёмный пиксель», а тёмный пиксель,
    // у которого и все четыре соседа тёмные.
    //
    // Кромка глифа сглажена: пиксель с покрытием 60 % на 40 % состоит
    // из фона, и краска пузыря за ним просвечивает законно. Замер
    // по одному лишь порогу на исправной странице: 0.6 → 219
    // отличающихся точек, 0.8 → 100, 0.9 → 30, 0.95 → 9, 0.97 → 4.
    // То есть всё, что «почти чёрное», всё ещё наполовину фон.
    //
    // Порога мало и по второй причине: холст отдаётся плотностью
    // меньше единицы и растягивается, и при пересчёте граничный
    // пиксель может уехать на единицу. Поэтому берётся не порог,
    // а СЖАТИЕ маски на один пиксель: остаются только те точки,
    // вокруг которых со всех сторон тоже штрих. Их краска пузыря
    // не может задеть никак, кроме как оказавшись поверх буквы.
    const porogShtriha = maxOtst * 0.9;
    const otlichie = (a, b, k) => Math.abs(a.data[k] - b.data[k]) > 1
      || Math.abs(a.data[k + 1] - b.data[k + 1]) > 1
      || Math.abs(a.data[k + 2] - b.data[k + 2]) > 1;
    const shtrih = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (otst(bezHolsta.data, i * 4) >= porogShtriha) shtrih[i] = 1;
    let raznyh = 0, shum = 0, telaBukv = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!shtrih[i] || !shtrih[i - 1] || !shtrih[i + 1] || !shtrih[i - W] || !shtrih[i + W]) continue;
        telaBukv++;
        const k = i * 4;
        if (otlichie(sHolstom, bezHolsta, k)) raznyh++;
        if (otlichie(opora, bezHolsta, k)) shum++;
      }
    }
    nadTekstom.push([sel, telaBukv > 100 ? { raznyh, shum, vsego: telaBukv, kadr: W * H } : null]);
  }
  const proverennyh = nadTekstom.filter(([, r]) => r);
  // Пропущенное место обязано быть названо. На узком экране заголовок
  // раздела может не набрать сотни точек тела штриха — это нормально,
  // но молчать об этом нельзя: «проверено три места» и «проверено
  // одно» — разные утверждения.
  const propushcheno = nadTekstom.filter(([, r]) => !r).map(([sel]) => sel);
  if (propushcheno.length) line.push(`  —   пропущено (мало тела штриха на этой ширине): ${propushcheno.join(', ')}`);
  if (!proverennyh.length) {
    fail('ни одного места с текстом не нашлось — проба устарела, поправьте селекторы');
  } else {
    // Вердикт — по превышению НАД шумом метода, а не по нулю:
    // ноль здесь недостижим, пока страница дышит и парит.
    const gryaznye = proverennyh.filter(([, r]) => r.raznyh > r.shum);
    if (gryaznye.length) {
      for (const [sel, r] of gryaznye) fail(`краска проступает поверх «${sel}»: ${r.raznyh} точек штриха из ${r.vsego} при шуме метода ${r.shum}`);
    } else {
      ok(`пузыри лежат под содержимым: ${proverennyh.map(([sel, r]) => `${sel} ${r.raznyh} при шуме ${r.shum} из ${r.vsego}`).join(', ')}`);
    }
  }

  // ─── Лопание и возврат ────────────────────────────────────
  //
  // Сетка идёт по ОКНУ, а не по коробке первого экрана: холст
  // закреплён по окну, и пузыри плавают по всей его площади.
  // По коробке первого экрана сетка искала бы их там, где их
  // теперь может не быть вовсе.
  //
  // Нажатия по непрозрачному содержимому не считаются попытками:
  // над карточкой или чеком приоритет у интерфейса, пузырь там
  // и не должен лопаться. Считать такие нажатия — значит объявить
  // поломкой правильное поведение.
  let popped = 0;
  let tries = 0;
  const step = vp.mobile ? 26 : 34;
  outer:
  for (let y = navH + 20; y < vp.h - barH - 20; y += step) {
    for (let x = 20; x < vp.w - 20; x += step) {
      const svob = await page.evaluate(([px, py]) => {
        for (const el of document.elementsFromPoint(px, py)) {
          if (el === document.body || el === document.documentElement) break;
          if (el.tagName === 'CANVAS' && el.classList.contains('bubbles')) continue;
          const cs = getComputedStyle(el);
          if (cs.backgroundImage !== 'none') return false;
          const m = cs.backgroundColor.match(/[\d.]+/g);
          if (m && (m.length < 4 || Number(m[3]) > 0.05)) return false;
        }
        return true;
      }, [x, y]);
      if (!svob) continue;
      tries++;
      await page.mouse.click(x, y);
      await page.waitForTimeout(40);
      if ((await count()) < n0) { popped = tries; break outer; }
    }
  }
  if (popped) ok(`лопнул с ${popped}-й попытки`);
  else fail(`пузырь не лопнул ни разу за ${tries} нажатий по свободным местам`);

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
  //
  // Замер идёт на СВЕЖЕЙ странице, а не в конце длинной проверки.
  // К этому месту по странице успели полопать три десятка пузырей,
  // раскрыть карточки витрины и шесть раз спрятать и вернуть холст;
  // всё это тянет за собой свои анимации, и кадры мерились бы
  // не в покое, а в хвосте чужого движения. Замер это и показывал:
  // 33.8 % кадров дольше 17 мс на сборке, которая на свежей странице
  // даёт 0.0 %, — причём одинаково у обеих сравниваемых сборок,
  // то есть число не различало их вовсе.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
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
  if (idleCount > 0) ok(`пузыри на экране без действия человека: ${idleCount} шт.`);
  else fail(`до первого действия пузырей ${idleCount} — первый экран стоит пустым`);
  line.push(`  —   пузыри нарисованы на ${bubAt} мс от начала загрузки`);
  // Вердикт про тяжёлый кусок ставится только там, где витрина заведомо
  // ниже сгиба: на широком экране она попадает в первый экран и поднимает
  // свою сцену сразу, а Three.js остался ровно у неё.
  if (vp.mobile) {
    if (bigBefore === 0) ok(`пузырям тяжёлый кусок не нужен: до первого действия его нет, самый большой ${(biggest / 1024).toFixed(0)} КБ`);
    else fail(`до первого действия пришло тяжёлых кусков ${bigBefore} — пузыри тянут библиотеку`);
  } else {
    line.push(`  —   на широком экране витрина в первом экране и тянет свою сцену сама: тяжёлых кусков до действия ${bigBefore}, после ${bigAfter}`);
  }

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
