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
 *      и поздний ответ бота не имеет права его испортить;
 *   5. число РАЗБЕГАЕТСЯ снизу, а не встаёт готовым и не
 *      перескакивает с засева на настоящее — ради этого весь заход.
 *      Разбег проверяется РЯДОМ КАДРОВ, а не одним снимком: одиночный
 *      снимок «в шапке правильное число» одинаково зелен и с разбегом,
 *      и без него;
 *   6. при `prefers-reduced-motion` разбега нет вовсе, и число стоит
 *      настоящее с первого кадра.
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
async function shapka(otvet, { mobilnyy = false, pokoy = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobilnyy ? { width: 390, height: 844 } : { width: 1512, height: 900 },
    locale: 'ru-RU',
    isMobile: mobilnyy,
    hasTouch: mobilnyy,
    ...(pokoy ? { reducedMotion: 'reduce' } : {}),
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

    /* РЯД КАДРОВ, а не один снимок. Разбег живёт полсекунды, и
       увидеть его можно только тем, что число в кадрах РАЗНОЕ.
       Заодно каждый кадр записывается ШИРИНА коробки числа: если
       она дышит, вместе с ней ездит вся строка шапки.

       ЧИТАТЬ `innerText` У КОРОБКИ НЕЛЬЗЯ: `visibility: hidden`
       прячет узел от глаза, но НЕ от innerText — тот отдавал
       «24172417», два числа подряд, и проба принимала это за третье
       значение разбега. Видимое собирается по правилу самой
       вёрстки: есть текст в узле разбега — видно его, пусто —
       видно разметочное.

       ШИРИНА берётся `offsetWidth`, а не по `getBoundingClientRect`:
       второй меряет НАРИСОВАННОЕ, то есть вместе с появлением блоков
       (проявление плюс лёгкий масштаб). На нём подпись «ездила»
       на 1.1 px при совершенно неподвижной раскладке — это была
       анимация появления, а не дыхание коробки. */
    window.__ryad = [];
    const tik = () => {
      const u = document.querySelector('.nav__counter-number');
      const beg = document.querySelector('.nav__counter-run');
      const nast = document.querySelector('.nav__counter-true');
      if (u && beg && nast) {
        const tekst = beg.textContent ?? '';
        window.__ryad.push({
          t: Math.round(performance.now()),
          v: (tekst !== '' ? tekst : nast.textContent ?? '').trim(),
          bezhit: tekst !== '',
          // Спрятано ли настоящее число, пока бежит подменное.
          // Без этой записи проба не отличила бы «одно число
          // на экране» от «два числа рядом».
          spryatano: getComputedStyle(nast).visibility === 'hidden',
          shirina: u.offsetWidth,
        });
      }
      if (performance.now() < 2600) requestAnimationFrame(tik);
    };
    requestAnimationFrame(tik);
  });
  await page.goto(ADRES, { waitUntil: 'networkidle' });
  /* Ответ приходит после первой отрисовки: ждём, пока страница
     успокоится, иначе меряем состояние до обновления числа. */
  await page.waitForTimeout(900);

  const uzel = page.locator('.nav__counter-number');
  const vidno = (await uzel.count()) ? (await uzel.first().innerText()).trim() : null;
  const cls = await page.evaluate(() => window.__cls ?? 0);
  const ryad = await page.evaluate(() => window.__ryad ?? []);
  await ctx.close();
  return { vidno, chislo: vidno === null ? null : chislo(vidno), cls, sprosili, ryad };
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

/** Ряд кадров → числа, в порядке появления, без повторов подряд. */
const hod = (ryad) => {
  const out = [];
  for (const k of ryad) {
    const n = chislo(k.v);
    if (!Number.isFinite(n)) continue;
    if (out.length === 0 || out[out.length - 1] !== n) out.push(n);
  }
  return out;
};

