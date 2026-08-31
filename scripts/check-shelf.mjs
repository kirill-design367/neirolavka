/**
 * Витрина продуктов: три карточки по дуге в трёхмерной сцене плюс
 * слой настоящего HTML поверх неё.
 *
 * Проверка отвечает на четыре вопроса, и на каждый — числом:
 *
 *   1. Карточки стоят В СВОЁМ БЛОКЕ. Это не придирка: слой HTML
 *      получает матрицу от камеры, и одна перепутанная перестановка
 *      в списке transform уводит всю тройку на пятьсот пикселей вверх,
 *      на первый экран. Выглядит это как «карточки поверх заголовка»,
 *      а ни проверка разрешений, ни проверка контраста этого не ловят:
 *      по горизонтали ничего не вылезает и контраст в порядке.
 *   2. Текст остаётся текстом. Названия, сроки и цены должны читаться
 *      из DOM, а не быть точками внутри WebGL.
 *   3. Выбор работает: нажатие раскрывает тарифы своей карточки,
 *      закрывает чужие и доезжает до панели заказа.
 *   4. Без WebGL и при выключенном движении остаётся плоская витрина,
 *      на которой всё это по-прежнему можно сделать.
 *
 * Запуск: node scripts/check-shelf.mjs <url>
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
if (!URL) { console.error('нужен адрес'); process.exit(2); }

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;
const ok = (s) => console.log(`  ok   ${s}`);
const no = (s) => { bad++; console.log(`  НЕТ  ${s}`); };

/** Разбудить отложенную загрузку: сцена ждёт первого действия человека. */
const wake = async (page) => {
  await page.mouse.move(60, 200);
  await page.mouse.move(64, 204);
  await page.evaluate(() => document.querySelector('.shop').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1800);
};

const geometry = async (page) => page.evaluate(() => {
  const root = document.querySelector('.shelf3d');
  const r = root.getBoundingClientRect();
  return {
    d3: root.hasAttribute('data-3d'),
    box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    cards: [...document.querySelectorAll('.pcard')].map((el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height };
    }),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});

