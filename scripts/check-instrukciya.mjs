/**
 * Страница инструкции и ДВА входа в неё.
 *
 * Общий `check-contrast` сюда не годится: он ждёт селекторы витрины
 * и на этой странице упирается в таймаут — ровно как на оферте.
 * Здесь свой обход, и он печатает число проверенных узлов: проверка,
 * которая перестала что-либо мерить, опаснее упавшей.
 *
 * Пять вопросов, и каждый ломается молча:
 *
 *   1. ЧИТАЕТСЯ ЛИ ТЕКСТ страницы в обеих темах.
 *
 *   2. НЕ СТАЛ ЛИ СНИМОК ЯРКИМ ПЯТНОМ В ТЁМНОЙ ТЕМЕ. Картинки —
 *      это снимки самого сайта в СВЕТЛОЙ теме, и без вуали они
 *      дают к сумеречному фону перепад 18:1, то есть светлее любого
 *      текста страницы. Порог тут ДВУСТОРОННИЙ, и это не педантизм:
 *      вуаль, закрученная до непрозрачности, «исправит» яркость
 *      тем, что снимка не станет видно вовсе. Проверка обязана
 *      краснеть и на снятую вуаль, и на задранную.
 *
 *   3. НЕ ПОСТРАДАЛ ЛИ ТЕКСТ ВНУТРИ СНИМКА. Вуаль кладётся на всю
 *      площадь разом, поэтому контраст внутри картинки она сжимает,
 *      а не рушит, — но это надо мерить, а не предполагать.
 *
 *   4. ЗАКРЫВАЕТ ЛИ ЛИСТ ПУЗЫРИ. Запретные прямоугольники
 *      в bubbles-gl.ts стерегут селекторы главной; здесь краски
 *      на буквах нет потому, что подложка непрозрачна.
 *
 *   5. РАБОТАЮТ ЛИ ОБА ВХОДА — пункт шапки (и на телефоне тоже)
 *      и плашка в блоке «Как это работает». Плашка при этом обязана
 *      лежать СНАРУЖИ списка шагов: внутри <ol> она получила бы
 *      номер «4», а `useStepTrack` растянул бы к ней дорожку
 *      светодиода.
 *
 * Меряется по НАСТОЯЩИМ ПИКСЕЛЯМ, а не по объявленным стилям:
 * вуаль — это слой поверх картинки, и вопрос «что видно» на стили
 * не отвечается.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const BAZA = (process.argv[2] ?? 'http://127.0.0.1:4173/').replace(/\/+$/, '') + '/';
const URL = BAZA + 'instrukciya/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* Текстовые узлы страницы. Заголовков шагов тут нет и быть не может:
   они набраны на самих картинках. */
const PROBA = ['.instr__title', '.instr__lead', '.shot__n', '.instr__nazad-vitrina',
  '.shapka__nazad'];

/* Пороги перепада «ПОЛЕ снимка → фон страницы».
   Поле — это белый лист внутри картинки, то самое, что светит;
   берётся 95-м процентилем блочных средних, а не средним по кадру.
   Среднее зависит от того, сколько серой карточки попало в кадр,
   и у трёх снимков выходило 7.78 / 9.00 / 9.00 на одной и той же
   вуали — то есть мера ловила содержимое картинки, а не яркость.

   В тёмной: без вуали 15.7:1, с нею 9.9. Нижняя граница стоит
   против «исправления» вуалью в упор: при alpha 0.8 поле уходит
   в 1.5:1, снимка не видно вовсе, а верхний порог при этом пройден. */
const TEMNAYA = { min: 5, max: 13 };
const SVETLAYA = { max: 1.35 };
/* Текст внутри снимка обязан оставаться читаемым в обеих темах.
   Вуаль кладётся на всю площадь разом, поэтому она контраст СЖИМАЕТ
   (20.3 → 12.4), а не рушит, — но это замер, а не рассуждение. */
const VNUTRI = 4.5;

let bad = 0;
const ok = (t) => console.log(`  ok    ${t}`);
const ploho = (t) => { console.log(`  ПЛОХО ${t}`); bad++; };

const lum = (r, g, b) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const kontrast = (a, b) => { const [h, l] = a > b ? [a, b] : [b, a]; return (h + 0.05) / (l + 0.05); };

const br = await chromium.launch({ executablePath: CHROME });

