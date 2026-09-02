#!/usr/bin/env node
/**
 * Кромка точки пузыря: круглая ли она и хватает ли ей отсчётов.
 *
 * Зачем. Холст пузырей закреплён по окну и растягивается на весь
 * экран, а его буфер может быть мельче экрана. Тогда точка шириной
 * 3 css-px занимает полтора отсчёта буфера — круглым пятном полтора
 * отсчёта не бывают: точка вырождается в квадратик и растягивается
 * обратно. На глаз это читается «пиксельно».
 *
 * Как меряем. Снимок делается БЕЗ увеличения — ровно то, что видит
 * человек, — и по нему для каждого одиночного пятна краски считаются
 * три величины:
 *
 *   поперечник   ширина пятна по полувысоте, css-пиксели;
 *   округлость   радиус по диагоналям, делённый на радиус по осям.
 *                У круга 1.00, у квадрата 1.41, у ромба 0.71;
 *   отсчётов     поперечник × плотность холста — сколько пикселей
 *                буфера приходится на точку. Ниже трёх круга
 *                не получится ни при каком сглаживании.
 *
 * Округлость меряется по картинке, отсчёты — по картинке и по
 * настоящему размеру буфера (canvas.width / clientWidth). Вердикт
 * ставится по обоим: первое говорит, что вышло, второе — почему.
 *
 * Ловушки, на которых эта проверка уже спотыкалась:
 *   — снимок с deviceScaleFactor > 1 МЕНЯЕТ ПРЕДМЕТ: плотность холста
 *     считается от devicePixelRatio, и при увеличении вчетверо буфер
 *     тоже растёт вчетверо. Меряется не то, что у человека на экране.
 *     Поэтому увеличения нет вовсе;
 *   — краска пузырей бледнее сглаженных кромок букв, поэтому «самое
 *     плотное пятно» находится внутри текста. На время замера всё,
 *     кроме холста, прячется через visibility;
 *   — вердикт по НАИБОЛЬШЕМУ отклонению растёт вместе с числом проб.
 *     Судим по медиане, наибольшее печатаем рядом.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
// Плотность экрана — часть предмета, а не подробность запуска:
// холст берёт её из devicePixelRatio. У телефона она не бывает
// единицей, поэтому мерить телефон при единице — значит мерить
// то, чего ни у кого нет.
const RAZRESHENIYA = [
  { w: 2560, h: 1440, dsf: 1, imya: '2560×1440' },
  { w: 1920, h: 1080, dsf: 1, imya: '1920×1080' },
  { w: 390, h: 844, dsf: 2, imya: '390×844 ×2' },
];
const TEMY = ['light', 'dark'];

/** Отсчётов буфера на поперечник точки по полувысоте.
 *
 *  Число не с потолка. Край точки считается smoothstep'ом от 0.5
 *  до 0.1 радиуса, то есть спад занимает 0.4 поперечника точки,
 *  а поперечник по ПОЛУВЫСОТЕ — 0.6 от неё. Значит на спад
 *  приходится 0.667 измеренного поперечника, и чтобы в спаде было
 *  хотя бы полтора отсчёта, нужно 2.25. Берём 2.5 с запасом.
 *
 *  Прежняя сборка давала 1.08–1.63 на десктопе — отсюда и квадратики. */
const OTSCHETOV_MIN = 2.5;
/** Округлость: круг 1.00, квадрат 1.41. Допуск взят вдвое уже
 *  половины пути до квадрата. */
const OKRUGLOST_MIN = 0.9;
const OKRUGLOST_MAX = 1.1;
/** Меньше — замер не набрал статистики, и это отказ, а не заметка. */
const PYATEN_MIN = 12;
/** Уступка засчитывается только если она и правда купила плавность.
 *  10 % кадров дольше 17 мс — это около 55 кадров в секунду. */
const DOLYA_DLINNYH_MAX = 10;

let ploho = 0;

const snyat = async (page, w, h) => {
  await page.evaluate(() => {
    for (const el of document.body.children) {
      if (!(el instanceof HTMLCanvasElement)) el.style.visibility = 'hidden';
    }
  });
  await page.waitForTimeout(250);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
  await page.evaluate(() => {
    for (const el of document.body.children) el.style.visibility = '';
  });
  return PNG.sync.read(buf);
};

