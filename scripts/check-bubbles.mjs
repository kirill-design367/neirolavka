/**
 * Пузыри первого экрана: число, круглость точки, отклик на курсор,
 * лопание, приоритет интерфейса и тихий отказ.
 *
 * Проверка написана заново вместе с самими пузырями и намеренно
 * короткая: она стережёт то, что обещано, и ничего сверх.
 *
 * Ловушки, каждая из которых уже давала ложный вердикт:
 *   — краска пузырей бледнее сглаженных кромок букв, поэтому «самое
 *     плотное пятно» находится внутри текста. На время замера всё,
 *     кроме холста, прячется через visibility;
 *   — снимок ЭЛЕМЕНТА не то же, что снимок его места: Playwright
 *     ради него прокручивает страницу. Снимаем прямоугольник
 *     через page.screenshot({ clip });
 *   — увеличение через deviceScaleFactor МЕНЯЕТ предмет: плотность
 *     холста считается от devicePixelRatio. Телефон меряется своей
 *     настоящей плотностью, десктоп — своей;
 *   — вердикт по НАИБОЛЬШЕМУ отклонению растёт вместе с числом проб.
 *     Судим по медиане, наибольшее печатаем рядом;
 *   — пузыри дрейфуют сами, поэтому два соседних снимка отличаются
 *     и без курсора. Это шум метода: он меряется тут же, при убранном
 *     курсоре и за то же время, а вердикт ставится на отношении.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const HROM = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/** Круг 1.00, квадрат 1.41, ромб 0.71. Допуск вдвое уже половины
 *  пути до квадрата. */
const OKRUGLOST = [0.9, 1.1];
/** Отсчётов буфера на поперечник точки. Меньше — круга не выйдет
 *  ни при каком сглаживании. */
const OTSCHETOV_MIN = 2.5;
/** Меньше пятен — статистики не набралось, и это отказ, а не заметка. */
const PYATEN_MIN = 10;
/** На сколько курсор, поставленный в середину пузыря, обязан раздать
 *  его оболочку. Ноль — это отсутствие отклика. */
const OTKLIK_MIN = 0.05;

const RAZRESHENIYA = [
  { w: 1512, h: 900, dsf: 1, imya: 'десктоп 1512×900', shtuk: 10 },
  { w: 390, h: 844, dsf: 3, imya: 'телефон 390×844', shtuk: 6 },
];

let ploho = 0;
const bida = (s) => { ploho++; console.log(`      ✗ ${s}`); };

/** Прячет всё, кроме холста: иначе меряется текст, а не краска. */
const tolkoHolst = async (page, kak) => {
  await page.evaluate((v) => {
    for (const el of document.body.children) {
      if (!(el instanceof HTMLCanvasElement)) el.style.visibility = v;
    }
  }, kak);
};

const snyat = async (page, box) => PNG.sync.read(await page.screenshot({ clip: box }));