for (const tema of ['light', 'dark']) {
  console.log(`\n── ${tema} ──`);
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('neirolavka-theme', t); } catch {} }, tema);
  /* Наблюдатель ставится ДО перехода и с buffered: сдвиг случается
     на первых сотнях миллисекунд, то есть раньше, чем проба успела бы
     подписаться после goto. Через getEntriesByType этого не увидеть
     вовсе — тот список ПУСТ всегда. */
  await ctx.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });

  /* ── 1. Контраст текста ── */
  const pary = await p.evaluate((sels) => {
    const l = (c) => { const [r, g, b] = c.map((v) => { const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const razbor = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const fon = (el) => { for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !bg.includes('rgba(0, 0, 0, 0)')) return razbor(bg);
      } return [255, 255, 255]; };
    return sels.map((s) => {
      const el = document.querySelector(s);
      if (!el || !el.textContent.trim()) return { sel: s, net: true };
      const [a, b] = [l(razbor(getComputedStyle(el).color)) + 0.05, l(fon(el)) + 0.05]
        .sort((x, y) => y - x);
      return { sel: s, k: +(a / b).toFixed(2) };
    });
  }, PROBA);
  for (const r of pary) {
    if (r.net) { ploho(`${r.sel} — узла нет, проба смотрит не туда`); continue; }
    (r.k < 4.5 ? ploho : ok)(`${String(r.k).padStart(6)}:1  ${r.sel}`);
  }
  console.log(`  проверено узлов: ${pary.filter((r) => !r.net).length} из ${PROBA.length}`);

  /* ── 2–3. Снимки: яркость к фону и контраст внутри ── */
  const ramki = await p.$$('.shot__ramka');
  if (ramki.length !== 3) ploho(`рамок снимка ${ramki.length}, а шага три — проба смотрит не туда`);

  const fonStr = await p.evaluate(() => {
    const c = (getComputedStyle(document.documentElement).getPropertyValue('--c-bg') || '').trim();
    const d = document.createElement('canvas').getContext('2d');
    d.fillStyle = c; d.fillRect(0, 0, 1, 1);
    return [...d.getImageData(0, 0, 1, 1).data].slice(0, 3);
  });
  const Lfon = lum(...fonStr);

  for (let i = 0; i < ramki.length; i++) {
    await ramki[i].scrollIntoViewIfNeeded();
    await p.waitForTimeout(180);
    const kor = await ramki[i].boundingBox();
    if (!kor) { ploho(`снимок ${i + 1}: коробки нет`); continue; }
    /* Запас 14 px внутрь: скруглённые углы и волосяная кромка
       рамки в замер яркости попадать не должны. */
    const z = 14;
    const png = PNG.sync.read(await p.screenshot({
      clip: { x: kor.x + z, y: Math.max(0, kor.y + z), width: kor.width - 2 * z,
              height: Math.min(kor.height - 2 * z, 900 - Math.max(0, kor.y + z) - z) },
    }));
    /* ТЕЛО ШТРИХА — не «тёмная точка», а тёмная точка с тёмными
       соседями: по одиночным точкам меру сносит сглаживание кромок.
       Отсюда блочные средние 4x4 — и поле, и чернила берутся
       по ним. */
    const W = png.width, H = png.height, B = 4;
    const t = new Float64Array(W * H);
    for (let q = 0, k = 0; q < png.data.length; q += 4, k++)
      t[k] = lum(png.data[q], png.data[q + 1], png.data[q + 2]);
    const blok = [];
    for (let y = 0; y + B <= H; y += B) for (let x = 0; x + B <= W; x += B) {
      let sum = 0;
      for (let j = 0; j < B; j++) for (let q = 0; q < B; q++) sum += t[(y + j) * W + (x + q)];
      blok.push(sum / (B * B));
    }
    blok.sort((a, b) => a - b);
    const chernila = blok[0];
    const pole = blok[Math.floor((blok.length - 1) * 0.95)];
    const kFon = kontrast(pole, Lfon);
    const kVnutri = kontrast(pole, chernila);
    const gr = tema === 'dark' ? TEMNAYA : SVETLAYA;
    const yarko = kFon > gr.max;
    const propal = gr.min !== undefined && kFon < gr.min;
    const stroka = `снимок ${i + 1}: поле снимка к фону страницы ${kFon.toFixed(2)}:1 ` +
      `(порог ${gr.min ?? '—'}…${gr.max}), текст внутри ${kVnutri.toFixed(2)}:1, ` +
      `светлота поля ${pole.toFixed(3)}`;
    if (yarko) ploho(`${stroka} — ЯРКОЕ ПЯТНО, вуали нет или она слаба`);
    else if (propal) ploho(`${stroka} — вуаль задрана, снимок пропал в фоне`);
    else if (kVnutri < VNUTRI) ploho(`${stroka} — текст внутри снимка перестал читаться`);
    else ok(stroka);
  }

  /* ── картинки вообще загрузились и держат место ── */
  const kart = await p.evaluate(() => [...document.querySelectorAll('.shot__img')].map((im) => ({
    src: im.getAttribute('src'), gotova: im.complete && im.naturalWidth > 0,
    w: im.naturalWidth, h: im.naturalHeight,
    razmer: !!(im.getAttribute('width') && im.getAttribute('height')),
    alt: (im.getAttribute('alt') || '').trim(),
  })));
  if (kart.length !== 3) ploho(`снимков в разметке ${kart.length}, а шага три`);
  for (const k of kart) {
    if (!k.gotova) { ploho(`${k.src} не загрузился`); continue; }
    if (!k.razmer) { ploho(`${k.src}: нет width/height — страница будет прыгать`); continue; }
    if (k.alt.length < 40) { ploho(`${k.src}: alt короче 40 знаков («${k.alt}»)`); continue; }
    ok(`${k.src}  ${k.w}x${k.h}  alt ${k.alt.length} знаков`);
  }
  if (new Set(kart.map((k) => k.alt)).size !== kart.length) ploho('alt у снимков повторяются');

  /* ── 4. Лист закрывает пузыри ── */
  const list = await p.evaluate(() => {
    if (!document.querySelector('canvas')) return 'нет холста пузырей';
    const el = document.querySelector('.instr__list');
    if (!el) return 'нет листа';
    const a = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || [])[3];
    return { neprozrachen: a === undefined || Number(a) === 1,
             shirina: Math.round(el.getBoundingClientRect().width) };
  });
  if (typeof list === 'string') ploho(`проба перекрытия не нашла предмет: ${list}`);
  else if (!list.neprozrachen) ploho('лист полупрозрачен — пузыри просвечивают сквозь текст');
  else ok(`лист непрозрачен, ширина ${list.shirina} px`);

  /* ── сдвиг раскладки ── */
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(400);
  const cls = await p.evaluate(() => window.__cls ?? -1);
  if (cls < 0) ploho('наблюдатель сдвигов не завёлся — CLS не измерен');
  else if (cls > 0.005) ploho(`CLS ${cls.toFixed(4)} — страница прыгает`);
  else ok(`CLS ${cls.toFixed(4)}`);

  await ctx.close();
}

