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
const PYATEN_MIN = 12;
/** На сколько курсор, поставленный в середину пузыря, обязан раздать
 *  его оболочку. Ноль — это отсутствие отклика.
 *
 *  Вдвое против дрейфа требуется сверх этого. Прибавка «столько же
 *  сверх дрейфа» пробовалась и оказалась хуже: при дрейфе в доли
 *  процента она просто удваивала порог, и честные 5.2 % не проходили
 *  из-за 0.3 % шума. Отношение работает потому, что размах меряется
 *  вокруг своей середины кадра и дрейф упал до 0.1–0.8 %. */
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
  //
  // Склеиваем по ДВУМ признакам сразу: рядом И без провала между.
  // По одному расстоянию склеиваются две соседние точки, и мерится
  // их общий силуэт.
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
  const skleyka = Math.max(2, Math.round(2.6 * dsf));
  const odna = (a, b2) => {
    if (Math.hypot(a.x - b2.x, a.y - b2.y) > skleyka) return false;
    const mid = kraska(Math.round((a.x + b2.x) / 2), Math.round((a.y + b2.y) / 2));
    return mid >= Math.min(a.v, b2.v) - 3;
  };
  const vzyatV = new Set();
  const vershiny = [];
  for (let i = 0; i < syrye.length; i++) {
    if (vzyatV.has(i)) continue;
    const gr = [i]; vzyatV.add(i);
    for (let q = 0; q < gr.length; q++) {
      for (let j = 0; j < syrye.length; j++) {
        if (vzyatV.has(j)) continue;
        if (odna(syrye[gr[q]], syrye[j])) { gr.push(j); vzyatV.add(j); }
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
  // этого. На мелком пузыре такой мнимый дрейф набирал 5 % — больше
  // половины полезного сигнала. Вокруг собственной середины кадра
  // сдвиг не значит ничего, и остаётся только деформация, ради
  // которой проба и написана.
  //
  // Работает это только вместе с мелкой решёткой поиска: пока курсор
  // ставился в середину грубой кучки, он попадал сбоку, и сжатие
  // вдоль оси съедало ровно ту часть сигнала, которую освобождал
  // этот приём.
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

/** Где стоят пузыри — спрашиваем у самой страницы: над пузырём
 *  модуль ставит курсор указателем. Решётка обходится ОДНИМ заходом
 *  внутри страницы — тысяча наведений из Playwright заняла бы минуту.
 *  Возвращает кучки попаданий, самая крупная первой. */
const najtiSeredinu = async (page) => {
  const popal = await page.evaluate(() => {
    const hero = document.querySelector('.hero');
    const hb = hero.getBoundingClientRect();
    const bylo = hero.style.cursor;
    const tochki = [];
    // Шаг мелкий: на телефоне первый экран узкий и почти весь занят
    // текстом и карточками, свободного фона остаётся полоса. При шаге
    // в двенадцать пикселей на пузырь приходилось две-три пробы,
    // кучка выходила вырожденной, и мерить было не на чем.
    for (let y = hb.top + 4; y < Math.min(hb.bottom, innerHeight) - 4; y += 7) {
      for (let x = hb.left + 4; x < hb.right - 4; x += 7) {
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
        if (Math.hypot(popal[gr[q]][0] - popal[j][0], popal[gr[q]][1] - popal[j][1]) <= 11) { gr.push(j); vzyat.add(j); }
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
  // в отдельном буфере, которого снаружи не видно, и по размеру
  // холста её не восстановить.
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
  //
  // Самое плотное пятно краски — это НЕ середина пузыря, а его
  // кромка: точки сидят на поверхности сферы, и в проекции силуэт
  // плотнее середины. Проба, принимавшая пятно за центр, промахивалась
  // мимо пузыря на целый радиус и объявляла, что нажатие его
  // не лопает. Середину поэтому спрашиваем у страницы.
  await tolkoHolst(page, '');
  let kuchi = await najtiSeredinu(page);
  // Кучка должна быть НЕ ОДНОЙ ТОЧКОЙ: у пузыря, от которого
  // из-за карточек виден один узел решётки, радиус выходит нулевым,
  // окно замера схлопывается до двадцати пикселей, и краски в нём
  // не набирается вовсе. Если такого нет — ждём и смотрим снова:
  // пузыри дрейфуют и через пару секунд выходят из-за карточки.
  // Три пустых захода подряд — уже отказ.
  const godnye = (spisok) => spisok.filter((k) => k.n >= 6 && k.rr >= 8);
  for (let zahod = 0; zahod < 3 && !godnye(kuchi).length; zahod++) {
    await page.waitForTimeout(2500);
    kuchi = await najtiSeredinu(page);
  }
  const vidnye = godnye(kuchi);
  if (!kuchi.length) {
    bida('обход первого экрана не нашёл ни одного пузыря под курсором');
  } else if (!vidnye.length) {
    bida('ни один пузырь не вышел из-за содержимого настолько, чтобы на нём мерить');
  } else {
    // Самая крупная кучка попаданий — это самый крупный пузырь:
    // по нему и меряем.
    const { cx, cy, rr, n } = vidnye[0];
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
    // Собственный дрейф меряется ТУТ ЖЕ, теми же снимками и за то же
    // время: пузырь плывёт, и два снимка без курсора отличаются сами
    // по себе. Это шум метода, и вердикт ставится на отношении к нему.
    // Окно замера чуть больше предмета: шире — и в него попадают
    // соседи, уже — предмет в него не влезает.
    const predel = Math.round((rr + 20) * r.dsf);

    // Замер повторяется до двух раз, и берётся лучшая попытка.
    //
    // Дрейф — это случайное блуждание: знак шага случаен, а сигнал
    // направлен. Когда пузырь идёт быстро относительно своего
    // размера, одной выборки не хватает — на исправной сборке
    // выходило 13.2 % сигнала при 9.8 % шага, то есть меньше
    // полутора «сигм». Вторая выборка это разводит; у сборки
    // без отклика ноль выйдет в обеих.
    const opyty = [];
    for (let popytka = 0; popytka < 3; popytka++) {
      // Курсор паркуется ВЫШЕ первого экрана, а не в его углу.
      //
      // Пока он парковался внутри секции, модуль честно считал его
      // наведённым: нажим оставался единицей, кольцевой сдвиг гонял
      // пузыри, и «тихие» кадры тихими не были — мнимый дрейф
      // доходил до 18 % и съедал вердикт. Выше секции нажим
      // отпускает за 220 мс, отсюда и пауза.
      await page.mouse.move(4, 4);
      await tolkoHolst(page, 'hidden');
      await page.waitForTimeout(600);
      const mera = async () => razmahOblaka(
        await snyat(page, box), (cx - box.x) * r.dsf, (cy - box.y) * r.dsf, predel,
      );
      // Дрейф берём МЕДИАНОЙ трёх промежутков, а не одним: мелкий
      // пузырь успевает уплыть на заметную долю своего размера,
      // и один неудачный промежуток объявлял бы поломку на исправной
      // странице.
      const pokoy = [];
      for (let q = 0; q < 4; q++) {
        if (q) await page.waitForTimeout(100);
        pokoy.push(await mera());
      }
      // Промежуток короткий намеренно: нажим набирается за 35 мс,
      // то есть сигнал к этому времени уже весь, а дрейфа за сто
      // миллисекунд набирается вдвое меньше, чем за двести.
      await page.mouse.move(cx, cy);
      await page.waitForTimeout(100);
      const r3 = await mera();
      await tolkoHolst(page, '');
      if (![...pokoy, r3].every(Number.isFinite)) continue;
      const shagi = pokoy.slice(1).map((v, i) => Math.abs(v / pokoy[i] - 1)).sort((x, y) => x - y);
      const shum = shagi[1];
      const r2 = pokoy[pokoy.length - 1];
      const signal = r3 / r2 - 1;
      const zapas = signal - shum;
      opyty.push({ signal, shum, r2, r3, zapas });
    }
    // Вердикт по МЕДИАНЕ трёх независимых замеров, а не по лучшему
    // и не по одному. Один замер изредка ловит соседний пузырь,
    // въехавший в окно, — тогда середина краски прыгает и мнимый
    // дрейф подскакивает до 7 %. «Лучший из двух» тут не помогает:
    // он и завышает на удачной выборке, и не спасает, когда обе
    // неудачны. Медиана трёх устойчива к одному выбросу и остаётся
    // честной: у сборки без отклика она даст около нуля.
    const luchshiy = opyty.length
      ? {
        signal: med(opyty.map((o) => o.signal)),
        shum: med(opyty.map((o) => o.shum)),
        r2: med(opyty.map((o) => o.r2)),
        r3: med(opyty.map((o) => o.r3)),
      }
      : null;
    if (!luchshiy) {
      bida('краски вокруг найденной середины не набралось');
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
    await tolkoHolst(page, '');
    // Середину переспрашиваем ЗАНОВО: между её поиском и нажатием
    // прошёл замер отклика, а пузырь всё это время дрейфовал — и не
    // только дрейфовал: кольцевой сдвиг от курсора тоже часть
    // задуманного отклика. На мелком пузыре секунды хватает, чтобы
    // нажатие ушло мимо, и проверка объявляла поломку на исправной
    // странице. Попыток две: промах по движущейся мишени — свойство
    // пробы, два промаха подряд — уже свойство сайта.
    let lopnul = false;
    for (let popytka = 0; popytka < 2 && !lopnul; popytka++) {
      const svezhie = await najtiSeredinu(page);
      const bliz = svezhie.reduce(
        (a, c) => (Math.hypot(c.cx - cx, c.cy - cy) < Math.hypot(a.cx - cx, a.cy - cy) ? c : a),
        { cx: 1e9, cy: 1e9 },
      );
      await page.mouse.click(bliz.cx < 1e8 ? bliz.cx : cx, bliz.cy < 1e8 ? bliz.cy : cy);
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
  // Стоит ПОСЛЕДНЕЙ намеренно: три кадра с паузами — это две с лишним
  // секунды, за которые пузырь уплывает. Если мерить круглость
  // раньше, к замеру отклика найденная середина устаревает.
  //
  // Кадров три: облако плывёт и поворачивается, и одиночными
  // на каждом кадре оказываются РАЗНЫЕ точки. С одного кадра
  // статистики не набирается — точки стали крупнее и лежат плотнее.
  await tolkoHolst(page, 'hidden');
  await page.waitForTimeout(250);
  const sobrano = { okr: [], poper: [] };
  for (let q = 0; q < 3; q++) {
    if (q) await page.waitForTimeout(700);
    const kus = promerit(await snyat(page, box), plotnost, r.dsf);
    sobrano.okr.push(...kus.okr);
    sobrano.poper.push(...kus.poper);
  }
  await tolkoHolst(page, '');
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
