/**
 * Счётчик подписок в шапке.
 *
 * Число в строке «Уже N пользователей оформили подписки» много
 * месяцев стояло в коде и не менялось. Теперь сайт спрашивает его
 * у бота — и у этой затеи ровно четыре способа сломаться молча,
 * по одному на пробу:
 *
 *   1. бот НЕ ОТВЕТИЛ (не прогнали server-setup.sh и путь отдаёт
 *      404, бот перезапускается выкладкой, сеть моргнула) — в шапке
 *      обязан остаться засев из сборки, а не ноль и не пустота;
 *   2. бот ответил — число обязано ВЫРАСТИ ровно на сказанное,
 *      а не заменить собой засев;
 *   3. бот ответил МУСОРОМ (дробь, минус, `null` при поломке базы,
 *      строка) — засев остаётся; «Уже 2 417,5 пользователей»
 *      и «Уже NaN» на витрине хуже неподвижного числа;
 *   4. обновление числа не двигает раскладку: CLS у сайта 0,
 *      и поздний ответ бота не имеет права его испортить.
 *
 * ОТВЕТ БОТА ПОДСТАВНОЙ — проба про САЙТ, ровно как в check-promo.
 * Правильность самого числа держат проверки бота
 * (`bot/test/schetchik.test.ts`): там доказывается, что считаются
 * выданные заказы и что ряд не убывает.
 *
 * ЗАСЕВ ЧИТАЕТСЯ ИЗ КАТАЛОГА, а не вписан сюда числом. Тот же закон,
 * что у `check-live` с именами товаров и у `check-otzyvy` с текстами:
 * вписанное строкой устаревает молча, и проверка начинает краснеть
 * на исправном сайте — или, хуже, зеленеть на сломанном.
 *
 * Запуск: node scripts/check-schetchik.mjs <url>
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ADRES = process.argv[2];
if (!ADRES) {
  console.log('ПЛОХО: не задан адрес. node scripts/check-schetchik.mjs <url>');
  process.exit(1);
}
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let bad = 0;
const ok = (s) => console.log(`  ✓ ${s}`);
const no = (s) => {
  console.log(`  ✗ ${s}`);
  bad++;
};

/* Засев — из того же файла, откуда его берёт сборка. Ненайденное
   число это ОТКАЗ, а не «проба устарела»: молча пропущенная проба
   опаснее упавшей. */
const istochnik = readFileSync(new URL('../src/lib/catalog.ts', import.meta.url), 'utf8');
const najden = istochnik.match(/subscribers:\s*(\d+)/);
if (!najden) {
  console.log('ПЛОХО: в src/lib/catalog.ts не нашлось `subscribers:` — проверять не с чем');
  process.exit(1);
}
const ZASEV = Number(najden[1]);
console.log(`засев из каталога: ${ZASEV}`);

/** Число из строки «Уже 2 417 пользователей…». Пробелы там неразрывные. */
const chislo = (s) => Number(String(s).replace(/[^\d]/g, ''));

const browser = await chromium.launch({ executablePath: CHROME });

/**
 * Открыть страницу с заданным ответом бота и вернуть, что в шапке.
 *
 * `otvet === 'molchanie'` — запрос обрывается; это и есть случай
 * «пути нет» и «бот лежит».
 */
async function shapka(otvet, { mobilnyy = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobilnyy ? { width: 390, height: 844 } : { width: 1512, height: 900 },
    locale: 'ru-RU',
    isMobile: mobilnyy,
    hasTouch: mobilnyy,
  });
  let sprosili = 0;
  await ctx.route('**/api/schetchik*', async (route) => {
    sprosili += 1;
    if (otvet === 'molchanie') return route.abort('failed');
    await route.fulfill({
      status: otvet.status ?? 200,
      contentType: 'application/json; charset=utf-8',
      body: typeof otvet.telo === 'string' ? otvet.telo : JSON.stringify(otvet.telo),
    });
  });

  const page = await ctx.newPage();
  /* CLS копится с самой загрузки: наблюдатель ставится ДО перехода,
     иначе сдвиг от позднего ответа бота в него не попадёт. */
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const z of l.getEntries()) if (!z.hadRecentInput) window.__cls += z.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(ADRES, { waitUntil: 'networkidle' });
  /* Ответ приходит после первой отрисовки: ждём, пока страница
     успокоится, иначе меряем состояние до обновления числа. */
  await page.waitForTimeout(900);

  const uzel = page.locator('.nav__counter-number');
  const vidno = (await uzel.count()) ? (await uzel.first().innerText()).trim() : null;
  const cls = await page.evaluate(() => window.__cls ?? 0);
  await ctx.close();
  return { vidno, chislo: vidno === null ? null : chislo(vidno), cls, sprosili };
}

console.log('\n── бот молчит: остаётся засев ──');
{
  const s = await shapka('molchanie');
  if (s.sprosili >= 1) ok(`сайт спросил счётчик (${s.sprosili} раз)`);
  else no('сайт вообще не спрашивал счётчик — число снова мёртвое');
  if (s.chislo === ZASEV) ok(`в шапке ${s.vidno} — засев на месте`);
  else no(`в шапке ${s.vidno}, а должен быть засев ${ZASEV}`);
  if (s.cls < 0.001) ok(`CLS ${s.cls.toFixed(4)}`);
  else no(`CLS ${s.cls.toFixed(4)} — раскладка поехала`);
}

console.log('\n── бот ответил: число выросло ровно на сказанное ──');
for (const vydano of [1, 7, 123]) {
  const s = await shapka({ telo: { vydano } });
  if (s.chislo === ZASEV + vydano) ok(`выдано ${vydano} → в шапке ${s.vidno}`);
  else no(`выдано ${vydano} → в шапке ${s.vidno}, ждали ${ZASEV + vydano}`);
  if (s.cls >= 0.001) no(`CLS ${s.cls.toFixed(4)} — обновление числа сдвинуло раскладку`);
}
{
  const s = await shapka({ telo: { vydano: 42 } });
  if (s.cls < 0.001) ok(`CLS ${s.cls.toFixed(4)} при выросшем числе`);
  else no(`CLS ${s.cls.toFixed(4)}`);
}

console.log('\n── мусор в ответе засев не портит ──');
for (const [imya, otvet] of [
  ['ноль как «не сосчитали» (503)', { status: 503, telo: { vydano: null } }],
  ['null в теле', { telo: { vydano: null } }],
  ['дробное', { telo: { vydano: 1.5 } }],
  ['отрицательное', { telo: { vydano: -10 } }],
  ['строка вместо числа', { telo: { vydano: '99' } }],
  ['поля нет вовсе', { telo: {} }],
  ['не JSON', { telo: 'здравствуйте' }],
  ['404: путь в nginx не разложен', { status: 404, telo: 'не найдено' }],
]) {
  const s = await shapka(otvet);
  if (s.chislo === ZASEV) ok(`${imya} → ${s.vidno}`);
  else no(`${imya} → в шапке ${s.vidno}, а должен быть засев ${ZASEV}`);
}

console.log('\n── телефон ──');
{
  const s = await shapka({ telo: { vydano: 5 } }, { mobilnyy: true });
  if (s.chislo === ZASEV + 5) ok(`в шапке ${s.vidno}`);
  else no(`в шапке ${s.vidno}, ждали ${ZASEV + 5}`);
  if (s.cls < 0.001) ok(`CLS ${s.cls.toFixed(4)}`);
  else no(`CLS ${s.cls.toFixed(4)}`);
}

await browser.close();
console.log(bad ? `\nПЛОХО: ${bad}` : '\nХОРОШО');
process.exit(bad ? 1 : 0);
