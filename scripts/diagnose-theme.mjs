/**
 * Разбор смены темы по ВСЕМ окрашенным элементам страницы.
 *
 * Для каждого элемента и каждого окрашенного свойства пишем значение
 * на каждом кадре перехода и получаем:
 *   steps  — сколько разных значений успело появиться (1–2 = скачок),
 *   start  — на какой миллисекунде цвет тронулся,
 *   end    — на какой замер,
 * Разброс start и end по элементам и есть «перекрашивается по очереди».
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const browser = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /6 месяцев/ }).first().click().catch(() => {});
await page.getByRole('button', { name: 'СБП', exact: true }).click().catch(() => {});
await page.waitForTimeout(600);

const data = await page.evaluate(async () => {
  const PROPS = ['backgroundColor', 'color', 'borderTopColor', 'borderBottomColor',
                 'boxShadow', 'backgroundImage', 'fill', 'stroke', 'outlineColor'];
  // Все элементы, у которых есть хоть один непрозрачный окрашенный признак
  const nodes = [...document.querySelectorAll('body *')].filter((el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
           cs.backgroundImage !== 'none' ||
           cs.boxShadow !== 'none' ||
           (el.childNodes && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  });
  // плюс псевдоэлементы, которыми нарисованы подложки
  const pseudo = [];
  for (const el of [...document.querySelectorAll('body *')]) {
    for (const p of ['::before', '::after']) {
      const cs = getComputedStyle(el, p);
      if (cs.content !== 'none' && (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none'))
        pseudo.push([el, p]);
    }
  }

  const targets = [
    ...nodes.map((el) => [el, null]),
    ...pseudo,
  ];

  const rec = targets.map(() => ({}));
  const t0 = performance.now();
  const snap = () => {
    const t = performance.now() - t0;
    targets.forEach(([el, p], i) => {
      const cs = getComputedStyle(el, p || undefined);
      for (const prop of PROPS) {
        const v = cs[prop];
        if (v === 'none' || v === 'rgba(0, 0, 0, 0)') continue;
        const slot = (rec[i][prop] ||= { vals: new Set(), first: null, last: null, prev: null });
        if (slot.prev === null) { slot.prev = v; slot.vals.add(v); continue; }
        if (v !== slot.prev) {
          if (slot.first === null) slot.first = t;
          slot.last = t;
          slot.prev = v;
          slot.vals.add(v);
        }
      }
    });
  };

  snap();
  document.querySelector('.theme-toggle').click();
  await new Promise((res) => {
    const tick = () => { snap(); performance.now() - t0 < 700 ? requestAnimationFrame(tick) : res(); };
    requestAnimationFrame(tick);
  });

  const out = [];
  targets.forEach(([el, p], i) => {
    for (const [prop, s] of Object.entries(rec[i])) {
      if (s.vals.size < 2) continue; // не менялся вовсе — не интересует
      // Насколько цвет вообще изменился. Признаки, у которых начальный
      // и конечный цвет почти совпадают, дают мало промежуточных
      // значений просто из-за округления до целых каналов, и в оценке
      // синхронности участвовать не должны — иначе они врут.
      const vals = [...s.vals];
      const rgb = (v) => (String(v).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
      const a = rgb(vals[0]), b2 = rgb(vals[vals.length - 1]);
      const dist = a.length === 3 && b2.length === 3
        ? Math.round(Math.hypot(a[0] - b2[0], a[1] - b2[1], a[2] - b2[2])) : 0;
      out.push({
        sel: (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + (p || ''),
        prop, steps: s.vals.size, dist,
        first: Math.round(s.first), last: Math.round(s.last),
      });
    }
  });
  return out;
});

await browser.close();

const stepped = data.filter((d) => d.steps <= 2);
const smooth = data.filter((d) => d.steps > 2);

console.log(`Окрашенных признаков, которые изменились при смене темы: ${data.length}`);
console.log(`  плавно (больше двух значений): ${smooth.length}`);
console.log(`  СКАЧКОМ (одно-два значения):   ${stepped.length}`);

if (stepped.length) {
  console.log('\n── меняются скачком ──');
  const by = {};
  for (const d of stepped) (by[`${d.prop}`] ||= []).push(d);
  for (const [prop, list] of Object.entries(by)) {
    console.log(`  ${prop} — ${list.length} шт:`);
    for (const d of list.slice(0, 8)) console.log(`      ${d.sel}  (старт ${d.first} мс)`);
    if (list.length > 8) console.log(`      … и ещё ${list.length - 8}`);
  }
}

// В оценку синхронности берём только заметно меняющиеся цвета
const MIN_DIST = 12;
const notable = smooth.filter((d) => d.dist >= MIN_DIST);
console.log(`  из них заметно меняют цвет (расстояние ≥ ${MIN_DIST}): ${notable.length}`);
const starts = notable.map((d) => d.first).filter((x) => Number.isFinite(x));
const ends = notable.map((d) => d.last).filter((x) => Number.isFinite(x));
if (starts.length) {
  const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
  console.log('\n── синхронность плавных ──');
  console.log(`  старт:     мин ${Math.min(...starts)} мс · медиана ${q(starts, .5)} · макс ${Math.max(...starts)}`);
  console.log(`  окончание: мин ${Math.min(...ends)} мс · медиана ${q(ends, .5)} · макс ${Math.max(...ends)}`);
  console.log(`  разброс старта ${Math.max(...starts) - Math.min(...starts)} мс, окончания ${Math.max(...ends) - Math.min(...ends)} мс`);
  const late = notable.filter((d) => d.first > q(starts, .5) + 16)
                     .sort((a, b) => b.first - a.first);
  if (late.length) {
    console.log(`\n── тронулись позже медианы (${late.length} шт) ──`);
    for (const d of late.slice(0, 10)) console.log(`  старт ${d.first} мс, конец ${d.last} мс, значений ${d.steps} — ${d.sel} · ${d.prop}`);
    if (late.length > 10) console.log(`  … и ещё ${late.length - 10}`);
  }
  const lateEnd = notable.filter((d) => d.last < q(ends, .5) - 16);
  if (lateEnd.length) console.log(`\n  закончили раньше медианы: ${lateEnd.length} шт (пример: ${lateEnd[0].sel} · ${lateEnd[0].prop}, конец ${lateEnd[0].last} мс)`);
}
