/**
 * Проверяет, что при смене темы плавно меняется ВСЁ, а не часть.
 *
 * Метод: нажимаем переключатель и много раз за время перехода снимаем
 * вычисленные стили с представителей каждого вида окраски. Свойство,
 * которое участвует в переходе, даёт много промежуточных значений.
 * Свойство, которое переключается скачком, даёт ровно два — начальное
 * и конечное. Так «не анимируется» отличается от «анимируется».
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// Выбираем тариф, чтобы панель заказа была в заполненном состоянии
await page.getByRole('button', { name: /6 месяцев/ }).first().click().catch(() => {});
await page.getByRole('button', { name: /СБП/ }).first().click().catch(() => {});
await page.waitForTimeout(500);

const PROBES = [
  ['фон страницы', 'body', 'backgroundColor'],
  ['текст первого экрана', '.hero__lead', 'color'],
  ['заголовок', '.hero__title', 'color'],
  ['подложка полки', '.shelf__plate', 'backgroundColor'],
  ['граница подложки полки', '.shelf__plate', 'borderTopColor'],
  ['тень подложки полки', '.shelf__plate', 'boxShadow'],
  ['карточка тарифа', '.tariff', 'backgroundColor'],
  ['выбранный тариф (color-mix)', '.tariff--active', 'backgroundColor'],
  ['бумага чека', '.order__paper', 'backgroundColor'],
  ['тень чека', '.order__paper', 'boxShadow'],
  ['кнопка в бот', '.order__cta', 'backgroundColor'],
  ['выбранная оплата (color-mix)', '.pay--active', 'backgroundColor'],
  ['заливка рефералки', '.referral__plate', 'backgroundColor'],
  ['текст на заливке', '.referral__text', 'color'],
  ['нить шагов (градиент)', '.step:not(:last-child)', 'backgroundImage', '::before'],
  ['узел шага', '.step__node', 'backgroundColor'],
  ['подвал', '.footer', 'backgroundColor'],
  ['подложка отзыва', '.review__plate', 'backgroundColor'],
  ['маячок счётчика', '.nav__pulse', 'backgroundColor'],
  ['ореол маячка (color-mix)', '.nav__pulse', 'boxShadow'],
];

const samples = await page.evaluate(async (probes) => {
  const seen = probes.map(() => new Set());
  const read = () => {
    probes.forEach(([, sel, prop, pseudo], i) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const cs = getComputedStyle(el, pseudo || undefined);
      seen[i].add(cs[prop]);
    });
  };
  read();
  document.querySelector('.theme-toggle').click();
  const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => {
      read();
      if (performance.now() - t0 < 420) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  await new Promise((r) => setTimeout(r, 250));
  read();
  return seen.map((s) => [...s]);
}, PROBES);

let bad = 0;
console.log('\nразных значений за переход  ·  что проверяли');
for (let i = 0; i < PROBES.length; i++) {
  const n = samples[i].length;
  const ok = n > 3;
  if (!ok) bad++;
  console.log(`  ${String(n).padStart(3)}  ${ok ? 'плавно ' : 'СКАЧКОМ'}  ${PROBES[i][0]}`);
  if (!ok) samples[i].forEach((v) => console.log(`          ${String(v).slice(0, 90)}`));
}
await browser.close();
console.log(bad ? `\nМеняется скачком: ${bad} из ${PROBES.length}` : `\nВсе ${PROBES.length} видов окраски меняются плавно`);
process.exit(bad ? 1 : 0);
