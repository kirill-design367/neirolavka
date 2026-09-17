/**
 * Яндекс Метрика: встала ли она на все страницы и отправляет ли данные.
 *
 * Что проверяется:
 *   • счётчик есть в РАЗМЕТКЕ каждой страницы — главная, оферта, 404;
 *   • номер счётчика ОДИН И ТОТ ЖЕ в трёх местах: адрес скрипта, вызов
 *     `init` и пиксель для тех, у кого выключен JavaScript;
 *   • настройки из кода владельца доехали дословно (webvisor, clickmap,
 *     ecommerce, accurateTrackBounce, trackLinks, ssr);
 *   • в браузере `ym` заводится, а `tag.js` вставляется ПЕРВЫМ скриптом
 *     в head — это и есть «как можно ближе к началу страницы»;
 *   • скрипт темы по-прежнему отрабатывает (Метрика встала перед ним);
 *   • счётчик не сдвигает вёрстку (CLS снимается наблюдателем).
 *
 * НОМЕР СЧЁТЧИКА ЧИТАЕТСЯ ИЗ `src/lib/metrika.ts`, а не вписан сюда
 * строкой. Вписанный, он устарел бы вместе со счётчиком молча — тот же
 * закон, по которому `check-live` берёт имена товаров из каталога,
 * а `check-otzyvy` — тексты отзывов. Не нашёлся номер в исходнике —
 * это ОТКАЗ словами, а не исключение посреди прогона.
 *
 * ОТПРАВКА ДАННЫХ ПРОВЕРЯЕТСЯ ТОЛЬКО ТАМ, ОТКУДА ВИДЕН ЯНДЕКС.
 * Из контейнера разработки шлюз до `mc.yandex.ru` не пускает (403
 * на CONNECT), и без оговорки проверка молча зеленела бы на самом
 * важном. Поэтому:
 *
 *   • `SET_DO_YANDEX=1` — строгий разбор: `tag.js` ОБЯЗАН загрузиться
 *     и попадание ОБЯЗАНО уйти на `/watch/<номер>`. Так она гоняется
 *     на боевом адресе из прогона GitHub (тот же приём, что
 *     `SET_DO_TELEGRAM` у `check-bot-links`);
 *   • без него узел сначала прощупывается, и если он недоступен —
 *     проверка ГРОМКО говорит, что отправка НЕ проверена, и пишет это
 *     в итог. Зелёный итог без этой строки невозможен.
 *
 * Запуск: node scripts/check-metrika.mjs http://localhost:4173/
 *         SET_DO_YANDEX=1 node scripts/check-metrika.mjs https://neirolavka.ru/
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BAZA = (process.argv[2] || '').replace(/\/?$/, '/');
if (!BAZA || BAZA === '/') {
  console.log('ПЛОХО: не задан адрес. node scripts/check-metrika.mjs <url>');
  process.exit(1);
}
const STROGO = process.env.SET_DO_YANDEX === '1';

// ── Источник правды: номер счётчика и узел Метрики ──────────────────
const ISHODNIK = readFileSync('src/lib/metrika.ts', 'utf8');
const nomer = ISHODNIK.match(/export const METRIKA_ID\s*=\s*(\d+)/);
const uzel = ISHODNIK.match(/export const METRIKA_HOST\s*=\s*'([^']+)'/);
if (!nomer || !uzel) {
  console.log('ПЛОХО: в src/lib/metrika.ts не нашлись METRIKA_ID и METRIKA_HOST — проба устарела');
  process.exit(1);
}
const ID = nomer[1];
const UZEL = uzel[1];
console.log(`счётчик ${ID} на ${UZEL}; разбор отправки: ${STROGO ? 'СТРОГИЙ' : 'мягкий'}`);

// Настройки из кода владельца. Каждая — отдельной строкой: пропавшая
// должна называться по имени, а не теряться в одном длинном сравнении.
const NASTROYKI = [
  'ssr:true',
  'webvisor:true',
  'clickmap:true',
  'ecommerce:"dataLayer"',
  'accurateTrackBounce:true',
  'trackLinks:true',
];

let plohо = 0;
const net = (s) => { console.log(`  ПЛОХО: ${s}`); plohо++; };
const da = (s) => console.log(`  хорошо: ${s}`);

// ── 1. Разметка каждой страницы ─────────────────────────────────────
const STRANICY = [
  ['главная', ''],
  ['оферта', 'oferta/'],
  ['404', '404.html'],
];

for (const [imya, put] of STRANICY) {
  const url = BAZA + put;
  console.log(`\n── разметка: ${imya} (${url})`);
  let html;
  try {
    const r = await fetch(url);
    html = await r.text();
    if (!r.ok && put !== '404.html') net(`страница ответила ${r.status}`);
  } catch (e) {
    net(`страница не открылась: ${e.message}`);
    continue;
  }

  const golova = html.slice(0, html.indexOf('</head>') + 1);
  if (golova.length < 10) { net('в ответе нет </head> — это не страница сайта'); continue; }

  // РАЗБИРАЕМ ИМЕННО ТЕЛО СКРИПТА, а не всю страницу поиском подстроки.
  // Next кладёт разметку второй раз внутрь своего RSC-груза
  // (`self.__next_f.push`), уже экранированной: `\"dataLayer\"` вместо
  // `"dataLayer"`. Проба, искавшая подстроки по всему html, на порче
  // «снят скрипт из head» находила этот двойник и называла НЕ ТУ
  // причину — «счётчик есть, но не в head» плюс «потеряна настройка
  // ecommerce». Названная не та причина уводит от настоящей.
  const vstroennye = [...golova.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const schet = vstroennye.find((t) => t.includes('/metrika/tag.js'));
  if (!schet) {
    net('в <head> нет встроенного скрипта счётчика');
  } else {
    const tag = `https://${UZEL}/metrika/tag.js?id=${ID}`;
    if (!schet.includes(tag)) net(`в скрипте счётчика не тот адрес: ждали ${tag}`);
    else da('счётчик в <head>');

    // Номер в вызове init — свой, и он обязан совпасть с номером в адресе.
    const init = schet.match(/ym\((\d+),\s*'init',\s*\{([^}]*)\}/);
    if (!init) net("не нашёлся вызов ym(<номер>, 'init', {…})");
    else {
      if (init[1] !== ID) net(`номер в init — ${init[1]}, а в адресе скрипта ${ID}: счётчики разъехались`);
      else da(`init на тот же счётчик ${ID}`);
      const bez = (x) => x.replace(/\s+/g, '');
      const poterjano = NASTROYKI.filter((n) => !bez(init[2]).includes(bez(n)));
      if (poterjano.length) net(`в init потеряны настройки: ${poterjano.join(', ')}`);
      else da(`все ${NASTROYKI.length} настроек на месте`);
    }
  }

  const pixel = `https://${UZEL}/watch/${ID}`;
  // <noscript> на странице может быть не один — смотрим все.
  const ns = [...html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/g)];
  if (!ns.some((m) => m[1].includes(pixel))) net(`нет пикселя ${pixel} в <noscript>`);
  else da('пиксель для страниц без JavaScript на месте');
}

// ── 2. Живая страница в браузере ────────────────────────────────────
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

let uzelViden = false;

for (const [imya, put] of [['главная', ''], ['оферта', 'oferta/']]) {
  const url = BAZA + put;
  console.log(`\n── браузер: ${imya} (${url})`);
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  const page = await ctx.newPage();

  // CLS снимается НАБЛЮДАТЕЛЕМ и ставится ДО перехода: записи о сдвигах
  // в общий журнал производительности не кладутся вовсе.
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const z of l.getEntries()) if (!z.hadRecentInput) window.__cls += z.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });

  const zaprosy = [];
  const otvety = [];
  const oshibki = [];
  page.on('request', (r) => { if (r.url().includes(UZEL)) zaprosy.push(r.url()); });
  page.on('response', (r) => { if (r.url().includes(UZEL)) otvety.push([r.status(), r.url()]); });
  page.on('console', (m) => { if (m.type() === 'error') oshibki.push(m.text()); });
  page.on('pageerror', (e) => oshibki.push(String(e)));

  // networkidle здесь не годится: вебвизор держит соединение открытым.
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  const v = await page.evaluate(() => {
    const golova = [...document.head.querySelectorAll('script[src]')].map((s) => s.src);
    return {
      ym: typeof window.ym,
      pervyy: golova[0] || '',
      tema: document.documentElement.dataset.theme || '',
      cls: window.__cls ?? 0,
    };
  });

  if (v.ym !== 'function') net(`window.ym не завёлся (${v.ym})`);
  else da('window.ym заведён');

  if (!v.pervyy.includes(`${UZEL}/metrika/tag.js`))
    net(`первый скрипт в head — не счётчик, а ${v.pervyy || 'ничего'}`);
  else da('счётчик вставлен ПЕРВЫМ скриптом в head');

  if (v.tema !== 'light' && v.tema !== 'dark') net(`скрипт темы не отработал: data-theme = «${v.tema}»`);
  else da(`скрипт темы отработал (${v.tema})`);

  if (v.cls > 0.001) net(`CLS ${v.cls.toFixed(4)} — счётчик двигает вёрстку`);
  else da(`CLS ${v.cls.toFixed(4)}`);

  const svoi = oshibki.filter((o) => /yandex|\bym\b|metrika/i.test(o));
  if (svoi.length) net(`ошибки про счётчик в консоли: ${svoi.join(' | ')}`);
  else da('ошибок про счётчик в консоли нет');

  const tagZapros = zaprosy.some((u) => u.includes(`/metrika/tag.js?id=${ID}`));
  if (!tagZapros) net(`браузер не запросил ${UZEL}/metrika/tag.js?id=${ID}`);
  else da('браузер запросил скрипт счётчика');

  const tagOtvet = otvety.find(([, u]) => u.includes('/metrika/tag.js'));
  const popadanie = zaprosy.filter((u) => u.includes(`/watch/${ID}`));

  if (tagOtvet && tagOtvet[0] === 200) {
    uzelViden = true;
    da(`скрипт счётчика загрузился (${tagOtvet[0]})`);
    if (!popadanie.length) net(`счётчик загрузился, но попадание на /watch/${ID} НЕ ушло`);
    else da(`попадание ушло: ${popadanie.length} запрос(ов) на /watch/${ID}`);
  } else if (STROGO) {
    net(`строгий разбор: скрипт счётчика не загрузился (${tagOtvet ? tagOtvet[0] : 'ответа нет'})`);
  } else {
    console.log(`  !! УЗЕЛ ${UZEL} ОТСЮДА НЕДОСТУПЕН — ОТПРАВКА ДАННЫХ НЕ ПРОВЕРЕНА.`);
    console.log('     Это ответ сети, а не вердикт о сайте. Строгий разбор —');
    console.log('     SET_DO_YANDEX=1, он гоняется на боевом адресе из прогона GitHub.');
  }

  await ctx.close();
}

await browser.close();

console.log('');
if (!uzelViden && !STROGO) {
  console.log('ИТОГ: разметка и поведение счётчика проверены, ОТПРАВКА ДАННЫХ — НЕТ');
  console.log('      (узел Метрики из этой сети не виден; строгий разбор — SET_DO_YANDEX=1)');
}
console.log(plohо ? `ПЛОХО: ${plohо} замечаний` : 'Счётчик на месте, замечаний нет');
process.exit(plohо ? 1 : 0);
