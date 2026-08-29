/**
 * Контраст текста на ПЕРЕЛИВАЮЩЕЙСЯ подложке.
 *
 * Обычная проверка берёт объявленный цвет фона — на анимированной
 * подложке этого мало: под буквами в разные моменты цикла оказывается
 * разный цвет. Поэтому снимаем настоящие пиксели: скриншот в нескольких
 * фазах, под каждой строкой текста берём медианный цвет фона рядом
 * с ней и считаем контраст по WCAG.
 *
 * Запуск: node scripts/check-shimmer-contrast.mjs <url> [число фаз]
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const PHASES = Number(process.argv[3] ?? 6);

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // Селекторы разбиты по блокам: к каждому блоку надо подкрутить,
  // иначе он не попадает в кадр и остаётся непроверенным.
  const GROUPS = [
    ['карточки преимуществ', '.terms', ['.term__title', '.term__text']],
    ['реферальный блок', '.referral', ['.referral__title', '.referral__text',
                                        '.fact__label', '.fact__value', '.referral__soon']],
  ];

  const worst = new Map();
  for (const [, anchor, sels] of GROUPS) {
    await page.evaluate((a) => {
      const el = document.querySelector(a);
      if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 180);
    }, anchor);
    await page.waitForTimeout(900);

    const targets = await page.evaluate((sels2) => sels2.flatMap((s) =>
      [...document.querySelectorAll(s)].slice(0, 2).map((el) => {
        const r = el.getBoundingClientRect();
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const cx = cv.getContext('2d'); cx.fillStyle = getComputedStyle(el).color; cx.fillRect(0,0,1,1);
        const d = cx.getImageData(0,0,1,1).data;
        return { sel: s, fg: [d[0], d[1], d[2]],
                 x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })), sels);

  // Текст на время съёмки делается прозрачным: тогда под ним видна
  // настоящая подложка. Полоса «чуть выше строки» тут не работает —
  // у многострочного абзаца она попадает в заголовок сверху, и
  // проверка меряет контраст текста с текстом.
  await page.evaluate((sels2) => {
    const st = document.createElement('style');
    st.id = 'probe-hide';
    st.textContent = `${sels2.join(',')} { color: transparent !important; }`;
    document.head.appendChild(st);
  }, sels);
  await page.waitForTimeout(200);

  for (let ph = 0; ph < PHASES; ph++) {
    // Фазы задаются временем анимаций, а не ожиданием: циклы слоёв
    // длятся десятки секунд и не кратны друг другу, так что ждать
    // пришлось бы минуты, и всё равно вышла бы одна диагональ.
    // Каждому слою даётся своя доля цикла, поэтому за PHASES проб
    // перебираются РАЗНЫЕ сочетания слоёв, а не одно и то же.
    await page.evaluate((n) => {
      document.getAnimations().forEach((a, j) => {
        const d = a.effect?.getTiming?.().duration;
        if (typeof d !== 'number' || !isFinite(d)) return;
        a.pause();
        a.currentTime = (((n * (j + 1) * 0.37) % 1) + 1) % 1 * d;
      });
    }, ph);
    await page.waitForTimeout(220);
    const png = PNG.sync.read(await page.screenshot());
    for (const t of targets) {
      if (t.y < 0 || t.y + t.h > png.height || t.w < 4) continue;
      // берём полосу фона чуть выше строки — там подложка без букв
      // Берём всю площадь под элементом и ищем самый светлый её
      // пиксель: подложка градиентная, и опасен её самый яркий кусок.
      let med = null, best = -1;
      for (let yy = t.y; yy < t.y + t.h; yy += 2) {
        if (yy < 0 || yy >= png.height) continue;
        for (let xx = t.x; xx < t.x + t.w; xx += 2) {
          const idx = (png.width * yy + xx) << 2;
          const c = [png.data[idx], png.data[idx + 1], png.data[idx + 2]];
          const L = lum(c);
          if (L > best) { best = L; med = c; }
        }
      }
      if (!med) continue;
      const r = ratio(t.fg, med);
      const prev = worst.get(t.sel);
      if (!prev || r < prev.r) worst.set(t.sel, { r, bg: med, ph });
    }
  }
  }

  console.log(`\n── ${theme === 'dark' ? 'тёмная' : 'светлая'}: худший контраст за ${PHASES} фаз ──`);
  if (!worst.size) { console.log('  НИЧЕГО НЕ ПРОВЕРЕНО — селекторы не нашлись'); bad++; }
  for (const [sel, v] of worst) {
    const ok = v.r >= 4.5;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok ' : 'НЕТ'} ${v.r.toFixed(2)}:1  ${sel.padEnd(18)} фаза ${v.ph}, фон rgb(${v.bg.join(',')})`);
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `\nПровалов: ${bad}` : '\nНа всех фазах перелива контраст держится');
process.exit(bad ? 1 : 0);