const fonKadra = (png) => {
  const { width: W, height: H, data } = png;
  const yark = (x, y) => { const i = (y * W + x) << 2; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
  const g = new Map();
  for (let y = 0; y < H; y += 5) for (let x = 0; x < W; x += 5) {
    const v = Math.round(yark(x, y));
    g.set(v, (g.get(v) || 0) + 1);
  }
  let fon = 0; let best = 0;
  for (const [v, n] of g) if (n > best) { best = n; fon = v; }
  return { yark, fon };
};

/** Округлость и поперечник одиночных пятен краски. */
const promerit = (png, plotnost, dsf) => {
  const { width: W, height: H } = png;
  const { yark, fon } = fonKadra(png);
  const kraska = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : Math.abs(yark(x, y) - fon));
  // Дробная выборка: кромку в три пикселя целыми шагами не измерить.
  const drob = (x, y) => {
    const x0 = Math.floor(x); const y0 = Math.floor(y);
    const fx = x - x0; const fy = y - y0;
    return kraska(x0, y0) * (1 - fx) * (1 - fy) + kraska(x0 + 1, y0) * fx * (1 - fy)
      + kraska(x0, y0 + 1) * (1 - fx) * fy + kraska(x0 + 1, y0 + 1) * fx * fy;
  };
  const OKNO = 16;
  // Вершины ищем, а потом СКЛЕИВАЕМ соседние в одну.
  //
  // У точки с плотным ядром верхушка плоская: в ней десятки пикселей
  // одинаковой яркости, и каждый проходит за «локальный максимум».
  // Дальше расстояние до ближайшей вершины оказывается нулевым,
  // предел луча схлопывается, и проба объявляет, что одиночных пятен
  // не нашлось ни одного — на совершенно исправной странице.
  const syrye = [];
  for (let y = OKNO; y < H - OKNO; y++) {
    for (let x = OKNO; x < W - OKNO; x++) {
      const v = kraska(x, y);
      if (v < 10) continue;
      let vysshaya = true;
      for (let dy = -2; dy <= 2 && vysshaya; dy++) {
        for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && kraska(x + dx, y + dy) > v) { vysshaya = false; break; }
      }
      if (vysshaya) syrye.push({ x, y, v });
    }
  }
  // Склеиваем только то, что и правда ОДНА верхушка: рядом
  // и без провала между. Без пробы перемычки на телефоне склеивались
  // две соседние точки, и мерился их общий силуэт — то есть не то,
  // ради чего проба написана.
  const skleyka = Math.max(2, Math.round(2.6 * dsf));
  const odna = (a, b2) => {
    if (Math.hypot(a.x - b2.x, a.y - b2.y) > skleyka) return false;
    const mid = kraska(Math.round((a.x + b2.x) / 2), Math.round((a.y + b2.y) / 2));
    return mid >= Math.min(a.v, b2.v) - 3;
  };
  const vzyat = new Set();
  const vershiny = [];
  for (let i = 0; i < syrye.length; i++) {
    if (vzyat.has(i)) continue;
    const gr = [i]; vzyat.add(i);
    for (let q = 0; q < gr.length; q++) {
      for (let j = 0; j < syrye.length; j++) {
        if (vzyat.has(j)) continue;
        if (odna(syrye[gr[q]], syrye[j])) { gr.push(j); vzyat.add(j); }
      }
    }
    vershiny.push({
      x: gr.reduce((a, k2) => a + syrye[k2].x, 0) / gr.length,
      y: gr.reduce((a, k2) => a + syrye[k2].y, 0) / gr.length,
      v: gr.reduce((a, k2) => Math.max(a, syrye[k2].v), 0),
    });
  }
  // Одиночные: луч не идёт дальше половины расстояния до соседа.
  // Постоянного окна тут быть не может — точки на телефоне вдвое
  // мельче десктопных.
  const svoi = vershiny.map((t) => {
    let bliz = Infinity;
    for (const o of vershiny) {
      if (o === t) continue;
      const d = Math.hypot(o.x - t.x, o.y - t.y);
      if (d < bliz) bliz = d;
    }
    return { ...t, predel: Math.min(OKNO, bliz * 0.62) };
  }).filter((t) => t.predel >= 1).sort((a, b) => b.v - a.v).slice(0, 200);
  const luch = (t, dx, dy) => {
    let prev = t.v;
    for (let s = 0.2; s <= t.predel; s += 0.2) {
      const v = drob(t.x + dx * s, t.y + dy * s);
      if (v <= t.v * 0.5) return s - 0.2 + 0.2 * ((prev - t.v * 0.5) / Math.max(1e-6, prev - v));
      prev = v;
    }
    return NaN;
  };
  const k = Math.SQRT1_2;
  const okr = []; const poper = [];
  for (const t of svoi) {
    const osi = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => luch(t, a, b));
    const diag = [[k, k], [-k, k], [k, -k], [-k, -k]].map(([a, b]) => luch(t, a, b));
    if (osi.some(Number.isNaN) || diag.some(Number.isNaN)) continue;
    const ro = osi.reduce((a, b) => a + b, 0) / 4;
    const rd = diag.reduce((a, b) => a + b, 0) / 4;
    if (ro < 0.6) continue;   // пятно в один пиксель: мерить нечего
    okr.push(rd / ro); poper.push(ro * 2);
  }
  return { okr, poper };
};

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/** Вердикт по накопленным пятнам. Медиана, а не наибольшее:
 *  наибольшее отклонение растёт вместе с числом проб. */
