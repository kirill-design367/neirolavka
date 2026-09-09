#!/usr/bin/env node
/**
 * Мобильная раскладка: три вещи, которые ломались только на телефоне
 * и которых не видно ни на одном десктопном замере.
 *
 *   1. Пузыри. Холст рисуется в плотности экрана (иначе точки мылом),
 *      такт не делает принудительных раскладок, а высота ДОКУМЕНТА
 *      не пересобирает холст.
 *   2. Чипы оплаты. Пилюля не стоит заподлицо с рамкой прокручиваемого
 *      ряда — иначе на части экранов у неё срезаются края.
 *   3. Витрина. После быстрых нажатий подряд карточки не перекрывают
 *      друг друга в УСТОЯВШЕМСЯ состоянии.
 *
 * Запуск: node scripts/check-mobile.mjs <url>
 */

import { chromium, devices } from 'playwright';

const URL0 = process.argv[2];
if (!URL0) {
  console.error('нужен адрес: node scripts/check-mobile.mjs <url>');
  process.exit(2);
}

/** Плотность экрана, на которой снимаем. Телефоны бывают и дробные. */
const PLOTNOSTI = [2.75, 3];
/** Потолок плотности холста пузырей — тот же, что в bubbles-gl.ts. */
const POTOLOK = 2;

let bad = false;
const skazat = (ok, stroka) => {
  if (!ok) bad = true;
  console.log(`${ok ? '  ok  ' : '  !!  '}${stroka}`);
};

const brauzer = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium',
});

const kontekst = async (dpr) =>
  brauzer.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['Pixel 7'].userAgent,
  });

// ─── 1. Пузыри ───────────────────────────────────────────────────────
{
  const dpr = 3;
  const k = await kontekst(dpr);
  const p = await k.newPage();
  // Счётчик пересборок холста ставится ДО загрузки: первая сборка
  // законна, считаем только лишние.
  await p.addInitScript(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
    window.__peresborok = 0;
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) { if (getComputedStyle(this).position === 'fixed') window.__peresborok++; d.set.call(this, v); },
    });
  });
  await p.goto(URL0, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1600);

  const holst = await p.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].find((x) => getComputedStyle(x).position === 'fixed');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { otschetov: c.width / r.width, buf: `${c.width}×${c.height}`, css: `${Math.round(r.width)}×${Math.round(r.height)}` };
  });
  if (!holst) {
    // Холста нет вовсе — это отказ, а не заметка: без него мерить
    // нечего, а проверка обязана падать, а не молчать.
    skazat(false, 'холста пузырей на странице нет — мерить нечего');
  } else {
    const nado = Math.min(POTOLOK, dpr);
    skazat(
      holst.otschetov >= nado - 0.01,
      `холст ${holst.buf} на ${holst.css} css — ${holst.otschetov.toFixed(2)} отсчёта на пиксель при плотности ${dpr} (нужно ${nado})`,
    );
  }

  // Принудительные раскладки в такте. Считаем обращения к scrollHeight
  // за секунду покоя: такт обязан обходиться без них.
  const raskladok = await p.evaluate(() => new Promise((gotovo) => {
    let n = 0;
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      configurable: true,
      get() { n++; return d.get.call(this); },
    });
    setTimeout(() => { Object.defineProperty(Element.prototype, 'scrollHeight', d); gotovo(n); }, 1000);
  }));
  skazat(raskladok === 0, `принудительных раскладок за секунду покоя: ${raskladok}`);

  // Высота ДОКУМЕНТА меняется от раскрытия карточек витрины. Холст
  // от этого пересобираться не должен: окно-то не изменилось.
  await p.evaluate(() => document.querySelector('#magazin')?.scrollIntoView());
  await p.waitForTimeout(1800);
  await p.evaluate(() => { window.__peresborok = 0; });
  const kart = await p.$$('.pcard');
  for (const n of [1, 3, 0, 4]) {
    if (kart[n]) await kart[n].click({ force: true }).catch(() => {});
    await p.waitForTimeout(800);
  }
  const peresborok = await p.evaluate(() => window.__peresborok);
  skazat(peresborok === 0, `пересборок холста от высоты документа: ${peresborok}`);
  await k.close();
}

