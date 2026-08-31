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
await page.locator('.pcard--active .tariff').first().click().catch(() => {});
await page.getByRole('button', { name: /СБП/ }).first().click().catch(() => {});
await page.waitForTimeout(500);

const PROBES = [
  ['фон страницы', 'body', 'backgroundColor'],
  ['текст первого экрана', '.hero__lead', 'color'],
  // У заголовка меряем градиент, а не color: он выводится обрезкой
  // фона по тексту и цвет текста у него всегда прозрачный.
  ['заголовок (градиент)', '.hero__title', 'backgroundImage'],
  ['карточка витрины', '.pcard', 'backgroundColor'],
  ['граница карточки витрины', '.pcard', 'borderTopColor'],
  ['имя продукта', '.pcard__name', 'color'],
  ['карточка тарифа', '.tariff', 'backgroundColor'],
  ['выбранный тариф (color-mix)', '.tariff--active', 'backgroundColor'],
  ['бумага чека', '.order__paper', 'backgroundColor'],
  ['тень чека', '.order__paper', 'boxShadow'],
  ['кнопка в бот', '.order__cta', 'backgroundColor'],
  ['выбранная оплата (color-mix)', '.pays__item--active', 'backgroundColor'],
  ['заливка рефералки', '.referral__plate', 'backgroundColor'],
  // Градиент плашки объявлен только в тёмной теме, поэтому само
  // свойство при переключении возникает скачком. Видно этого не
  // будет: точки градиента — переменные, и в момент переключения
  // все три ещё равны цвету светлой заливки. Проба это показывает —
  // значений много, а не два.
  ['градиент рефералки', '.referral__plate', 'backgroundImage'],
  ['текст на заливке', '.referral__text', 'color'],
  ['дорожка шагов', '.steps__track', 'backgroundColor'],
  ['подсветка дорожки', '.steps__track-fill', 'backgroundColor'],
  // У самой капли и у её долей фона нет: градиент лежит на
  // псевдоэлементе доли, он и есть перелив сердцевины.
  ['перелив в капле', '.steps__led-lobe', 'backgroundImage', '::before'],
  ['свечение узла', '.step__halo', 'backgroundImage'],
  ['узел шага', '.step__node', 'backgroundColor'],
  // Подвал залит градиентом, а не цветом.
  ['подвал (градиент)', '.footer', 'backgroundImage'],
  ['подложка отзыва', '.review__plate', 'backgroundColor'],
  ['оговорка про отзывы', '.footer__disclaimer', 'backgroundColor'],
  ['плашка обещания шагов', '.steps__note', 'backgroundColor'],
  ['плашка надзаголовка', '.hero__eyebrow', 'backgroundColor', '::before'],
  ['карточка преимущества', '.term', 'backgroundColor'],
  ['подложка итога', '.order__total', 'backgroundColor'],
  ['движок переключателя', '.theme-toggle__thumb', 'backgroundColor'],
  ['иконка переключателя', '.theme-toggle__icon--sun', 'stroke'],
  // Тень шапки живёт на подложке капсулы, а не на самой шапке.
  ['тень липкой шапки', '.nav__inner', 'boxShadow', '::before'],
  ['свет вокруг рефералки', '.referral__glow', 'boxShadow'],
];

const result = await page.evaluate(async (probes) => {
  const seen = probes.map(() => new Set());
  const missing = [];
  const read = () => {
    probes.forEach(([label, sel, prop, pseudo], i) => {
      const el = document.querySelector(sel);
      if (!el) {
        if (!missing.includes(label)) missing.push(label);
        return;
      }
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
  return { values: seen.map((s) => [...s]), missing };
}, PROBES);

const { values: samples, missing } = result;
let bad = 0;
if (missing.length) {
  // Проверка, которая целится в несуществующий селектор, молча
  // перестаёт проверять. Это должно быть видно сразу.
  console.log(`\nСЕЛЕКТОР НЕ НАЙДЕН: ${missing.join(', ')} — проба устарела, поправьте список`);
  bad += missing.length;
}
console.log('\nразных значений за переход  ·  что проверяли');
for (let i = 0; i < PROBES.length; i++) {
  const n = samples[i].length;
  const flat = samples[i].every((v) => v === 'none' || v === 'rgba(0, 0, 0, 0)' || v === '');
  if (flat) {
    // Проба, которая на обоих концах ничего не рисует, ничего и не
    // проверяет. Молча засчитывать её нельзя.
    console.log(`  ПУСТО     ${PROBES[i][0]} — свойство не задано ни в одной теме, проба бесполезна`);
    bad++;
    continue;
  }
  const ok = n > 3;
  if (!ok) bad++;
  console.log(`  ${String(n).padStart(3)}  ${ok ? 'плавно ' : 'СКАЧКОМ'}  ${PROBES[i][0]}`);
  if (!ok) samples[i].forEach((v) => console.log(`          ${String(v).slice(0, 90)}`));
}
await browser.close();
console.log(bad ? `\nМеняется скачком: ${bad} из ${PROBES.length}` : `\nВсе ${PROBES.length} видов окраски меняются плавно`);
process.exit(bad ? 1 : 0);
