/**
 * Страница оферты: контраст, оглавление и перекрытие пузырей.
 *
 * Общий `check-contrast` сюда не годится — он ждёт селекторы витрины
 * и на правовой странице упирается в таймаут. Здесь свой обход,
 * и он печатает число проверенных узлов: проверка, которая перестала
 * что-либо мерить, опаснее упавшей.
 *
 * Три вопроса, и каждый ломается молча:
 *   1. читается ли текст договора в обеих темах;
 *   2. ведут ли ссылки оглавления в существующие разделы — битый
 *      якорь в документе на 39 пунктов глазами не найти;
 *   3. закрывает ли лист бумаги пузыри. Запретные прямоугольники
 *      стерегут только селекторы главной, а под текстом договора
 *      краски быть не должно — здесь её нет потому, что подложка
 *      непрозрачна, и это надо проверять, а не предполагать.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/oferta/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PROBA = ['.doc__title', '.doc__zagolovok', '.doc__punkt-text', '.doc__nomer',
  '.doc__abzac', '.doc__termin dt', '.doc__termin dd', '.doc__rekvizit dt',
  '.doc__rekvizit dd', '.doc__soder-list a', '.doc__ssylka', '.legal__nazad'];

let bad = 0;
const ok = (t) => console.log(`  ok    ${t}`);
const ploho = (t) => { console.log(`  ПЛОХО ${t}`); bad++; };

const br = await chromium.launch({ executablePath: CHROME });

for (const tema of ['light', 'dark']) {
  console.log(`\n── ${tema} ──`);
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('neirolavka-theme', t); } catch {} }, tema);
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });

  /* 1. Контраст. Фон собирается по предкам до первой непрозрачной
        заливки: у листа он свой, у страницы свой. */
  const pary = await p.evaluate((sels) => {
    const lum = (c) => { const [r, g, b] = c.map((v) => { const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const razbor = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const fon = (el) => { for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !bg.includes('rgba(0, 0, 0, 0)')) return razbor(bg);
      } return [255, 255, 255]; };
    const out = [];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el || !el.textContent.trim()) { out.push({ sel: s, net: true }); continue; }
      const [a, b] = [lum(razbor(getComputedStyle(el).color)) + 0.05, lum(fon(el)) + 0.05]
        .sort((x, y) => y - x);
      out.push({ sel: s, k: +(a / b).toFixed(2) });
    }
    return out;
  }, PROBA);

  for (const r of pary) {
    if (r.net) { ploho(`${r.sel} — узла нет, проба смотрит не туда`); continue; }
    if (r.k < 4.5) ploho(`${String(r.k).padStart(6)}:1  ${r.sel}`);
    else ok(`${String(r.k).padStart(6)}:1  ${r.sel}`);
  }
  console.log(`  проверено узлов: ${pary.filter((r) => !r.net).length} из ${PROBA.length}`);

  /* 2. Оглавление ведёт в существующие разделы. */
  const yakorya = await p.evaluate(() => {
    const ssylki = [...document.querySelectorAll('.doc__soder a')].map((a) => a.getAttribute('href'));
    return ssylki.map((h) => ({ h, est: !!document.querySelector(h) }));
  });
  const bitye = yakorya.filter((y) => !y.est);
  if (yakorya.length === 0) ploho('оглавления нет вовсе');
  else if (bitye.length) ploho(`битые якоря: ${bitye.map((y) => y.h).join(', ')}`);
  else ok(`оглавление: ${yakorya.length} ссылок, все ведут в существующие разделы`);

  /* 3. Лист закрывает пузыри: под текстом договора краски нет. */
  const holst = await p.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return 'нет холста';
    const list = document.querySelector('.doc');
    if (!list) return 'нет листа';
    const r = list.getBoundingClientRect();
    const s = getComputedStyle(list);
    // Подложка обязана быть непрозрачной: полупрозрачная пропустит
    // пузырь сквозь себя, и краска ляжет на буквы договора.
    const alpha = (s.backgroundColor.match(/[\d.]+/g) || [])[3];
    return { neprozrachna: alpha === undefined || Number(alpha) === 1, shirina: Math.round(r.width) };
  });
  if (typeof holst === 'string') ploho(`проба перекрытия не нашла предмет: ${holst}`);
  else if (!holst.neprozrachna) ploho('лист документа полупрозрачен — пузыри просвечивают сквозь текст');
  else ok(`лист непрозрачен, ширина ${holst.shirina} px — пузыри под ним не видны`);

  await ctx.close();
}

await br.close();
console.log(bad ? `\nПЛОХО: ${bad} замечаний` : '\nОферта: текст читается, оглавление ведёт куда надо, лист закрывает пузыри');
process.exit(bad ? 1 : 0);