// ─── 2. Чипы оплаты ──────────────────────────────────────────────────
for (const dpr of PLOTNOSTI) {
  const k = await kontekst(dpr);
  const p = await k.newPage();
  await p.goto(URL0, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('#magazin')?.scrollIntoView());
  await p.waitForTimeout(1800);
  // Продукт без уровней покупается самой карточкой — так выбор
  // появляется наверняка.
  const kart = await p.$$('.pcard');
  for (const el of kart) {
    await el.click({ force: true }).catch(() => {});
    await p.waitForTimeout(500);
    if (await p.$('.bar__pays')) break;
  }
  const zapas = await p.evaluate(() => {
    const row = document.querySelector('.bar__pays');
    if (!row) return null;
    const rr = row.getBoundingClientRect();
    const st = getComputedStyle(row);
    // Рамка обрезки у прокручиваемого ряда — его padding-box.
    const verh = rr.top + parseFloat(st.borderTopWidth);
    const niz = rr.bottom - parseFloat(st.borderBottomWidth);
    let hudshiy = Infinity;
    for (const el of row.querySelectorAll('.bar__pay')) {
      const c = el.getBoundingClientRect();
      hudshiy = Math.min(hudshiy, c.top - verh, niz - c.bottom);
    }
    return { hudshiy, prokruchivaetsya: st.overflowX !== 'visible' };
  });
  if (!zapas) {
    skazat(false, `плотность ${dpr}: ряда чипов оплаты нет — проверять нечего`);
  } else {
    // Два пикселя — это запас, при котором рамка обрезки не попадает
    // в сглаженную кромку пилюли ни при какой плотности экрана.
    skazat(
      !zapas.prokruchivaetsya || zapas.hudshiy >= 2,
      `плотность ${dpr}: запас чипа до рамки ряда ${zapas.hudshiy.toFixed(2)} px (нужно 2)`,
    );
  }
  await k.close();
}

// ─── 3. Витрина ──────────────────────────────────────────────────────
{
  const k = await kontekst(3);
  const p = await k.newPage();
  await p.goto(URL0, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('#magazin')?.scrollIntoView({ block: 'start' }));
  await p.waitForTimeout(2000);

  const perekrytie = () => p.evaluate(() => {
    const k = [...document.querySelectorAll('.pcard')].map((el, i) => {
      const r = el.getBoundingClientRect();
      return { i, top: r.top, bottom: r.bottom };
    }).sort((a, c) => a.top - c.top);
    let max = 0, gde = '';
    for (let i = 1; i < k.length; i++) {
      const d = k[i - 1].bottom - k[i].top;
      if (d > max) { max = d; gde = `${k[i - 1].i}→${k[i].i}`; }
    }
    return { max, gde };
  });

  // Быстрые нажатия подряд: цель — попасть в задержку соседей,
  // на которой и ломался порядок твинов.
  let hudshee = { max: 0, gde: '' };
  for (const ryad of [[1, 2, 3], [4, 0, 5], [2, 5, 1], [0, 3, 4]]) {
    const kart = await p.$$('.pcard');
    for (const n of ryad) {
      if (kart[n]) await kart[n].click({ force: true }).catch(() => {});
      await p.waitForTimeout(55);
    }
    // Даём всему доехать: судим УСТОЯВШЕЕСЯ состояние.
    await p.waitForTimeout(2200);
    const r = await perekrytie();
    if (r.max > hudshee.max) hudshee = r;
  }
  skazat(hudshee.max <= 1, `перекрытие карточек после быстрых нажатий: ${hudshee.max.toFixed(1)} px ${hudshee.gde}`);
  await k.close();
}

await brauzer.close();
console.log(bad ? '\nМОБИЛЬНАЯ: ЕСТЬ ЗАМЕЧАНИЯ' : '\nМОБИЛЬНАЯ: всё в порядке');
process.exit(bad ? 1 : 0);
