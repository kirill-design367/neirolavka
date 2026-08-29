/**
 * Две проверки, которые глазами не сделать.
 *
 * 1. Вспышка темы. Если тёмная тема запомнена, ни один кадр загрузки
 *    не должен быть светлым. Смотрим фон на самом первом кадре после
 *    разбора документа, до сети и до гидратации.
 * 2. prefers-reduced-motion. Lenis не должен подниматься вовсе,
 *    а все появляющиеся блоки обязаны быть видимы без прокрутки.
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;

// ── 1. Вспышка ────────────────────────────────────────────────
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('neirolavka-theme', t);
    // Снимаем фон на первом же кадре, который браузер рисует.
    window.__first = null;
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive' && window.__first === null) {
        window.__first = {
          theme: document.documentElement.dataset.theme,
          bg: getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim(),
          scheme: document.documentElement.style.colorScheme,
        };
      }
    });
  }, theme);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const first = await page.evaluate(() => window.__first);
  const expect = theme === 'dark' ? '#191c1a' : '#f2eee7';
  const ok = first?.theme === theme && first?.bg.toLowerCase() === expect;
  console.log(`  тема «${theme}»: на первом кадре data-theme=${first?.theme}, --c-bg=${first?.bg}, color-scheme=${first?.scheme} → ${ok ? 'вспышки нет' : 'ВСПЫШКА'}`);
  if (!ok) bad++;
  await ctx.close();
}

// ── 2. Уменьшенное движение ───────────────────────────────────
for (const mode of ['no-preference', 'reduce']) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, reducedMotion: mode });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const r = await page.evaluate(() => {
    // Lenis вешает свой класс на html, когда поднимается.
    const lenis = document.documentElement.className.includes('lenis');
    const items = [...document.querySelectorAll('[data-reveal], [data-reveal-plate]')];
    const hidden = items.filter((el) => Number(getComputedStyle(el).opacity) < 0.99);
    // Блоки ниже сгиба — те, до которых прокрутка ещё не дошла
    const below = hidden.filter((el) => el.getBoundingClientRect().top > innerHeight);
    return { lenis, total: items.length, hidden: hidden.length, hiddenBelowFold: below.length };
  });

  if (mode === 'reduce') {
    const ok = !r.lenis && r.hidden === 0;
    console.log(`  reduce: Lenis поднят=${r.lenis}, скрытых блоков ${r.hidden} из ${r.total} → ${ok ? 'в порядке' : 'НАРУШЕНО'}`);
    if (!ok) bad++;
  } else {
    console.log(`  обычный режим: Lenis поднят=${r.lenis}, скрыто ${r.hidden} из ${r.total} (ниже сгиба ${r.hiddenBelowFold}) — появления работают`);
    if (!r.lenis) { console.log('    ВНИМАНИЕ: Lenis не поднялся там, где должен'); bad++; }
  }
  await ctx.close();
}

await browser.close();
console.log(bad ? `\nПроблем: ${bad}` : '\nОбе проверки пройдены');
process.exit(bad ? 1 : 0);