console.log('\n── РАЗБЕГ: число растёт снизу, а не перескакивает ──');
{
  const cel = ZASEV + 96;
  const s = await shapka({ telo: { vydano: 96 } });

  /* ДО ПЕРВОГО КАДРА РАЗБЕГА В ШАПКЕ ОБЯЗАН СТОЯТЬ ЗАСЕВ.
     Это и есть ответ на «ноль не должен попасть на экран»:
     узел разбега пуст, видно разметочное число. */
  const doBega = s.ryad.filter((k) => !k.bezhit);
  const chuzhoe = doBega.filter((k) => chislo(k.v) !== ZASEV);
  if (doBega.length === 0 || chuzhoe.length === 0) ok(`до разбега в шапке засев (${doBega.length} кадров)`);
  else no(`до разбега показано не то: ${chuzhoe.slice(0, 3).map((k) => k.v).join(', ')}`);

  const beg = s.ryad.filter((k) => k.bezhit);
  const ryad = hod(beg);
  if (ryad.length >= 8) ok(`разных чисел за разбег: ${ryad.length} (кадров ${beg.length})`);
  else no(`разных чисел всего ${ryad.length} из ${beg.length} кадров — это не разбег, а скачок`);

  /* НАЧАЛО ОБЯЗАНО БЫТЬ МАЛЕНЬКИМ. Иначе «разбег» вышел бы
     от 2 400 к 2 513 — движение есть, а смысла нет: место,
     с которого стартовали, читается настоящим числом. */
  const pervoe = ryad[0];
  if (pervoe !== undefined && pervoe < cel * 0.3) ok(`первый кадр разбега ${pervoe} — это ${Math.round((pervoe / cel) * 100)} % цели`);
  else no(`первый кадр разбега ${pervoe} слишком близко к цели ${cel}: так он читается настоящим числом`);

  // Ни одного шага назад и ни одного перелёта: число только растёт
  // и приходит ровно в цель. Шаг назад здесь означал бы, что смена
  // цели на бегу начала разбег заново, а не продолжила с места.
  const nazad = ryad.filter((n, i) => i > 0 && n < ryad[i - 1]).length;
  if (nazad === 0) ok('ни одного шага назад');
  else no(`число шло назад ${nazad} раз: ${ryad.join(' → ')}`);

  const vyshe = ryad.filter((n) => n > cel).length;
  if (vyshe === 0) ok('перелётов за цель нет');
  else no(`число перелетало цель ${vyshe} раз`);

  const poslednee = ryad[ryad.length - 1];
  if (poslednee === cel) ok(`пришло ровно в ${poslednee}`);
  else no(`пришло в ${poslednee}, а цель ${cel}`);

  // Два числа на экране разом — ровно та поломка, ради которой
  // настоящее прячется: коробку оно держит, а глазу не мешает.
  const oba = beg.filter((k) => !k.spryatano).length;
  if (oba === 0) ok('пока бежит подменное, настоящее спрятано во всех кадрах');
  else no(`в ${oba} кадрах настоящее число не спрятано — на экране их два`);

  /* КОРОБКА НЕ ДЫШИТ. Главная проба после самого разбега: пока
     число растёт от двух знаков к четырём, ширина обязана стоять. */
  const shiriny = [...new Set(s.ryad.map((k) => k.shirina))];
  if (shiriny.length === 1) ok(`ширина коробки ${shiriny[0]} px все ${s.ryad.length} кадров`);
  else no(`ширина коробки менялась: ${shiriny.join(', ')} px`);

  if (s.cls < 0.001) ok(`CLS ${s.cls.toFixed(4)}`);
  else no(`CLS ${s.cls.toFixed(4)} — разбег сдвинул раскладку`);
}

console.log('\n── бот молчит: разбег приходит на засев ──');
{
  const s = await shapka('molchanie');
  const ryad = hod(s.ryad.filter((k) => k.bezhit));
  if (ryad.length >= 8) ok(`разбег идёт и без ответа бота: ${ryad.length} разных чисел`);
  else no(`разбега нет: ${ryad.length} разных чисел — при молчащем боте число обязано вести себя как обычно`);
  const poslednee = ryad[ryad.length - 1];
  if (poslednee === ZASEV) ok(`пришло на засев ${poslednee}`);
  else no(`пришло в ${poslednee}, а засев ${ZASEV}`);
  const shiriny = [...new Set(s.ryad.map((k) => k.shirina))];
  if (shiriny.length === 1) ok(`ширина коробки ${shiriny[0]} px`);
  else no(`ширина коробки менялась: ${shiriny.join(', ')} px`);
}

console.log('\n── выключенное движение: разбега нет вовсе ──');
{
  const cel = ZASEV + 96;
  const s = await shapka({ telo: { vydano: 96 } }, { pokoy: true });
  const ryad = hod(s.ryad);
  /* Промежуточных чисел быть не должно НИ ОДНОГО: при выключенном
     движении в шапке стоит сперва засев, потом настоящее — смена
     мгновенная, и это честный ответ, а не разбег в один кадр. */
  const lishnie = ryad.filter((n) => n !== ZASEV && n !== cel);
  if (lishnie.length === 0) ok(`показано только ${ryad.join(' → ')}`);
  else no(`при выключенном движении мелькали промежуточные числа: ${lishnie.slice(0, 6).join(', ')}`);
  if (s.chislo === cel) ok(`пришло в настоящее: ${s.vidno}`);
  else no(`в шапке ${s.vidno}, ждали ${cel}`);
  if (s.cls < 0.001) ok(`CLS ${s.cls.toFixed(4)}`);
  else no(`CLS ${s.cls.toFixed(4)}`);
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