// ─── Объёмная витрина: геометрия, текст, выбор ─────────────────────
for (const [w, h, phone] of [[1512, 900, false], [1920, 1080, false], [390, 844, true]]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h }, locale: 'ru-RU', isMobile: phone, hasTouch: phone,
    });
    await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await wake(page);

    console.log(`\n── ${w}×${h}, ${theme === 'light' ? 'светлая' : 'тёмная'} ──`);
    const g = await geometry(page);
    if (!g.d3) { no('сцена не поднялась — здесь она должна быть'); await ctx.close(); continue; }

    // 1. Карточки в своём блоке. Запас в 24 px — на подъём выбранной
    //    карточки и мягкий край тени; уход на сотни пикселей это ловит.
    const out = g.cards
      .map((c, i) => ({ i, up: g.box.top - c.top, down: c.bottom - g.box.bottom }))
      .filter((c) => c.up > 24 || c.down > 24);
    if (out.length) {
      for (const c of out) no(`карточка ${c.i + 1} вне блока: сверху ${c.up.toFixed(0)} px, снизу ${c.down.toFixed(0)} px`);
    } else {
      const up = Math.max(...g.cards.map((c) => g.box.top - c.top));
      const down = Math.max(...g.cards.map((c) => c.bottom - g.box.bottom));
      ok(`все три карточки внутри блока: наибольший выход сверху ${up.toFixed(0)} px, снизу ${down.toFixed(0)} px`);
    }
    if (g.overflow > 0) no(`страница шире экрана на ${g.overflow} px`); else ok('по горизонтали ничего не вылезает');

    // Карточки не должны сливаться в одну кучу: при раскладке по дуге
    // и стопкой соседи стоят врозь.
    const pairs = [];
    for (let i = 0; i < g.cards.length; i++) for (let j = i + 1; j < g.cards.length; j++) {
      const a = g.cards[i], b = g.cards[j];
      const dx = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const dy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const share = (dx * dy) / Math.min(a.w * a.h, b.w * b.h);
      pairs.push(share);
    }
    const worst = Math.max(...pairs);
    if (worst > 0.5) no(`карточки перекрывают друг друга на ${(worst * 100).toFixed(0)} % площади`);
    else ok(`соседи различимы: наибольшее перекрытие ${(worst * 100).toFixed(0)} % площади`);

    // 2. Текст остаётся текстом.
    const texts = await page.evaluate(() => ({
      names: [...document.querySelectorAll('.pcard__name')].map((e) => e.textContent.trim()),
      prices: [...document.querySelectorAll('.tariff__price')].map((e) => e.textContent.trim()),
      selectable: getComputedStyle(document.querySelector('.pcard__name')).userSelect !== 'none',
    }));
    if (texts.names.length === 3 && texts.names.every((t) => t.length > 2)) ok(`названия читаются из DOM: ${texts.names.join(', ')}`);
    else no(`названий в DOM ${texts.names.length}: ${JSON.stringify(texts.names)}`);
    if (texts.prices.length >= 1 && texts.prices.every((t) => /\d/.test(t))) ok(`цены — текст: ${texts.prices.join(' · ')}`);
    else no(`цены не читаются: ${JSON.stringify(texts.prices)}`);

    // 3. Наведение выводит боковую карточку вперёд и возвращает назад.
    if (!phone) {
      const side = page.locator('.pcard').nth(2);
      const before = (await side.boundingBox()).width;
      await side.hover();
      await page.waitForTimeout(1100);
      const during = (await side.boundingBox()).width;
      await page.mouse.move(4, 4);
      await page.waitForTimeout(1100);
      const after = (await side.boundingBox()).width;
      const grow = during / before - 1;
      const back = Math.abs(after / before - 1);
      // Нижняя граница обязательна: без неё «карточка не двинулась»
      // засчиталось бы как «двинулась плавно».
      if (grow > 0.03 && back < 0.02) ok(`наведение выводит карточку вперёд: ширина +${(grow * 100).toFixed(1)} %, возврат в ${(back * 100).toFixed(1)} %`);
      else no(`наведение: ширина +${(grow * 100).toFixed(1)} % (нужно >3 %), возврат ${(back * 100).toFixed(1)} % (нужно <2 %)`);
    }

    // 4. Выбор: нажатие раскрывает тарифы своей карточки и закрывает чужие.
    await page.locator('.pcard').nth(1).locator('.pcard__face').click();
    await page.waitForTimeout(900);
    const open = await page.evaluate(() => [...document.querySelectorAll('.pcard')]
      .map((c) => !c.querySelector('.pcard__plans').hidden));
    if (open.filter(Boolean).length === 1 && open[1]) ok('раскрыта ровно одна карточка — та, по которой нажали');
    else no(`раскрыто карточек: ${JSON.stringify(open)}`);

    await page.locator('.pcard--active .tariff').first().click();
    await page.waitForTimeout(700);
    // Панель заказа на телефоне — полоса внизу, на широком экране —
    // чек справа. Берём обе и печатаем то, что нашлось: пустая строка
    // в отчёте о пройденной проверке ничем не лучше упавшей проверки.
    const order = await page.evaluate(() => {
      const t = (sel) => document.querySelector(sel)?.innerText ?? '';
      return `${t('.order__paper')} ${t('.bar')}`.replace(/\s+/g, ' ').trim();
    });
    if (/ChatGPT/.test(order) && /₽/.test(order)) ok(`выбор доехал до панели заказа: ${order.slice(0, 90)}`);
    else no(`панель заказа не приняла выбор: ${JSON.stringify(order.slice(0, 120))}`);

    if (errors.length) no(`ошибок в консоли ${errors.length}: ${errors[0]}`); else ok('ошибок в консоли нет');
    await ctx.close();
  }
}