const razobrat = (png) => {
  const { width: W, height: H, data } = png;
  const yark = (x, y) => {
    const i = (y * W + x) << 2;
    return (data[i] + data[i + 1] + data[i + 2]) / 3;
  };
  // Фон — самая частая яркость: он занимает почти весь кадр.
  const gist = new Map();
  for (let y = 0; y < H; y += 5) {
    for (let x = 0; x < W; x += 5) {
      const v = Math.round(yark(x, y));
      gist.set(v, (gist.get(v) || 0) + 1);
    }
  }
  let fon = 0;
  let luchshe = 0;
  for (const [v, n] of gist) if (n > luchshe) { luchshe = n; fon = v; }
  const kraska = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    return Math.abs(yark(x, y) - fon);
  };
  // Дробная выборка: кромку в три пикселя целыми шагами не измерить.
  const drob = (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    return kraska(x0, y0) * (1 - fx) * (1 - fy) + kraska(x0 + 1, y0) * fx * (1 - fy)
      + kraska(x0, y0 + 1) * (1 - fx) * fy + kraska(x0 + 1, y0 + 1) * fx * fy;
  };
  return { kraska, drob };
};

const promerit = (png, plotnost, dsf) => {
  const { kraska, drob } = razobrat(png);
  const { width: W, height: H } = png;
  // Порог по краске: ниже — шум сжатия и сглаживания.
  const POROG = 10;
  const OKNO = 9;
  const vershiny = [];
  for (let y = OKNO; y < H - OKNO; y++) {
    for (let x = OKNO; x < W - OKNO; x++) {
      const v = kraska(x, y);
      if (v < POROG) continue;
      let vysshaya = true;
      for (let dy = -2; dy <= 2 && vysshaya; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if ((dx || dy) && kraska(x + dx, y + dy) > v) { vysshaya = false; break; }
        }
      }
      if (vysshaya) vershiny.push({ x, y, v });
    }
  }
  vershiny.sort((a, b) => b.v - a.v);
  // Одиночные: до ближайшей соседней вершины дальше, чем до
  // полувысоты. Постоянного окна тут быть не может — точки на
  // телефоне вдвое мельче десктопных, и любое число, подобранное
  // по одному экрану, на другом либо съедает все пробы, либо
  // пропускает слипшиеся пары. Поэтому у каждой вершины своя
  // граница: половина расстояния до соседа. Луч дальше неё не идёт,
  // и если полувысота за неё не уложилась — пятно не одиночное
  // и в счёт не берётся.
  const svoy = vershiny.map((t) => {
    let bliz = Infinity;
    for (const o of vershiny) {
      if (o === t) continue;
      const d = Math.hypot(o.x - t.x, o.y - t.y);
      if (d < bliz) bliz = d;
    }
    return { ...t, predel: Math.min(OKNO, bliz / 2) };
  }).filter((t) => t.predel >= 1);
  const odinokie = svoy.slice(0, 200);
  const luch = (t, dx, dy) => {
    // Радиус на полувысоте, с дробным шагом.
    let prev = t.v;
    for (let s = 0.2; s <= t.predel; s += 0.2) {
      const v = drob(t.x + dx * s, t.y + dy * s);
      if (v <= t.v * 0.5) {
        const doля = (prev - t.v * 0.5) / Math.max(1e-6, prev - v);
        return s - 0.2 + 0.2 * doля;
      }
      prev = v;
    }
    return NaN;
  };
  const k = Math.SQRT1_2;
  const okr = [];
  const poper = [];
  for (const t of odinokie) {
    const osi = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => luch(t, a, b));
    const diag = [[k, k], [-k, k], [k, -k], [-k, -k]].map(([a, b]) => luch(t, a, b));
    if (osi.some(Number.isNaN) || diag.some(Number.isNaN)) continue;
    const ro = osi.reduce((a, b) => a + b, 0) / 4;
    const rd = diag.reduce((a, b) => a + b, 0) / 4;
    if (ro < 0.6) continue;   // пятно в один пиксель: мерить нечего
    okr.push(rd / ro);
    poper.push(ro * 2);
  }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
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

const brauzer = await chromium.launch({ executablePath: process.env.CHROME_PATH });

