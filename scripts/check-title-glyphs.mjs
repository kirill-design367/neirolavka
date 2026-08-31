/**
 * Прыжок буквы в названии: сравниваем геометрию глифов в двух темах
 * так, как их видит браузер сейчас.
 *
 * Цвета в темах разные, поэтому сравниваем не цвет, а покрытие краской.
 * Покрытие нормируется по столбцам с окном: в тёмной теме заголовок
 * набран градиентом, и краска у разных букв разной силы — общий
 * максимум занизил бы покрытие на светлых участках.
 *
 * Видимая граница штриха — место, где покрытие переходит через 0,5.
 * Границы ищутся построчно и сопоставляются по близости.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const SCALES = [1, 2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;

for (const SCALE of SCALES) {
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU',
                                 deviceScaleFactor: SCALE, reducedMotion: 'reduce' });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const shot = async (theme) => {
    await p.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.style.colorScheme = t;
      let st = document.getElementById('probe');
      if (!st) { st = document.createElement('style'); st.id = 'probe'; document.head.appendChild(st); }
      st.textContent = '.bubbles{display:none}';
    }, theme);
    await p.waitForTimeout(400);
    return PNG.sync.read(await p.locator('.hero__title').screenshot());
  };
  // Снимок темы с возможной подменой цвета точек градиента.
  const shotColored = async (theme, colors) => {
    await p.evaluate(([t, cc]) => {
      document.documentElement.dataset.theme = t;
      document.documentElement.style.colorScheme = t;
      let st = document.getElementById('probe');
      if (!st) { st = document.createElement('style'); st.id = 'probe'; document.head.appendChild(st); }
      // Холст пузырей лежит прямо за названием. Точки полупрозрачные
      // и на каждой загрузке стоят в новом месте, поэтому с фоном
      // светлой и тёмной темы они складываются по-разному и попадают
      // в снимок как «сдвиг штриха»: наибольший сдвиг скакал до
      // 3,8 css-px и менялся от прогона к прогону. Здесь мерится
      // геометрия букв, а не фон под ними — холст убираем.
      const hide = '.bubbles{display:none}';
      st.textContent = hide + (cc ? `.hero__title{--c-title-edge:${cc[0]};--c-title-mid:${cc[1]}}` : '');
    }, [theme, colors]);
    await p.waitForTimeout(400);
    return PNG.sync.read(await p.locator('.hero__title').screenshot());
  };

  const light = await shot('light');
  const dark = await shot('dark');

  const compare = (a, bImg, tag, limitAvg, limitShift = 1.0) => {
    const W = Math.min(a.width, bImg.width), H = Math.min(a.height, bImg.height);
    if (a.width !== bImg.width || a.height !== bImg.height) {
      console.log(`      НЕТ размер снимков разный: ${a.width}x${a.height} и ${bImg.width}x${bImg.height}`);
      return false;
    }

    // Фон берём как самый частый цвет снимка, а не угловой пиксель:
    // под заголовком лежит неровная подложка блока, и угол оказался
    // темнее основной массы — на нём измерение сходило с ума.
    const bgOf = (png) => {
      const bins = new Map();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (y * png.width + x) * 4;
        const k = (png.data[o] >> 2) * 4096 + (png.data[o + 1] >> 2) * 64 + (png.data[o + 2] >> 2);
        bins.set(k, (bins.get(k) || 0) + 1);
      }
      let bk = 0, bn = -1;
      for (const [k, n] of bins) if (n > bn) { bn = n; bk = k; }
      return [((bk >> 12) & 63) * 4 + 2, ((bk >> 6) & 63) * 4 + 2, (bk & 63) * 4 + 2];
    };

    // Покрытие краской: 0 — чистый фон, 1 — полная краска. Нормируем
    // по окну столбцов: заголовок градиентный, и краска у разных букв
    // разной силы — общий максимум занизил бы покрытие светлых мест.
    const cover = (png) => {
      const bg = bgOf(png);
      const d = new Float64Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (y * png.width + x) * 4;
        d[y * W + x] = Math.abs(png.data[o] - bg[0]) + Math.abs(png.data[o + 1] - bg[1]) + Math.abs(png.data[o + 2] - bg[2]);
      }
      const win = 6 * SCALE;
      const colMax = new Float64Array(W);
      for (let x = 0; x < W; x++) { let m = 0; for (let y = 0; y < H; y++) if (d[y * W + x] > m) m = d[y * W + x]; colMax[x] = m; }
      const loc = new Float64Array(W);
      for (let x = 0; x < W; x++) { let m = 1;
        for (let k = Math.max(0, x - win); k <= Math.min(W - 1, x + win); k++) if (colMax[k] > m) m = colMax[k];
        loc[x] = m; }
      const out = new Float64Array(W * H);
      for (let i = 0; i < W * H; i++) out[i] = Math.min(1, d[i] / loc[i % W]);
      return out;
    };
    const ca = cover(a), cb = cover(bImg);

    // Площадь тела штриха: пиксели с покрытием от половины и выше.
    const bodyOf = (v) => { let n = 0; for (let i = 0; i < v.length; i++) if (v[i] >= 0.5) n++; return n; };
    const ia = bodyOf(ca), ib = bodyOf(cb);

    // Видимая граница штриха — переход покрытия через 0,5.
    // Границы ищутся построчно и сопоставляются по близости,
    // иначе одна лишняя точка сдвигает весь список.
    let worst = 0, sum = 0, cnt = 0;
    for (let y = 0; y < H; y++) {
      const row = (v) => { const e = [];
        for (let x = 1; x < W; x++) { const p0 = v[y * W + x - 1], p1 = v[y * W + x];
          if ((p0 < 0.5) !== (p1 < 0.5)) e.push(x - 1 + (0.5 - p0) / (p1 - p0)); } return e; };
      const ea = row(ca), eb = row(cb);
      for (const v of ea) {
        let best = Infinity;
        for (const u of eb) { const q = Math.abs(u - v); if (q < best) best = q; }
        if (best < 4 * SCALE) { sum += best; cnt++; if (best > worst) worst = best; }
      }
    }

    // Нижняя точка краски — длина хвоста «р» на просвет.
    const lowest = (v) => { let last = -1;
      for (let y = 0; y < H; y++) { let t = 0; for (let x = 0; x < W; x++) t += v[y * W + x]; if (t > 0.5) last = y; } return last; };
    const la = lowest(ca), lb = lowest(cb);

    const shift = worst / SCALE, avg = (sum / (cnt || 1)) / SCALE;
    const dBody = Math.abs(ib - ia) / ia * 100;
    // Вердикт по СРЕДНЕМУ сдвигу, а не по наибольшему. Наибольший —
    // максимум по паре тысяч точек, он растёт с числом точек и не
    // сходится: на прежней палитре контрольная пара давала по нему
    // 0.694 css-px при пороге 0.35, то есть шум метода уже был выше
    // порога и проверка проходила по везению. Средний сходится.
    //
    // Ловится этой проверкой смена СПОСОБА отрисовки: когда одна тема
    // красила текст напрямую, а другая обрезанным фоном, средний сдвиг
    // был 0.225 css-px, тело штрихов худело на 0.3 %, а хвост «р» менял
    // длину. Сейчас способ один, и остаётся только разница сглаживания
    // от разного цвета краски — она на два порядка меньше.
    const ok = avg <= limitAvg && shift <= limitShift && Math.abs(la - lb) === 0 && dBody <= 0.1;
    console.log(`    ${ok ? 'ok ' : 'НЕТ'} ${tag}: снимок ${W}x${H}`);
    console.log(`        тело штрихов ${ia} и ${ib} px, разница ${dBody.toFixed(3)} %`);
    console.log(`        сдвиг границ (${cnt} точек): наибольший ${shift.toFixed(3)} css-px, средний ${avg.toFixed(3)} css-px`);
    console.log(`        нижняя точка краски ${la} и ${lb}, разница ${Math.abs(la - lb)} px снимка`);
    return ok;
  };

  // Контроль: та же тема и та же геометрия, меняется только цвет
  // краски. Всё, что тут намерялось, — шум округления сглаживания
  // до восьми бит, ниже него измерение опуститься не может.
  const ctlA = await shotColored('light', null);
  // Цвет подменяется на РАВНЫЙ ПО СВЕТЛОТЕ (0.0708 против 0.0707
  // у #2e5428), просто другого тона. Пара разной светлоты
  // обесценивает контроль: покрытие краской считается порогом,
  // и бледный цвет на бежевом даёт меньше «краски» сам по себе.
  const ctlB = await shotColored('light', ['#71385a', '#71385a']);
  console.log(`  dpr ${SCALE}, контроль — один способ отрисовки, разный цвет:`);
  const floor = compare(ctlA, ctlB, 'шум цвета', 99, 99);

  console.log(`  dpr ${SCALE}, светлая против тёмной:`);
  if (!compare(light, dark, 'темы', 0.05)) bad++;
  await c.close();
}

console.log(bad ? 'ГЕОМЕТРИЯ ГЛИФОВ РАСХОДИТСЯ' : 'Геометрия глифов совпадает');
await b.close();
process.exit(bad ? 1 : 0);