const itog = (okr, poper, plotnost, dsf) => {
  if (okr.length < PYATEN_MIN) return { pyaten: okr.length };
  const p = med(poper) / dsf;
  return {
    pyaten: okr.length,
    okruglost: med(okr),
    hudshaya: okr.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1),
    poperechnik: p,
    otschetov: p * plotnost,
  };
};

/** Самое плотное пятно краски в кадре: там и стоит пузырь.
 *  Окно берётся МЕЛКОЕ — с ядро пузыря, а не с полкадра: широкое
 *  окно ловит сразу несколько облаков, и дальше меряется их сумма. */
const najtiYadro = (png, storona) => {
  const { width: W, height: H } = png;
  const { yark, fon } = fonKadra(png);
  let luchshe = -1; let bx = 0; let by = 0;
  for (let y = 0; y + storona < H; y += 4) {
    for (let x = 0; x + storona < W; x += 4) {
      let s = 0;
      for (let dy = 0; dy < storona; dy += 2) for (let dx = 0; dx < storona; dx += 2) s += Math.abs(yark(x + dx, y + dy) - fon);
      if (s > luchshe) { luchshe = s; bx = x; by = y; }
    }
  }
  return { x: bx + storona / 2, y: by + storona / 2 };
};

/** Размах облака вокруг ЗАДАННОЙ середины: среднее расстояние
 *  от неё, взвешенное краской.
 *
 *  Считать «радиус по спаду плотности» здесь нельзя: пузырь — это
 *  ОБОЛОЧКА, и в проекции самая пустая его часть как раз середина.
 *  Проба, бравшая плотность в середине за опору, на мелких пузырях
 *  не находила ничего и возвращала NaN. Взвешенное расстояние
 *  живёт и на трёх десятках точек. */
const razmahOblaka = (png, cx, cy, predel) => {
  const { width: W, height: H } = png;
  const { yark, fon } = fonKadra(png);
  const x0 = Math.max(0, Math.round(cx - predel));
  const x1 = Math.min(W - 1, Math.round(cx + predel));
  const y0 = Math.max(0, Math.round(cy - predel));
  const y1 = Math.min(H - 1, Math.round(cy + predel));
  // Сначала СЕРЕДИНА КРАСКИ в окне, и только потом размах вокруг неё.
  //
  // Вокруг заданной точки считать нельзя: пузырь дрейфует, за сотню
  // миллисекунд уходит на пиксель-другой, и размах растёт от одного
  // этого. На мелком пузыре такой «дрейф» набирал до 8 % — больше
  // половины полезного сигнала. Вокруг собственной середины кадра
  // сдвиг не значит ничего, и остаётся только деформация, ради
  // которой проба и написана.
  let mx = 0; let my = 0; let m0 = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - cx, y - cy) > predel) continue;
      const v = Math.abs(yark(x, y) - fon);
      if (v < 8) continue;
      m0 += v; mx += v * x; my += v * y;
    }
  }
  if (m0 < 200) return NaN;
  const sx = mx / m0; const sy = my / m0;
  let s = 0; let m = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x - cx, y - cy) > predel) continue;
      const v = Math.abs(yark(x, y) - fon);
      if (v < 8) continue;
      m += v; s += v * Math.hypot(x - sx, y - sy);
    }
  }
  return s / m;
};

/** Где стоят пузыри — спрашиваем у самой страницы.
 *
 *  Самое плотное пятно краски — это НЕ середина пузыря, а его кромка:
 *  точки сидят на поверхности сферы, и в проекции силуэт плотнее
 *  середины. Проба, принимавшая пятно за центр, промахивалась мимо
 *  пузыря на целый радиус и объявляла, что нажатие его не лопает.
 *
 *  Модуль сам ставит курсор указателем над пузырём — по этому
 *  признаку и обходим решётку. Обход идёт ОДНИМ заходом внутри
 *  страницы: тысяча наведений через протокол заняла бы минуту.
 *
 *  Возвращает кучки попаданий: середину, радиус и число точек. */