for (const r of RAZRESHENIYA) {
  for (const tema of TEMY) {
    const ctx = await brauzer.newContext({
      viewport: { width: r.w, height: r.h },
      deviceScaleFactor: r.dsf,
    });
    const page = await ctx.newPage();
    await page.addInitScript((t) => {
      try { localStorage.setItem('neirolavka-theme', t); } catch { /* приватный режим */ }
    }, tema);
    await page.goto(url, { waitUntil: 'load' });
    const est = await page.waitForFunction(() => !!document.querySelector('canvas.bubbles'), null,
      { timeout: 10000 }).then(() => true).catch(() => false);
    if (!est) {
      console.log(`  ✗ ${r.imya} / ${tema}: холста нет — проверять нечего`);
      ploho++;
      await ctx.close();
      continue;
    }
    // Плотность может понизиться сама, если машина не тянет: ждём,
    // пока присмотр за кадрами отработает свои окна, и меряем то,
    // на чём страница ОСТАНОВИЛАСЬ. Три секунды на разгон плюс до
    // четырёх окон по полторы — ждать надо дольше, иначе замер
    // застаёт лестницу на середине и судит состояние, в котором
    // страница не задерживается.
    await page.waitForTimeout(20000);
    const holst = await page.evaluate(() => {
      const c = document.querySelector('canvas.bubbles');
      return {
        bw: c.width, bh: c.height, cw: c.clientWidth,
        shag: c.dataset.shag, ustupok: Number(c.dataset.ustupok || 0),
      };
    });
    const plotnost = holst.bw / holst.cw;
    const zagolovok = `${r.imya} / ${tema}`.padEnd(18);
    // Кадры меряются ПЕРВЫМИ, на странице, которую ещё не снимали.
    //
    // Это не педантизм: page.screenshot переводит вкладку в другой
    // режим отрисовки и остаётся в нём. Замер на 2560×1440 после
    // снимка даёт 0.6 % кадров дольше 17 мс, тот же замер до
    // снимка — 61.4 %. Проверка, поставленная в обратном порядке,
    // объявляла благополучие ровно там, где страница еле шевелится.
    const kadry = await page.evaluate(() => new Promise((res) => {
      const t = []; let last = performance.now(); const t0 = last;
      const shag2 = (now) => {
        t.push(now - last); last = now;
        if (now - t0 < 3000) requestAnimationFrame(shag2);
        else res(t.slice(2).filter((x) => x > 17).length / Math.max(1, t.length - 2) * 100);
      };
      requestAnimationFrame(shag2);
    }));
    const png = await snyat(page, r.w * r.dsf, r.h * r.dsf);
    // Снимок в физических пикселях, поперечник нужен в css.
    const it = promerit(png, plotnost, r.dsf);
    await ctx.close();

    if (!it.okruglost) {
      console.log(`  ✗ ${zagolovok} одиночных пятен ${it.pyaten} при нужных ${PYATEN_MIN} — замер не состоялся`);
      ploho++;
      continue;
    }
    const bedy = [];
    if (it.otschetov < OTSCHETOV_MIN) bedy.push(`отсчётов на точку ${it.otschetov.toFixed(2)} при нужных ${OTSCHETOV_MIN}`);
    if (it.okruglost < OKRUGLOST_MIN || it.okruglost > OKRUGLOST_MAX) {
      bedy.push(`округлость ${it.okruglost.toFixed(3)} вне ${OKRUGLOST_MIN}–${OKRUGLOST_MAX}`);
    }
    // Вердикт двусторонний, и это не поблажка.
    //
    // Холст обещает две вещи сразу: точка круглая И страница на 60 fps.
    // Когда машина не тянет полную плотность, он её понижает — тогда
    // кромка законно хуже, но ТОЛЬКО если уступка и правда купила
    // плавность. Поэтому:
    //   плотность полная и кромка плохая  → отказ (зря шумели);
    //   плотность понижена и кадры плохие → отказ (уступка не сработала);
    //   плотность понижена и кадры хорошие → уступка засчитана.
    let znak = bedy.length ? '✗' : 'ok';
    let pripiska = '';
    if (bedy.length && holst.ustupok > 0) {
      if (kadry <= DOLYA_DLINNYH_MAX) {
        znak = '—';
        pripiska = `машина не тянет полную плотность: понижена ${holst.ustupok} раз(а), `
          + `и это купило кадры (${kadry.toFixed(1)} % дольше 17 мс)`;
        bedy.length = 0;
      } else {
        bedy.push(`уступка не помогла: ${kadry.toFixed(1)} % кадров дольше 17 мс`);
      }
    } else if (!bedy.length && kadry > DOLYA_DLINNYH_MAX) {
      bedy.push(`кромка гладкая, но кадры сыплются: ${kadry.toFixed(1)} % дольше 17 мс`);
      znak = '✗';
    }
    if (bedy.length) ploho++;
    console.log(`  ${znak.padEnd(3)}${zagolovok} буфер ${holst.bw}×${holst.bh} `
      + `(плотность ${plotnost.toFixed(2)}, шаг ${holst.shag}, уступок ${holst.ustupok})`);
    console.log(`      пятен ${it.pyaten}, поперечник ${it.poperechnik.toFixed(2)} css-px, `
      + `отсчётов на точку ${it.otschetov.toFixed(2)}, округлость ${it.okruglost.toFixed(3)} `
      + `(худшая ${it.hudshaya.toFixed(3)}; круг 1.00, квадрат 1.41), `
      + `кадров дольше 17 мс — ${kadry.toFixed(1)} %`);
    if (pripiska) console.log(`      ${pripiska}`);
    if (bedy.length) console.log(`      ${bedy.join('; ')}`);
  }
}

await brauzer.close();
console.log(ploho ? `\nКромка точки: ${ploho} сочетаний не прошли` : '\nКромка точки гладкая во всех сочетаниях');
process.exit(ploho ? 1 : 0);
