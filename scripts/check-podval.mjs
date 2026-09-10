/**
 * Подвал: реквизиты продавца и рабочие ссылки.
 *
 * Проверяется НЕ «нарисовалось ли», а то, ради чего это сделано:
 *   • реквизиты на странице совпадают с тем, что лежит в `prodavec.ts`
 *     — второй экземпляр ИНН в разметке разъехался бы с первым молча;
 *   • телефон НАБИРАЕТСЯ, а почта ОТКРЫВАЕТ ПИСЬМО: у ссылок должны
 *     быть схемы `tel:` и `mailto:`, а не просто синий текст;
 *   • в `tel:` нет пробелов и дефисов — часть набиралок на них
 *     спотыкается, и номер уходит обрезанным;
 *   • ссылок на НЕСУЩЕСТВУЮЩИЕ страницы в подвале нет. Это главная
 *     проба здесь: 404 на месте оферты — хуже отсутствующей ссылки,
 *     потому что человек идёт по ней ровно перед тем, как заплатить.
 *
 * Проверено на способность падать: телефон с пробелами в `tel:`,
 * ссылка на несуществующий путь и разошедшийся с модулем ИНН —
 * краснеют по отдельности.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* Ожидаемое берётся ИЗ ИСХОДНИКА, а не вписывается сюда строкой:
   вписанные реквизиты устаревают вместе с прайсом — тот же закон,
   что у имён товаров в check-live и у ZHIVOY_PLAN в проверках бота. */
const ISHODNIK = readFileSync('src/lib/prodavec.ts', 'utf8');
const pole = (imya) => {
  const m = ISHODNIK.match(new RegExp(`${imya}:\\s*'([^']+)'`));
  if (!m) {
    console.log(`ПЛОХО: в prodavec.ts не нашлось поле «${imya}» — проба устарела`);
    process.exit(1);
  }
  return m[1];
};
const OZHIDAEM = { imya: pole('imya'), inn: pole('inn'), ogrnip: pole('ogrnip'), pochta: pole('pochta') };
const TELEFON = (ISHODNIK.match(/telefon\('([^']+)'\)/) || [])[1];
if (!TELEFON) { console.log('ПЛОХО: в prodavec.ts не нашёлся телефон — проба устарела'); process.exit(1); }

let bad = 0;
const ok = (t) => console.log(`  ok    ${t}`);
const plohо = (t) => { console.log(`  ПЛОХО ${t}`); bad++; };

const br = await chromium.launch({ executablePath: CHROME });

for (const [w, tema, imya] of [[1512, 'light', 'десктоп, светлая'], [1512, 'dark', 'десктоп, тёмная'], [390, 'light', 'телефон, светлая']]) {
  console.log(`\n── ${imya} ──`);
  const ctx = await br.newContext({ viewport: { width: w, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('neirolavka-theme', t); } catch {} }, tema);
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });

  const podval = p.locator('.footer__bottom');
  if (await podval.count() === 0) { plohо('подвала нет вовсе — проба смотрит не туда'); await ctx.close(); continue; }
  const tekst = (await podval.innerText()).replace(/\s+/g, ' ');

  for (const [chto, znach] of Object.entries(OZHIDAEM)) {
    if (tekst.includes(znach)) ok(`${chto}: «${znach}» на месте`);
    else plohо(`${chto}: «${znach}» из prodavec.ts на странице НЕ найдено`);
  }
  if (tekst.includes(TELEFON)) ok(`телефон: «${TELEFON}» на месте`);
  else plohо(`телефон: «${TELEFON}» на странице не найден`);

  /* Ссылки: схема и содержимое. */
  const ssylki = await podval.locator('a[href]').evaluateAll((els) =>
    els.map((e) => ({ href: e.getAttribute('href'), tekst: e.textContent.trim() })));

  const tel = ssylki.find((s) => s.href.startsWith('tel:'));
  if (!tel) plohо('телефон не ссылка: схемы tel: в подвале нет — по нему не набрать');
  else if (/[^\d+]/.test(tel.href.slice(4))) plohо(`в tel: остались пробелы или дефисы: «${tel.href}»`);
  else if (tel.href.slice(4).replace(/\D/g, '') !== TELEFON.replace(/\D/g, '')) plohо(`tel: «${tel.href}» не тот номер, что показан`);
  else ok(`телефон набирается: ${tel.href}`);

  const mail = ssylki.find((s) => s.href.startsWith('mailto:'));
  if (!mail) plohо('почта не ссылка: схемы mailto: в подвале нет — письмо не откроется');
  else if (mail.href.slice(7) !== OZHIDAEM.pochta) plohо(`mailto: «${mail.href}» не тот адрес`);
  else ok(`почта открывает письмо: ${mail.href}`);

  /* Внутренние ссылки обязаны вести на существующие страницы. */
  const svoi = ssylki.filter((s) => s.href.startsWith('/'));
  for (const s of svoi) {
    const put = s.href.replace(/^\//, '').replace(/\/$/, '');
    const est = existsSync(`out/${put}.html`) || existsSync(`out/${put}/index.html`);
    if (est) ok(`документ «${s.tekst}» → ${s.href} — страница есть`);
    else plohо(`«${s.tekst}» ведёт на ${s.href}, а такой страницы в выдаче НЕТ — это 404 на месте документа`);
  }
  if (svoi.length === 0) console.log('  —     ссылок на документы нет (страниц пока не существует)');

  await ctx.close();
}

await br.close();
console.log(bad ? `\nПЛОХО: ${bad} замечаний` : '\nПодвал: реквизиты на месте, телефон и почта рабочие, битых ссылок нет');
process.exit(bad ? 1 : 0);