/* ── 5. Два входа на главной ── */
console.log('\n── входы на страницу ──');
for (const [w, h, imya] of [[390, 844, 'телефон 390'], [1512, 820, 'десктоп 1512']]) {
  const ctx = await br.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.goto(BAZA, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => {
    const vid = (el) => !!el && el.getClientRects().length > 0;
    const punkt = [...document.querySelectorAll('.nav__link')]
      .find((a) => (a.getAttribute('href') || '').includes('instrukciya'));
    const pl = document.querySelector('.steps__pomoshch');
    const thread = document.querySelector('.steps__thread');
    const kap = document.querySelector('.nav__inner');
    return {
      punktEst: !!punkt, punktViden: vid(punkt), punktHref: punkt?.getAttribute('href') ?? null,
      plashkaEst: !!pl, plashkaVidna: vid(pl), plashkaHref: pl?.getAttribute('href') ?? null,
      plashkaVnutriSpiska: !!document.querySelector('.steps__thread .steps__pomoshch'),
      shagov: thread ? thread.querySelectorAll('.step').length : -1,
      kapsulaVysota: kap ? +kap.getBoundingClientRect().height.toFixed(1) : -1,
      gorizont: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (!r.punktEst) ploho(`${imya}: пункта «Инструкция» в шапке нет`);
  else if (!r.punktViden) ploho(`${imya}: пункт «Инструкция» есть в разметке, но не виден`);
  else if (!r.punktHref.includes('/instrukciya/')) ploho(`${imya}: пункт ведёт на ${r.punktHref}`);
  else ok(`${imya}: пункт «Инструкция» виден, ведёт на ${r.punktHref}`);

  if (!r.plashkaEst) ploho(`${imya}: плашки «Помощь в оформлении заказа» нет`);
  else if (!r.plashkaVidna) ploho(`${imya}: плашка есть в разметке, но не видна`);
  else if (!r.plashkaHref.includes('/instrukciya/')) ploho(`${imya}: плашка ведёт на ${r.plashkaHref}`);
  else ok(`${imya}: плашка видна, ведёт на ${r.plashkaHref}`);

  if (r.plashkaVnutriSpiska) ploho(`${imya}: плашка ВНУТРИ <ol> — получит номер «4» и растянет дорожку`);
  else ok(`${imya}: плашка снаружи списка шагов`);
  if (r.shagov !== 3) ploho(`${imya}: шагов в списке ${r.shagov}, а должно быть три`);
  if (r.kapsulaVysota > 56) ploho(`${imya}: капсула шапки ушла в две строки (${r.kapsulaVysota} px)`);
  else ok(`${imya}: капсула шапки ${r.kapsulaVysota} px, горизонтальной прокрутки ${r.gorizont}`);
  await ctx.close();
}

/* Сам переход. Ссылка, ведущая в 404, хуже отсутствующей. */
{
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BAZA, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  await p.click('.steps__pomoshch', { force: true });
  await p.waitForURL(/instrukciya/, { timeout: 15000 }).catch(() => {});
  const zagolovok = await p.textContent('.instr__title').catch(() => null);
  if (zagolovok) ok(`переход по плашке открывает страницу: «${zagolovok}»`);
  else ploho('переход по плашке не открыл страницу инструкции');
  await ctx.close();
}

await br.close();
console.log(bad ? `\nПЛОХО: ${bad} замечаний` :
  '\nИнструкция: текст читается, снимки не слепят в тёмной теме, оба входа работают');
process.exit(bad ? 1 : 0);
