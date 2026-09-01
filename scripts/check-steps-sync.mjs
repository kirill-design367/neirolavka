/**
 * Дорожка шагов: совпадает ли вспышка цифры с положением светодиода.
 *
 * Это главная проверка блока, и она отвечает на три отдельных вопроса.
 *
 *  1. КРАЙ ЗАЛИВКИ = ЦЕНТР КАПЛИ. Заливка растёт масштабом из того же
 *     `--led-pos`, что задаёт положение капли, поэтому расхождение
 *     возможно только от ошибки в геометрии.
 *
 *  2. ЦИФРА ГОРИТ ТОГДА И ТОЛЬКО ТОГДА, когда капля лежит на ней.
 *     Проверяется по ВСЕМУ циклу, а не в одной точке: для каждой пробы
 *     сравнивается состояние заливки цифры с расстоянием от капли.
 *     Ложное «горит» на расстоянии и ложное «не горит» под каплей
 *     ловятся одинаково.
 *
 *  3. ДО ПРИХОДА КАПЛИ ЦИФРА НЕ СВЕТИТСЯ — и это меряется ПО ПИКСЕЛЯМ,
 *     а не по вычисленным стилям. Свечение вокруг цифры лежит кольцом
 *     снаружи заливки, и по одному `background-color` преждевременного
 *     разгорания не увидеть вовсе. Берётся половина круга с той
 *     стороны, КУДА капля ещё не дошла: так в замер не попадает свет
 *     самой капли.
 *
 * Время прокручивается вручную по единственной анимации блока —
 * `led-run` на `.steps__thread`. Второго расписания в блоке нет
 * по построению, поэтому и синхронизировать пробу больше не с чем.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let bad = 0;
const ok = (t) => console.log(`  ok   ${t}`);
const no = (t) => { bad++; console.log(`  НЕТ  ${t}`); };
const info = (t) => console.log(`  —    ${t}`);

const browser = await chromium.launch({ executablePath: CHROME });

const VIEWS = [
  { name: 'десктоп 1512, светлая', w: 1512, theme: 'light' },
  { name: 'десктоп 1512, тёмная', w: 1512, theme: 'dark' },
  { name: 'телефон 390, светлая', w: 390, theme: 'light' },
];

for (const vp of VIEWS) {
  console.log(`\n── ${vp.name} ──`);
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: 900 },
    locale: 'ru-RU',
    isMobile: vp.w < 500,
    hasTouch: vp.w < 500,
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), vp.theme);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('.steps').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1400);

  // Единственная анимация цикла. Дыхание ореола живёт своей
  // длительностью и в разбор времени не идёт.
  const est = await page.evaluate(() => {
    const th = document.querySelector('.steps__thread');
    const a = th.getAnimations().find((x) => x.animationName === 'led-run');
    return !!a;
  });
  if (!est) { no('анимации led-run на .steps__thread нет — проба устарела'); await ctx.close(); continue; }

  const geom = await page.evaluate(() => {
    const th = document.querySelector('.steps__thread');
    const base = th.getBoundingClientRect();
    const cs = getComputedStyle(th);
    const horiz = th.dataset.trackDir === 'horizontal';
    const nodes = [...document.querySelectorAll('.step__node')];
    const along = (r) => (horiz ? r.x + r.width / 2 - base.x : r.y + r.height / 2 - base.y);
    return {
      horiz,
      len: parseFloat(cs.getPropertyValue('--track-len')),
      flash: parseFloat(cs.getPropertyValue('--flash')),
      cycle: parseFloat(cs.getPropertyValue('--cycle')) * 1000,
      nodes: nodes.map((n) => along(n.getBoundingClientRect())),
      at: nodes.map((n) => parseFloat(getComputedStyle(n.closest('.step')).getPropertyValue('--at'))),
      nodeSize: nodes[0].getBoundingClientRect().width,
    };
  });
  const flashPx = geom.flash * geom.len;
  if (!Number.isFinite(flashPx) || !Number.isFinite(geom.cycle)) {
    no('геометрия не прочиталась — проба устарела');
    await ctx.close();
    continue;
  }
  info(`дорожка ${geom.horiz ? 'горизонтальная' : 'вертикальная'} ${geom.len.toFixed(1)} px, ` +
       `цифры на ${geom.nodes.map((v) => v.toFixed(0)).join('/')} px, ` +
       `полуокно вспышки ${flashPx.toFixed(1)} px`);

  // ── Прогон по циклу ──────────────────────────────────────────
  const N = 240;
  const rows = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * geom.cycle;
    rows.push(await page.evaluate(([tt]) => {
      const th = document.querySelector('.steps__thread');
      const a = th.getAnimations().find((x) => x.animationName === 'led-run');
      a.pause();
      a.currentTime = tt;
      const base = th.getBoundingClientRect();
      const horiz = th.dataset.trackDir === 'horizontal';
      const along = (r) => (horiz ? r.x + r.width / 2 - base.x : r.y + r.height / 2 - base.y);
      const edge = (r) => (horiz ? r.right - base.x : r.bottom - base.y);
      const led = document.querySelector('.steps__led').getBoundingClientRect();
      const fill = document.querySelector('.steps__track-fill').getBoundingClientRect();
      return {
        t: tt,
        pos: parseFloat(getComputedStyle(th).getPropertyValue('--led-pos')),
        ledOn: parseFloat(getComputedStyle(th).getPropertyValue('--led-on')),
        led: along(led),
        fillEdge: edge(fill),
        hit: [...document.querySelectorAll('.step__node')].map(
          (n) => parseFloat(getComputedStyle(n).getPropertyValue('--hit')),
        ),
      };
    }, [t]));
  }

  // 1. Край заливки против центра капли — только пока капля на дорожке.
  let worstFill = 0;
  for (const r of rows) {
    if (r.pos > 1 || r.ledOn < 1) continue;
    worstFill = Math.max(worstFill, Math.abs(r.fillEdge - r.led));
  }
  if (worstFill > 1.5) no(`край заливки расходится с центром капли до ${worstFill.toFixed(2)} px`);
  else ok(`край заливки и центр капли совпадают в ${worstFill.toFixed(2)} px`);

  // 2. Горит тогда и только тогда, когда капля лежит на цифре.
  //    Допуск в полпикселя — на округление коробок.
  // Если --hit не зарегистрировано, computed-значение остаётся строкой
  // и parseFloat даёт NaN. NaN не больше и не меньше порога, поэтому
  // ВСЕ сравнения ниже проходят молча. Ловим это отдельно.
  if (rows.some((r) => r.hit.some((h) => !Number.isFinite(h)))) {
    no('--hit не читается числом — свойство не зарегистрировано, проверка ничего не измерит');
    await ctx.close();
    continue;
  }
  let lozh = 0;
  let propusk = 0;
  const shag = geom.cycle / N;
  const okna = geom.nodes.map(() => ({ n: 0 }));
  for (const r of rows) {
    r.hit.forEach((h, i) => {
      const d = Math.abs(r.led - geom.nodes[i]);
      const dolzhen = d <= flashPx - 0.5;
      const nelzya = d >= flashPx + 0.5;
      if (h > 0.5 && nelzya) lozh++;
      if (h < 0.5 && dolzhen) propusk++;
      // Считаем ПРОБЫ, а не «первую и последнюю»: у первой цифры свет
      // рождается прямо на ней, её окно разрезано началом цикла,
      // и разница «последняя минус первая» дала бы весь цикл.
      if (h > 0.5 && r.t < 0.999 * 5600) okna[i].n = (okna[i].n ?? 0) + 1;
    });
  }
  if (lozh) no(`${lozh} проб из ${rows.length * 3}: цифра горит, а капли рядом нет`);
  else ok('ложных вспышек нет: цифра ни разу не загорелась вдали от капли');
  if (propusk) no(`${propusk} проб: капля лежит на цифре, а та не горит`);
  else ok('пропусков нет: под каплей цифра горит всегда');

  const dlit = okna.map((o) => o.n * shag);
  // Первая цифра стоит особняком и это не поломка: свет РОЖДАЕТСЯ
  // на ней, поэтому «до» у неё нет и окно вдвое короче. Сравниваются
  // остальные — у них проход полный.
  const ostalnye = dlit.slice(1);
  const razbros = Math.max(...ostalnye) - Math.min(...ostalnye);
  const zhdem = (2 * flashPx / geom.len) * geom.cycle * 0.78;
  info(`вспышки длятся ${dlit.map((d) => Math.round(d)).join(' / ')} мс ` +
       `(расчётное окно ${Math.round(zhdem)} мс; у первой цифры оно вдвое короче — свет рождается на ней)`);
  if (razbros > shag * 2) no(`длительность вспышек разъезжается на ${Math.round(razbros)} мс`);
  else ok(`вспышки после первой одной длины (разброс ${Math.round(razbros)} мс при шаге замера ${Math.round(shag)})`);
  if (Math.abs(ostalnye[0] - zhdem) > zhdem * 0.2) {
    no(`вспышка ${Math.round(ostalnye[0])} мс против расчётных ${Math.round(zhdem)} — окно не то, что объявлено`);
  }

  // 3. До прихода капли цифра не светится — по пикселям.
  //
  //    СВЕТОДИОД НА ВРЕМЯ ЗАМЕРА ПРЯЧЕТСЯ. Иначе меряется не то:
  //    у капли есть свой ореол в два десятка пикселей, он въезжает
  //    в коробку цифры раньше самой капли, и проверка объявляет
  //    преждевременный свет там, где светит сама капля. Прячем —
  //    и в коробке остаётся только собственный свет цифры.
  const snimok = async (tt, box) => {
    await page.evaluate(([t]) => {
      const th = document.querySelector('.steps__thread');
      const a = th.getAnimations().find((x) => x.animationName === 'led-run');
      a.pause();
      a.currentTime = t;
      document.querySelector('.steps__led').style.visibility = 'hidden';
    }, [tt]);
    return PNG.sync.read(await page.screenshot({ clip: box }));
  };
  const yark = (png) => {
    let sum = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
    }
    return sum / (png.data.length / 4);
  };

  const speed = geom.len / (geom.cycle * 0.78); // px на мс
  const rano = [];
  for (let i = 1; i < geom.nodes.length; i++) {
    const box = await page.evaluate(([k]) => {
      const n = document.querySelectorAll('.step__node')[k].getBoundingClientRect();
      const pad = 12;
      return { x: Math.round(n.x - pad), y: Math.round(n.y - pad),
               width: Math.round(n.width + pad * 2), height: Math.round(n.height + pad * 2) };
    }, [i]);
    const prihod = (geom.at[i] * 0.78) * geom.cycle;
    // Опора — заведомо далеко: полдороги назад.
    const opora = await snimok(Math.max(0, prihod - (geom.len / 2) / speed), box);
    const base = yark(opora);
    let pervyy = null;
    for (let px = 90; px >= 0; px -= 2) {
      const t = prihod - px / speed;
      if (t < 0) continue;
      const img = await snimok(t, box);
      if (Math.abs(yark(img) - base) > 2) { pervyy = px; break; }
    }
    rano.push({ i, px: pervyy });
    await page.evaluate(() => { document.querySelector('.steps__led').style.visibility = ''; });
  }
  // Порог — ОБЪЯВЛЕННОЕ окно плюс допуск, а не ноль. Цифра загорается,
  // когда капля ЛЕЖИТ на ней, то есть за flashPx до совпадения центров;
  // при полудлине капли в 11 px её передняя кромка к этому моменту уже
  // внутри цифры. Ноль здесь означал бы «загорается, когда капля
  // проехала половину цифры» — это поздно, а не вовремя.
  const predel = flashPx + 4;
  const hudshiy = Math.max(...rano.map((r) => (r.px === null ? 0 : r.px)));
  const stroka = rano.map((r) => `цифра ${r.i + 1}: ${r.px === null ? 'не светится вовсе' : r.px + ' px'}`).join(', ');
  if (hudshiy > predel) {
    no(`цифра светится РАНЬШЕ объявленного окна (${flashPx.toFixed(0)} px) — ${stroka}, шаг замера 2 px`);
  } else {
    ok(`свет цифры начинается ровно в объявленном окне ${flashPx.toFixed(0)} px: ${stroka} (шаг замера 2 px)`);
  }

  await ctx.close();
}

await browser.close();
console.log(bad ? '\nДОРОЖКА ШАГОВ РАБОТАЕТ НЕ ТАК' : '\nВспышка идёт за каплей: ложных срабатываний нет, преждевременного света нет');
process.exit(bad ? 1 : 0);
