/**
 * Проверка страницы в настоящем браузере: все ли запросы отдались,
 * нет ли ошибок в консоли, применилась ли тема до первой отрисовки,
 * какой получился сдвиг вёрстки.
 *
 * CLS СНИМАЕТСЯ НАБЛЮДАТЕЛЕМ, И ЭТО НЕ СТИЛЬ. Здесь стояло
 * `performance.getEntriesByType('layout-shift')` — и этот список
 * ПУСТ ВСЕГДА: записи о сдвигах в общий журнал производительности
 * не кладутся, они приходят только в PerformanceObserver. То есть
 * проверка печатала `CLS: 0.0000` при любой вёрстке и не могла
 * покраснеть ни от чего: сумма по пустому списку — ноль. Ровно та
 * же поломка, что была у `check-outer-glow` без нижней границы, —
 * проверка, засчитывающая ту беду, ради которой написана.
 *
 * Поймал это новый `check-schetchik`, который меряет CLS своим
 * наблюдателем: на той же сборке у него выходило 0.0061, а здесь
 * 0.0000. Сдвиг был настоящий — блок способов оплаты схлопывался
 * layout-эффектом после первой отрисовки.
 *
 * Наблюдатель ставится ДО перехода (`addInitScript`) и с
 * `buffered: true`: сдвиг случается на первых сотнях миллисекунд,
 * то есть раньше, чем мы успели бы подписаться со стороны пробы.
 *
 * Запуск: node scripts/verify-live.mjs http://localhost:4173/neirolavka/
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * СЧЁТЧИК МЕТРИКИ НА ВРЕМЯ ЗАМЕРА ГАСИТСЯ, И ЭТО НЕ ПОСЛАБЛЕНИЕ.
 *
 * Эта проба отвечает за НАШУ страницу: её запросы, её консоль, её сдвиг
 * вёрстки. Чужой узел портил замер сразу с двух сторон, и обе — про
 * машину, с которой меряют, а не про сайт:
 *
 *   • из контейнера разработки шлюз до mc.yandex.ru не пускает вовсе,
 *     и неудачный запрос засчитывался сбоем — красный на совершенно
 *     исправной сборке;
 *   • там, где узел ДОСТУПЕН, вебвизор держит соединение открытым,
 *     и `networkidle` не наступает никогда: переход упирался в таймаут
 *     30 секунд и проба падала исключением, не сказав ни слова.
 *
 * Поэтому запросы к узлу Метрики обрываются маршрутом. Вердикт от этого
 * становится ЧИЩЕ, а не мягче: он снова про наши файлы, и он один и тот
 * же на любой машине — и там, где Яндекс виден, и там, где нет.
 * Сколько запросов заглушено, проба печатает: молчание читалось бы как
 * «счётчика нет».
 *
 * За сам счётчик отвечает check-metrika: встал ли, ушло ли попадание,
 * не двигает ли вёрстку. На боевом адресе он гоняется строгим разбором
 * (SET_DO_YANDEX=1), то есть обязан УВИДЕТЬ отправку, а не обойти её.
 *
 * Имя узла читается из src/lib/metrika.ts, а не вписано сюда строкой.
 */
const UZEL_METRIKI = (readFileSync('src/lib/metrika.ts', 'utf8')
  .match(/export const METRIKA_HOST\s*=\s*'([^']+)'/) || [])[1];
if (!UZEL_METRIKI) {
  console.log('ПЛОХО: в src/lib/metrika.ts не нашёлся METRIKA_HOST — проба устарела');
  process.exit(1);
}

const URL = process.argv[2];
const browser = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });

let bad = 0;
for (const path of ['']) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const z of l.getEntries()) if (!z.hadRecentInput) window.__cls += z.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });

  // Гасим счётчик ДО перехода: иначе он либо не отвечает и портит
  // список сбоев, либо отвечает и держит соединение вебвизором.
  let zaglusheno = 0;
  // Условие — функция, а не образец: образец `**://*.yandex.ru/**`
  // легко разъезжается с настоящим адресом, а промах здесь читается
  // как «счётчика нет», то есть врёт в ту же сторону, что и поломка.
  // Отвечаем ПУСТОТОЙ, а не обрывом. Обрыв пишет в консоль
  // «Failed to load resource: net::ERR_FAILED» без адреса — по такой
  // строке свой обрыв не отличить от чужой поломки, и проба краснела
  // бы на собственной уборке.
  await page.route(
    (u) => u.hostname === UZEL_METRIKI,
    (route) => {
      zaglusheno++;
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    },
  );

  const failed = [];
  const console_ = [];
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  // Отменённые предзагрузки next/link — не сбой: их прерывает
  // закрытие вкладки, а не сервер.
  page.on('requestfailed', (r) => {
    if (r.failure()?.errorText === 'net::ERR_ABORTED') return;
    if (r.url().includes(UZEL_METRIKI)) return; // оборвали сами
    failed.push(`СБОЙ ${r.url()} — ${r.failure()?.errorText}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    console_.push(m.text());
  });
  page.on('pageerror', (e) => console_.push(String(e)));

  const url = URL + path;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    display: getComputedStyle(document.querySelector('h1, .fonts__title')).fontFamily,
    fontsLoaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    cls: window.__cls ?? 0,
  }));

  console.log(`\n── ${url}`);
  console.log(`   тема: ${info.theme}, фон: ${info.bg}`);
  console.log(`   гарнитура заголовка: ${info.display}`);
  console.log(`   загруженные гарнитуры: ${info.fontsLoaded.join(', ') || 'нет'}`);
  console.log(`   CLS: ${info.cls.toFixed(4)}`);
  console.log(`   неудачных запросов: ${failed.length}${failed.length ? '\n     ' + failed.join('\n     ') : ''}`);
  // Молчать здесь нельзя: ноль оборванных запросов значит, что счётчика
  // на странице нет вовсе, а это уже вопрос к check-metrika.
  console.log(`   счётчик Метрики заглушен на время замера: ${zaglusheno} запрос(ов)`);
  console.log(`   ошибок в консоли: ${console_.length}${console_.length ? '\n     ' + console_.join('\n     ') : ''}`);
  if (failed.length || console_.length || info.cls > 0.001) bad++;
  await ctx.close();
}

await browser.close();
console.log(bad ? `\nПроблемы на ${bad} страницах` : '\nОбе страницы чистые');
process.exit(bad ? 1 : 0);