// ─── Нажатие не должно разбирать сцену ─────────────────────────────
//
// Отдельная проверка, потому что поломка была именно такой и её
// не видно ни по геометрии, ни по контрасту, ни по разрешениям.
// activeIndex стоял в списке зависимостей эффекта, поднимающего сцену,
// и каждое нажатие по карточке разбирало её и собирало заново: на
// мгновение показывалась плоская вёрстка — три одинаковые карточки
// в ряд, — а сцена возвращалась только после следующего движения мыши.
//
// Смотрим не «стало ли в итоге хорошо», а весь промежуток: атрибут
// data-3d слушается наблюдателем, поэтому мигание между пробами
// тоже попадётся.
for (const [w, h, phone] of [[1512, 900, false], [390, 844, true]]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, locale: 'ru-RU', isMobile: phone, hasTouch: phone,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await wake(page);
  console.log(`\n── нажатие по карточке, ${w}×${h} ──`);

  if (!(await page.evaluate(() => document.querySelector('.shelf3d').hasAttribute('data-3d')))) {
    no('сцена не поднялась — проверять нечего');
    await ctx.close();
    continue;
  }

  // Выбираем тариф у текущей карточки: он должен уехать в чек,
  // а после смены продукта — смениться, но не из-за пересборки сцены.
  await page.locator('.pcard--active .tariff').first().click();
  await page.waitForTimeout(800);

  // Наблюдатель за data-3d: ловит и то, что происходит между пробами.
  await page.evaluate(() => {
    window.__d3log = [];
    const root = document.querySelector('.shelf3d');
    new MutationObserver(() => window.__d3log.push(root.hasAttribute('data-3d')))
      .observe(root, { attributes: true, attributeFilter: ['data-3d'] });
  });

  const state = () => page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pcard')];
    const wid = cards.map((c) => Math.round(c.getBoundingClientRect().width));
    return {
      d3: document.querySelector('.shelf3d').hasAttribute('data-3d'),
      open: cards.map((c) => !c.querySelector('.pcard__plans').hidden),
      active: cards.findIndex((c) => c.classList.contains('pcard--active')),
      // Плоская вёрстка выдаёт себя одинаковой шириной всех трёх
      // карточек: в сцене они на разной глубине и равными быть не могут.
      flat: new Set(wid).size === 1,
      matrix: cards.every((c) => c.style.transform.includes('matrix3d')),
      wid,
    };
  });

  const target = 2;
  await page.locator('.pcard').nth(target).locator('.pcard__face').click();

  const probes = [];
  for (const at of [100, 1500]) {
    await page.waitForTimeout(at - (probes.at(-1)?.at ?? 0));
    probes.push({ at, ...(await state()) });
  }
  // Мышь после нажатия — в поломанной версии именно она поднимала
  // сцену заново, и без неё блок так и оставался плоским.
  await page.mouse.move(w / 2, h / 2);
  await page.mouse.move(w / 2 + 6, h / 2 + 4);
  await page.waitForTimeout(1200);
  probes.push({ at: 2700, ...(await state()) });

  for (const s of probes) {
    const beda = [];
    if (!s.d3) beda.push('сцены нет (data-3d снят)');
    if (s.flat) beda.push(`плоская вёрстка: ширины ${s.wid.join('/')} одинаковы`);
    if (!s.matrix) beda.push('карточкам не выставлена matrix3d');
    if (s.open.filter(Boolean).length !== 1) beda.push(`раскрыто карточек ${s.open.filter(Boolean).length}`);
    if (s.active !== target) beda.push(`выбрана карточка ${s.active + 1}, а нажимали ${target + 1}`);
    if (beda.length) no(`+${s.at} мс: ${beda.join('; ')}`);
    else ok(`+${s.at} мс: сцена жива, раскрыта одна карточка (${s.active + 1}), ширины ${s.wid.join('/')}`);
  }

  const log = await page.evaluate(() => window.__d3log);
  if (log.length) no(`data-3d менялся ${log.length} раз(а) после нажатия: ${JSON.stringify(log)} — сцену пересобирают`);
  else ok('data-3d за всё время не дрогнул — сцену не пересобирали');

  const order = await page.evaluate(() => {
    const t = (sel) => document.querySelector(sel)?.innerText ?? '';
    return `${t('.order__paper')} ${t('.bar')}`.replace(/\s+/g, ' ').trim();
  });
  if (/Seedance/.test(order) || /Выберите|Пока пусто/.test(order)) ok('панель заказа в согласованном состоянии после смены продукта');
  else no(`панель заказа показывает чужое: ${JSON.stringify(order.slice(0, 120))}`);

  await ctx.close();
}

// ─── Плоская витрина: без WebGL и при выключенном движении ─────────
for (const [label, opts, init] of [
  ['без WebGL', {}, () => {
    HTMLCanvasElement.prototype.getContext = function () { return null; };
  }],
  ['выключенное движение', { reducedMotion: 'reduce' }, null],
]) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU', ...opts });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await wake(page);
  console.log(`\n── ${label} ──`);

  const g = await geometry(page);
  if (g.d3) no('сцена поднялась там, где её быть не должно');
  else ok('объёма нет — остаётся плоская витрина');
  if (g.cards.length === 3) ok('все три карточки на месте'); else no(`карточек ${g.cards.length}`);

  await page.locator('.pcard').nth(2).locator('.pcard__face').click();
  await page.waitForTimeout(500);
  await page.locator('.pcard--active .tariff').first().click();
  await page.waitForTimeout(500);
  const order = await page.evaluate(() => {
    const t = (sel) => document.querySelector(sel)?.innerText ?? '';
    return `${t('.order__paper')} ${t('.bar')}`.replace(/\s+/g, ' ').trim();
  });
  if (/Seedance/.test(order)) ok(`тариф выбирается и без сцены: ${order.slice(0, 90)}`);
  else no(`выбор не работает: ${JSON.stringify(order.slice(0, 120))}`);

  const plans = await page.evaluate(() => [...document.querySelectorAll('.pcard')].map((c) => c.querySelectorAll('.tariff').length));
  if (plans[2] === 1) ok('у Seedance ровно один тариф — годового нет и не выдумано');
  else no(`тарифов у Seedance ${plans[2]}`);
  await ctx.close();
}

await browser.close();
console.log(bad ? `\nВИТРИНА РАБОТАЕТ НЕ ТАК (${bad})` : '\nВитрина в порядке: геометрия, текст, выбор и запасной плоский вид');
process.exit(bad ? 1 : 0);
