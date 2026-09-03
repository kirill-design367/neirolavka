/**
 * Дорожка шагов: совпадает ли вспышка цифры с положением светодиода.
 *
 * Это главная проверка блока, и она отвечает на три отдельных вопроса.
 *
 *  1. КРАЙ ЗАЛИВКИ = ЦЕНТР КАПЛИ. Заливка растёт масштабом из того же
 *     `--led-pos`, что задаёт положение капли, поэтому расхождение
 *     возможно только от ошибки в геометрии.
 *
 *  2. ЦИФРА ЗАГОРАЕТСЯ, КОГДА КАПЛЯ ДО НЕЁ ДОШЛА, И ГОРИТ ДО КОНЦА
 *     ЦИКЛА. Окно одностороннее, поэтому расстояние сравнивается
 *     со знаком: слева от цифры дальше полуокна — обязана быть
 *     тёмной, всё остальное — гореть. Отдельной пробой — что ряд
 *     «горит» это СПЛОШНОЙ хвост цикла: мигание, повторное загорание
 *     и раннее гашение ловятся ею одинаково. Плюс порядок загорания
 *     и счёт горящих в начале и в конце цикла.
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
  // Холст пузырей закреплён по окну и виден на любой высоте прокрутки,
  // поэтому он попадает в КАЖДЫЙ снимок этой проверки. Пузыри плывут
  // сами по себе, и разница между опорным снимком и пробным набирается
  // их дрейфом, а не светом цифры: порог в 2 уровня из 255 такой дрейф
  // перекрывает без труда. Прячем на ВСЁ время замера, а не между
  // снимками, — иначе проверка объявляет преждевременное свечение там,
  // где через коробку цифры просто проехал пузырь.
  await page.addStyleTag({ content: 'canvas.bubbles{display:none!important}' });
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
        // Края коробки капли вдоль оси — по ним проверяется, что она
        // не выезжает за последнюю цифру.
        ledLo: horiz ? led.x - base.x : led.y - base.y,
        ledHi: horiz ? led.right - base.x : led.bottom - base.y,
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

  // 1б. Капля не выезжает за крайние цифры.
  //
  // Часы идут до 1.079 — на 40 px дальше последней цифры, — и раньше
  // видимая капля уезжала туда вместе с ними: выкатывалась вправо
  // из-под цифры 3 и доугасала рядом с ней в пустоте. Проверять это
  // было нечем, поймал глаз владельца. Теперь сдвиг ограничен
  // min(--led-pos, 1), и проба стережёт границу с обеих сторон:
  // коробка капли обязана оставаться внутри кружков крайних цифр
  // на ВСЕХ кадрах, где капля хоть сколько-нибудь видна.
  //
  // Мерится коробка, а не центр: вылезает именно край. Допуск
  // в полпикселя — на округление коробок.
  {
    const lo = geom.nodes[0] - geom.nodeSize / 2;
    const hi = geom.nodes[geom.nodes.length - 1] + geom.nodeSize / 2;
    // Начальное значение — минус бесконечность, а не ноль. С нулём
    // максимум никогда не опускается ниже него, и «запас» печатался
    // бы как 0.0 px при любом фактическом запасе: вердикт верный,
    // число бессмысленное.
    let vylez = -Infinity;
    let kadrov = 0;
    for (const r of rows) {
      if (r.ledOn <= 0) continue;
      kadrov++;
      vylez = Math.max(vylez, lo - r.ledLo, r.ledHi - hi);
    }
    if (!kadrov) no('капля не видна ни на одном кадре — проверять нечего');
    else if (vylez > 0.5) no(`капля выезжает за крайнюю цифру на ${vylez.toFixed(1)} px (${kadrov} кадров, где она видна)`);
    else ok(`капля не выходит за крайние цифры: запас ${(-vylez).toFixed(1)} px на ${kadrov} видимых кадрах`);
  }

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
  // Положение СВЕТА берётся из часов, а не из коробки капли, и это
  // не придирка к формулировке.
  //
  // Видимая капля намеренно не выезжает за последнюю цифру: её сдвиг
  // ограничен min(--led-pos, 1), тогда как сами часы идут до 1.079 —
  // по ним считается, когда вспышка ПОГАСНЕТ, и без запаса последняя
  // цифра горела бы до конца цикла, то есть дольше первых двух.
  // На последних двадцати процентах цикла коробка стоит на цифре,
  // а свет по часам с неё уже сошёл; проба, читающая коробку,
  // объявляла это поломкой 48 раз подряд — при том, что увидеть
  // «свет на погасшей цифре» нельзя: непрозрачный кружок узла
  // (32 px) полностью накрывает остановившуюся каплю (14 px).
  // Проверять надо утверждение «цифра горит ровно тогда, когда
  // на ней свет», а свет — это часы.
  const svet = (r) => geom.nodes[0] + r.pos * geom.len;
  // Окно у цифры ОДНОСТОРОННЕЕ: она загорается, когда передняя кромка
  // капли доходит до неё, и остаётся зелёной до конца цикла. Поэтому
  // сравнивается расстояние СО ЗНАКОМ, а не по модулю: слева от цифры
  // дальше полуокна — обязана быть тёмной, всё остальное — гореть.
  const vzyato = rows.slice(0, rows.length - 1); // последняя проба — уже начало следующего цикла
  for (const r of vzyato) {
    r.hit.forEach((h, i) => {
      const d = svet(r) - geom.nodes[i];
      const dolzhen = d >= -flashPx + 0.5;
      const nelzya = d <= -flashPx - 0.5;
      if (h > 0.5 && nelzya) lozh++;
      if (h < 0.5 && dolzhen) propusk++;
    });
  }
  if (lozh) no(`${lozh} проб из ${vzyato.length * 3}: цифра горит, а капля до неё ещё не дошла`);
  else ok('преждевременных загораний нет: цифра ни разу не зажглась перед каплей');
  if (propusk) no(`${propusk} проб: капля цифру прошла, а та не горит`);
  else ok('пропусков нет: после прохода капли цифра горит');

  // Загоревшаяся цифра не имеет права погаснуть до конца цикла.
  // Проверяется формой ряда, а не длительностью: пробы, где цифра
  // горит, обязаны быть СПЛОШНЫМ хвостом цикла. Мигание, повторное
  // загорание и раннее гашение ловятся этим одинаково.
  {
    const momenty = [];
    let rvano = 0;
    for (let i = 0; i < geom.nodes.length; i++) {
      const ryad = vzyato.map((r) => r.hit[i] > 0.5);
      const s0 = ryad.indexOf(true);
      if (s0 < 0) { no(`цифра ${i + 1} не загорается за цикл ни разу`); rvano++; continue; }
      if (ryad.slice(s0).some((v) => !v)) rvano++;
      momenty.push(Math.round(s0 * shag));
    }
    if (rvano) no(`${rvano} цифр гаснут до конца цикла или загораются повторно`);
    else ok(`каждая цифра, загоревшись, горит до конца цикла`);
    info(`загораются на ${momenty.join(' / ')} мс от начала цикла (цикл ${Math.round(geom.cycle)} мс)`);
    // Загораться обязаны ПО ОЧЕРЕДИ: иначе это не пройденный путь.
    const poporyadku = momenty.every((v, i) => i === 0 || v > momenty[i - 1]);
    poporyadku ? ok('цифры загораются по очереди, в порядке хода капли')
               : no(`порядок загорания сбит: ${momenty.join(' / ')} мс`);
    // К концу цикла горят все, в начале — только первая (свет
    // рождается на ней).
    const konec = vzyato[vzyato.length - 1].hit.filter((h) => h > 0.5).length;
    const nachalo = vzyato[0].hit.filter((h) => h > 0.5).length;
    konec === geom.nodes.length ? ok(`к концу цикла горят все ${konec}`)
                                : no(`к концу цикла горят ${konec} из ${geom.nodes.length}`);
    nachalo === 1 ? ok('в начале цикла горит только первая — свет рождается на ней')
                  : no(`в начале цикла горят ${nachalo} цифр вместо одной`);
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