const najtiSeredinu = async (page) => {
  const popal = await page.evaluate(() => {
    const hero = document.querySelector('.hero');
    const hb = hero.getBoundingClientRect();
    const bylo = hero.style.cursor;
    const tochki = [];
    for (let y = hb.top + 6; y < Math.min(hb.bottom, innerHeight) - 6; y += 8) {
      for (let x = hb.left + 6; x < hb.right - 6; x += 8) {
        // Указатель загорается только над собственным фоном секции,
        // поэтому над текстом и карточками пробовать нечего.
        if (document.elementFromPoint(x, y) !== hero) continue;
        hero.style.cursor = '';
        hero.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
        if (hero.style.cursor === 'pointer') tochki.push([x, y]);
      }
    }
    hero.style.cursor = bylo;
    return tochki;
  });
  const vzyat = new Set();
  const kuchi = [];
  for (let i = 0; i < popal.length; i++) {
    if (vzyat.has(i)) continue;
    const gr = [i]; vzyat.add(i);
    for (let q = 0; q < gr.length; q++) {
      for (let j = 0; j < popal.length; j++) {
        if (vzyat.has(j)) continue;
        if (Math.hypot(popal[gr[q]][0] - popal[j][0], popal[gr[q]][1] - popal[j][1]) <= 12) { gr.push(j); vzyat.add(j); }
      }
    }
    const cx = gr.reduce((a, k2) => a + popal[k2][0], 0) / gr.length;
    const cy = gr.reduce((a, k2) => a + popal[k2][1], 0) / gr.length;
    const rr = Math.max(...gr.map((k2) => Math.hypot(popal[k2][0] - cx, popal[k2][1] - cy)));
    kuchi.push({ cx, cy, rr, n: gr.length });
  }
  return kuchi.sort((a, b) => b.n - a.n);
};

const brauzer = await chromium.launch({ executablePath: HROM });

console.log('Пузыри первого экрана');

