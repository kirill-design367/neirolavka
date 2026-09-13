/**
 * Отзывы на витрине: те же, что в каталоге, и в том же порядке.
 *
 * Правит их владелец из панели, панель выкладывает их в `catalog.ts`,
 * сайт собирается из файла. Порваться это может в четырёх местах,
 * и все четыре молчат: метки в файле, кусок панели, сборка, разметка.
 *
 * ОЖИДАЕМОЕ ЧИТАЕТСЯ ИЗ КАТАЛОГА, а не вписано сюда строками. Тот же
 * закон, что у `check-live`: имена товаров, вписанные в проверку,
 * трижды красили исправную выкладку после правки прайса из панели.
 * Отзывы правятся ЧАЩЕ прайса — вписанный сюда текст устарел бы
 * в первый же день.
 *
 * ЦЕНУ ЭТОГО НАДО НАЗВАТЬ ПРЯМО: проверка сверяет СТРАНИЦУ С ФАЙЛОМ,
 * и правка самого файла меняет обе стороны сразу — опечатку в тексте
 * отзыва она поймать не может и не должна. Она стережёт ДОРОГУ
 * от файла до экрана: метки на месте, кусок разобрался, сборка
 * взяла его, разметка вывела всё и в том же порядке. Содержимое
 * отзывов утверждает владелец, а не машина.
 *
 * ЛЕНТА НАБРАНА ДВАЖДЫ ради бесшовного стыка, поэтому в разметке
 * каждого отзыва два экземпляра, и второй скрыт от скринридера.
 * Проверка это учитывает: считает только видимые голосу карточки.
 *
 * Проверено на способность падать: переставленный порядок отзывов
 * в разметке, снятая вторая копия ленты и потерянная строка товара
 * краснеют по отдельности.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';

/** Отзывы из файла каталога — из куска, который пишет панель. */
function izKataloga() {
  const fayl = readFileSync(new URL('../src/lib/catalog.ts', import.meta.url), 'utf8');
  const NACHALO = '// ── НАЧАЛО ОТЗЫВОВ ПАНЕЛИ ──';
  const KONEC = '// ── КОНЕЦ ОТЗЫВОВ ПАНЕЛИ ──';
  const a = fayl.indexOf(NACHALO);
  const b = fayl.indexOf(KONEC);
  if (a < 0 || b < 0 || b < a) {
    throw new Error('в catalog.ts не нашлось меток отзывов — проверять нечего');
  }
  const nachaloJson = fayl.indexOf('reviews: ', a) + 'reviews: '.length;
  const konecJson = fayl.lastIndexOf(']', b) + 1;
  return JSON.parse(fayl.slice(nachaloJson, konecJson));
}

const zhdem = izKataloga();
if (!Array.isArray(zhdem) || zhdem.length === 0) {
  console.log('ПЛОХО: в каталоге нет ни одного отзыва — проверка ничего не проверяет');
  process.exit(1);
}

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
});
let ploho = false;
for (const [imya, vid] of [
  ['десктоп', { width: 1512, height: 900 }],
  ['телефон', { width: 390, height: 844 }],
]) {
  const ctx = await b.newContext({ viewport: vid });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const est = await page.evaluate(() =>
    [...document.querySelectorAll('.reviews__track > .review')]
      // Вторая копия ленты помечена aria-hidden: это тот же отзыв,
      // показанный второй раз ради стыка, а не ещё один отзыв.
      .filter((li) => li.getAttribute('aria-hidden') !== 'true')
      .map((li) => ({
        text: li.querySelector('.review__text')?.textContent?.trim() ?? '',
        author: li.querySelector('.review__name')?.textContent?.trim() ?? '',
        bought: li.querySelector('.review__bought')?.textContent?.trim() ?? '',
      })),
  );

  const bedy = [];
  if (est.length !== zhdem.length) {
    bedy.push(`отзывов на странице ${est.length}, в каталоге ${zhdem.length}`);
  }
  for (let i = 0; i < Math.min(est.length, zhdem.length); i++) {
    for (const pole of ['author', 'bought', 'text']) {
      if (est[i][pole] !== zhdem[i][pole]) {
        bedy.push(`отзыв ${i + 1}, «${pole}»: на странице «${est[i][pole]}», в каталоге «${zhdem[i][pole]}»`);
      }
    }
  }
  // Дублей обязано быть столько же: на них держится бесшовный стык.
  const vsego = await page.evaluate(
    () => document.querySelectorAll('.reviews__track > .review').length,
  );
  if (vsego !== est.length * 2) {
    bedy.push(`карточек в дорожке ${vsego}, а должно быть вдвое больше видимых (${est.length * 2})`);
  }

  if (bedy.length) {
    ploho = true;
    console.log(`ПЛОХО ${imya}:`);
    for (const s of bedy) console.log(`  ${s}`);
  } else {
    console.log(`ок ${imya}: ${est.length} отзывов, совпадают с каталогом слово в слово`);
  }
  await ctx.close();
}
await b.close();
process.exit(ploho ? 1 : 0);