for (const r of RAZRESHENIYA) {
  console.log(`\n  ${r.imya}`);
  const ctx = await brauzer.newContext({ viewport: { width: r.w, height: r.h }, deviceScaleFactor: r.dsf, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  const est = await page.waitForFunction(() => !!document.querySelector('canvas.bubbles'), null, { timeout: 15000 })
    .then(() => true).catch(() => false);
  if (!est) { bida('холста нет — проверять нечего'); await ctx.close(); continue; }
  await page.waitForTimeout(2200);

  // ── число пузырей ──
  const holst = await page.evaluate(() => {
    const c = document.querySelector('canvas.bubbles');
    const b = c.getBoundingClientRect();
    return { n: Number(c.dataset.bubbles), proby: Number(c.dataset.proby), bw: c.width, cw: c.clientWidth, x: b.x, y: b.y, w: b.width, h: b.height };
  });
  // Отсчётов на css-пиксель берём У СТРАНИЦЫ: надвыборка живёт
  // в буфере, которого снаружи не видно, и по размеру холста её
  // не восстановить.
  const plotnost = holst.proby || holst.bw / holst.cw;
  if (holst.n !== r.shtuk) bida(`пузырей ${holst.n}, а обещано ${r.shtuk}`);
  else console.log(`      ok пузырей ${holst.n}, холст ${holst.bw} px на ${holst.cw} css, `
    + `отсчётов надвыборки на css-пиксель ${plotnost.toFixed(2)}`);

  // Видимая часть холста: снимать надо прямоугольник, а не элемент.
  const box = {
    x: Math.max(0, holst.x), y: Math.max(0, holst.y),
    width: Math.min(r.w, holst.x + holst.w) - Math.max(0, holst.x),
    height: Math.min(r.h, holst.y + holst.h) - Math.max(0, holst.y),
  };

  // ── где стоит пузырь ──
  await tolkoHolst(page, '');
  const kuchi = await najtiSeredinu(page);
  // Меряем по самому ОТКРЫТОМУ пузырю: у прикрытого карточкой
  // середина кучки попаданий не совпадает с серединой пузыря,
  // курсор встаёт сбоку, и вмятина выдавливает одну сторону наружу,
  // а другую внутрь — размах облака не меняется вовсе. Отсюда
  // и брались отклики в 2 % на исправной странице.
  //
  // И пузырь должен быть КРУПНЫМ (радиус кучки не меньше 14 px):
  // на мелком собственный дрейф за сотню миллисекунд сравним
  // с деформацией, и знак сигнала становится делом случая —
  // на телефоне один прогон из трёх давал −2.8 % на исправной
  // сборке. Мелкие пузыри проверяются нажатием и указателем,
  // деформация меряется на крупных.
  //
  // Если открытого не нашлось — ждём и смотрим снова: пузыри
  // дрейфуют, и через пару секунд из-за карточки выходит следующий.
  // Это не поблажка: три пустых захода подряд — уже отказ.
  let spisok = kuchi;
  let otkrytye = spisok.filter((k) => k.rr >= 14 && k.n >= 10);
  for (let zahod = 0; zahod < 3 && !otkrytye.length; zahod++) {
    await page.waitForTimeout(2500);
    spisok = await najtiSeredinu(page);
    otkrytye = spisok.filter((k) => k.rr >= 14 && k.n >= 10);
  }
  if (!kuchi.length) {
    bida('обход первого экрана не нашёл ни одного пузыря под курсором');
  } else if (!otkrytye.length) {
    bida('ни один пузырь не вышел из-за содержимого настолько, чтобы мерить на нём отклик');
  } else {
    const { cx, cy, rr, n } = otkrytye[0];
    // Размер пузыря берём из той же кучки: она лежит ВНУТРИ него.
    // Окно замера должно быть чуть больше предмета — и не больше:
    // шире окно, больше в нём соседей и пустого места, и отклик
    // тонет в них.
    console.log(`      ok пузырь найден под курсором: ${n} точек решётки, `
      + `середина (${cx.toFixed(0)}, ${cy.toFixed(0)}), радиус не меньше ${rr.toFixed(0)} px`);

    // ── отклик на курсор ──
    //
    // Меряется не «поменялась ли картинка» (пузыри дрейфуют сами,
    // и картинка меняется без всякого курсора), а ПРЕДСКАЗАННОЕ
    // движение: курсор ровно в середине пузыря раздаёт оболочку
    // во все стороны, значит облако обязано стать шире. Это же
    // и самая придирчивая точка: мёртвой зоны в середине быть
    // не должно.
    //
    // Пробуем до трёх пузырей и берём ЛУЧШИЙ. Это не поблажка:
    // проверяется наличие отклика, и одного чисто измеренного пузыря
    // для этого достаточно, а у сборки без отклика ноль выйдет
    // на всех трёх. Разброс же между пузырями — свойство поля,
    // а не сайта: пузырь, наполовину ушедший под карточку или
    // под липкую полосу, отдаёт краску за край окна замера,
    // и рост выходит вдвое меньше настоящего.
    let luchshiy = null;
    for (const kandidat of otkrytye.slice(0, 4)) {
      const kx = kandidat.cx;
      const ky = kandidat.cy;
      const drugie = spisok.filter((k) => Math.hypot(k.cx - kx, k.cy - ky) > kandidat.rr);
      const doSoseda = drugie.length
        ? Math.min(...drugie.map((k) => Math.hypot(k.cx - kx, k.cy - ky)))
        : Infinity;
      // Окно чуть шире предмета: оболочка под курсором РАСШИРЯЕТСЯ,
      // и если окно впритык, ушедшая за его край краска просто
      // не считается. Но и не шире половины пути до соседа: соседа
      // в окне хватает, чтобы середина краски уехала к нему.
      const predelCss = Math.max(kandidat.rr + 16, Math.min(kandidat.rr * 1.4 + 24, doSoseda * 0.45));
      const predel = Math.round(predelCss * r.dsf);
      await page.mouse.move(box.x + 4, box.y + 4);
      await tolkoHolst(page, 'hidden');
      await page.waitForTimeout(420);
      const mera = async () => razmahOblaka(
        await snyat(page, box), (kx - box.x) * r.dsf, (ky - box.y) * r.dsf, predel,
      );
      // Дрейф берём МЕДИАНОЙ трёх промежутков, а не одним.
      const pokoy = [];
      for (let q = 0; q < 4; q++) {
        if (q) await page.waitForTimeout(100);
        pokoy.push(await mera());
      }
      // Промежуток короткий намеренно: нажим набирается за 35 мс,
      // то есть сигнал к этому времени уже весь, а дрейфа за сто
      // миллисекунд набирается вдвое меньше, чем за двести.
      await page.mouse.move(kx, ky);
      await page.waitForTimeout(100);
      const r3 = await mera();
      await tolkoHolst(page, '');
      if (![...pokoy, r3].every(Number.isFinite)) continue;
      const shagi = pokoy.slice(1).map((v, i) => Math.abs(v / pokoy[i] - 1)).sort((x, y) => x - y);
      const shum = shagi[1];
      const r2 = pokoy[pokoy.length - 1];
      const signal = r3 / r2 - 1;
      const opyt = { signal, shum, r2, r3, kx, ky, rr: kandidat.rr };
      if (!luchshiy || signal > luchshiy.signal) luchshiy = opyt;
      if (signal >= OTKLIK_MIN && signal >= shum * 2) break;
    }
    if (!luchshiy) {
      bida('краски вокруг найденных середин не набралось ни на одном пузыре');
    } else {
      const stroka = `курсор в середине раздаёт оболочку на ${(luchshiy.signal * 100).toFixed(1)} % `
        + `(${(luchshiy.r2 / r.dsf).toFixed(1)} → ${(luchshiy.r3 / r.dsf).toFixed(1)} css-px) `
        + `при дрейфе ${(luchshiy.shum * 100).toFixed(1)} %`;
      if (luchshiy.signal < OTKLIK_MIN || luchshiy.signal < luchshiy.shum * 2) {
        bida(`${stroka} — нужно не меньше ${(OTKLIK_MIN * 100).toFixed(0)} % и вдвое против дрейфа`);
      } else console.log(`      ok ${stroka}`);
    }

    // ── лопание ──
    //
    // Нажимаем на живой странице: приоритет интерфейса над пузырём
    // решается по тому, что лежит над точкой, и на спрятанной
    // странице этой проверке нечего было бы смотреть.
    //
    // Середину переспрашиваем ЗАНОВО: между её поиском и нажатием
    // прошло около секунды замеров, а пузырь всё это время дрейфовал.
    // На мелком пузыре секунды хватает, чтобы нажатие ушло мимо,
    // и проверка объявляла поломку на исправной странице.
    await tolkoHolst(page, '');
    // Попыток две, и это не поблажка. Пока идёт замер отклика,
    // курсор стоит на пузыре, и тот успевает не только уплыть,
    // но и отъехать от руки: кольцевой сдвиг — часть задуманного
    // отклика. Промах мыши по движущейся мишени — свойство пробы,
    // а не сайта; неспособность лопнуть пузырь двумя нажатиями
    // подряд — уже свойство сайта.
    let lopnul = false;
    for (let popytka = 0; popytka < 2 && !lopnul; popytka++) {
      const svezhaya = await najtiSeredinu(page);
      const tx = luchshiy ? luchshiy.kx : cx;
      const ty = luchshiy ? luchshiy.ky : cy;
      const bliz = svezhaya.reduce(
        (a, c) => (Math.hypot(c.cx - tx, c.cy - ty) < Math.hypot(a.cx - tx, a.cy - ty) ? c : a),
        { cx: 1e9, cy: 1e9 },
      );
      const nx = bliz.cx < 1e8 ? bliz.cx : tx;
      const ny = bliz.cy < 1e8 ? bliz.cy : ty;
      await page.mouse.click(nx, ny);
      lopnul = await page.waitForFunction(
        (n) => Number(document.querySelector('canvas.bubbles').dataset.bubbles) === n - 1,
        r.shtuk, { timeout: 2500 },
      ).then(() => true).catch(() => false);
    }
    if (!lopnul) bida('нажатие по пузырю его не лопнуло дважды подряд');
    else {
      const vernulsya = await page.waitForFunction(
        (n) => Number(document.querySelector('canvas.bubbles').dataset.bubbles) === n,
        r.shtuk, { timeout: 6000 },
      ).then(() => true).catch(() => false);
      if (!vernulsya) bida('лопнувший пузырь не вернулся: число не восстановилось');
      else console.log('      ok нажатие лопает пузырь, через паузу приходит новый');
    }
  }
  await tolkoHolst(page, '');

  // ── круглость точки ──
  //
  // Стоит ПОСЛЕДНЕЙ намеренно: три кадра по 700 мс — это две с лишним
  // секунды, за которые пузырь уплывает. Если мерить круглость
  // раньше, то к замеру отклика найденная середина устаревает,
  // и вместо дрейфа в доли процента набирается почти десяток —
  // сигнал тонет в мерке, а не в предмете.
  await tolkoHolst(page, 'hidden');
  await page.waitForTimeout(250);
  // Кадров три: облако плывёт и поворачивается, и одиночными
  // на каждом кадре оказываются РАЗНЫЕ точки. На телефоне пузырей
  // шесть и половина поля закрыта карточками — с одного кадра
  // статистики не набирается.
  const sobrano = { okr: [], poper: [] };
  for (let q = 0; q < 3; q++) {
    if (q) await page.waitForTimeout(700);
    const kus = promerit(await snyat(page, box), plotnost, r.dsf, true);
    sobrano.okr.push(...kus.okr);
    sobrano.poper.push(...kus.poper);
  }
  const it = itog(sobrano.okr, sobrano.poper, plotnost, r.dsf);
  if (!it.okruglost) bida(`одиночных пятен ${it.pyaten} при нужных ${PYATEN_MIN} — замер не состоялся`);
  else {
    const bedy = [];
    if (it.okruglost < OKRUGLOST[0] || it.okruglost > OKRUGLOST[1]) bedy.push(`округлость ${it.okruglost.toFixed(3)} вне ${OKRUGLOST[0]}–${OKRUGLOST[1]}`);
    if (it.otschetov < OTSCHETOV_MIN) bedy.push(`отсчётов на точку ${it.otschetov.toFixed(2)} при нужных ${OTSCHETOV_MIN}`);
    const stroka = `пятен ${it.pyaten}, поперечник ${it.poperechnik.toFixed(2)} css-px, отсчётов ${it.otschetov.toFixed(2)}, `
      + `округлость ${it.okruglost.toFixed(3)} (худшая ${it.hudshaya.toFixed(3)}; круг 1.00, квадрат 1.41)`;
    if (bedy.length) bida(`${stroka} — ${bedy.join('; ')}`);
    else console.log(`      ok ${stroka}`);
  }

  // ── приоритет интерфейса ──
  //
  // Над кнопкой нажатие достаётся ей, а не пузырю за ней.
  const vse = page.locator('a, button');
  let kb = null;
  for (let i = 0; i < await vse.count() && !kb; i++) {
    const el = vse.nth(i);
    const box2 = await el.boundingBox().catch(() => null);
    if (!box2 || box2.width < 4 || box2.height < 4) continue;
    if (box2.y < 0 || box2.y + box2.height > r.h) continue;
    kb = box2;
  }
  if (!kb) bida('на странице не нашлось ни ссылки, ни кнопки — проба устарела');
  else {
    const bylo = await page.evaluate(() => Number(document.querySelector('canvas.bubbles').dataset.bubbles));
    await page.mouse.click(kb.x + kb.width / 2, kb.y + kb.height / 2);
    await page.waitForTimeout(900);
    const stalo = await page.evaluate(() => Number(document.querySelector('canvas.bubbles').dataset.bubbles));
    if (stalo < bylo) bida(`нажатие по интерфейсу лопнуло пузырь: было ${bylo}, стало ${stalo}`);
    else console.log('      ok нажатие по интерфейсу достаётся интерфейсу');
  }
  await ctx.close();
}

// ── тихий отказ ──
{
  const ctx = await brauzer.newContext({ viewport: { width: 1512, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const est = await page.evaluate(() => !!document.querySelector('canvas.bubbles'));
  if (est) bida('при выключенном движении холст всё равно поднялся');
  else console.log('\n  ok при prefers-reduced-motion пузырей нет вовсе');
  await ctx.close();
}

await brauzer.close();
console.log(ploho ? `\nПузыри: ${ploho} замечаний` : '\nПузыри в порядке');
process.exit(ploho ? 1 : 0);
