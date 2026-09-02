/**
 * Контраст на настоящей отрисованной странице, а не по списку токенов.
 *
 * Обходим каждый узел с текстом, вычисляем фактический цвет текста и
 * фактический фон (поднимаясь по предкам, пока фон не станет
 * непрозрачным), и считаем контраст по WCAG 2.1.
 *
 * Порог: 4.5:1 для обычного текста, 3:1 для крупного (18.66px жирный
 * или 24px обычный) — как определено в самом стандарте.
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const browser = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });

const AUDIT = () => {
  // Цвет разбираем не регулярным выражением, а холстом: браузер сам
  // переводит любой синтаксис — color-mix в oklab, color(srgb ...), lab —
  // в готовые каналы. Разбор строки на этих записях врал.
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 1;
  const cx = cvs.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const parse = (c) => {
    if (cache.has(c)) return cache.get(c);
    // На очищенном холсте getImageData возвращает уже разделённые
    // каналы и настоящую альфу — разбирать строку не нужно.
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    const v = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    cache.set(c, v);
    return v;
  };

  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  });
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  // Фон определяем попаданием в точку, а не обходом предков:
  // подложки блоков лежат отдельными слоями с z-index -1, и по дереву
  // предков их не найти — обход давал бы фон страницы вместо подложки.
  const bgOf = (el, x, y) => {
    const stack = document.elementsFromPoint(x, y);
    const from = stack.indexOf(el);
    const below = from >= 0 ? stack.slice(from) : stack;
    let acc = null;
    for (const node of below) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a > 0) acc = acc ? over(acc, c) : c;
      if (acc && acc.a >= 1) return acc;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    return acc ? over(acc, body) : body;
  };

  // Что лежит ЗА группой с прозрачностью. Стеком точек это не взять:
  // держатель камеры не ловит мышь, elementsFromPoint его пропускает,
  // и «фоном за карточкой» оказывалась сама карточка. Здесь нужен
  // именно обход предков.
  const bgAncestor = (el) => {
    let acc = null;
    let p = el;
    while (p) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (c.a > 0) acc = acc ? over(acc, c) : c;
      if (acc && acc.a >= 1) return acc;
      p = p.parentElement;
    }
    return acc ?? parse(getComputedStyle(document.body).backgroundColor);
  };

  const out = [];
  const all = [];
  let skippedCount = 0;
  const targets = [];
  for (const el of document.querySelectorAll('body *')) {
    const text = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (!el.getClientRects().length) continue;
    // Накопленная прозрачность. Полупрозрачный текст НЕ пропускается:
    // приглушённая карточка витрины — это новая пара «текст/фон»,
    // и порог 4.5:1 она обязана держать наравне с остальными.
    // Пропускаем только то, чего не видно совсем.
    //
    // Раньше здесь стоял `continue`, и всё приглушённое уходило
    // из-под проверки молча — считалось лишь число пропущенных.
    let eff = Number(cs.opacity);
    let group = Number(cs.opacity) < 1 ? el : null;
    let p = el;
    while ((p = p.parentElement)) {
      const o = Number(getComputedStyle(p).opacity);
      eff *= o;
      if (o < 1) group = p;
    }
    if (eff < 0.06) { skippedCount++; continue; }
    targets.push({ el, text, eff, group });
  }

  for (const { el, text, eff, group } of targets) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left + Math.min(rect.width / 2, 40), 1), innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
    const cs = getComputedStyle(el);
    let bg = bgOf(el, x, y);
    // Группа с прозрачностью рисуется целиком, а потом смешивается
    // с тем, что за ней. Значит и текст, и его подложка приходят
    // к глазу приглушёнными — меряем то, что видно, а не то,
    // что объявлено.
    const backdrop = eff < 0.99 && group
      ? bgAncestor(group.parentElement ?? document.body)
      : null;
    const flatten = (c) => backdrop
      ? { r: c.r * eff + backdrop.r * (1 - eff), g: c.g * eff + backdrop.g * (1 - eff),
          b: c.b * eff + backdrop.b * (1 - eff), a: 1 }
      : c;
    if (backdrop) bg = flatten(bg);

    // Текст, залитый градиентом через background-clip, имеет
    // прозрачный цвет: браузер рисует его фоном. Сравнивать прозрачное
    // с фоном бессмысленно — берём КАЖДУЮ опорную точку градиента
    // и проверяем худшую из них.
    const clipped = (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text')
      && parse(cs.color).a < 0.05;
    const fgs = (clipped
      ? (cs.backgroundImage.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/gi) || []).map((c) => over(parse(c), bg))
      : [over(parse(cs.color), bg)]).map(flatten);
    const fg = fgs[0];

    const px = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = fgs.length ? Math.min(...fgs.map((f) => ratio(f, bg))) : ratio(fg, bg);
    const row = { text: text.slice(0, 46), cls: el.className?.toString().slice(0, 34), px, weight, r: +r.toFixed(2), need,
                  eff: +eff.toFixed(2),
                  fg: clipped ? `градиент из ${fgs.length} точек` : cs.color,
                  bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` };
    all.push(row);
    if (r < need) out.push(row);
  }
  // Возвращаем и нарушения, и покрытие: проверка, которая ничего
  // не проверила, обязана быть отличима от проверки, где всё чисто.
  const margin = all.map((x) => ({ ...x, slack: +(x.r / x.need).toFixed(2) })).sort((a, b) => a.slack - b.slack);
  return { issues: out, checked: all.length, skipped: skippedCount, tightest: margin.slice(0, 4),
           gradients: all.filter((x) => String(x.fg).startsWith('градиент')) };
};

let bad = 0;
for (const theme of ['light', 'dark']) {
  for (const [name, w, h] of [['десктоп', 1512, 900], ['мобильная', 390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // Собираем заказ, чтобы проверить и заполненные состояния.
    // Селекторы держим живыми: молча промахнувшийся клик оставил бы
    // половину состояний непроверенной, а отчёт — благополучным.
    await page.locator('.pcard--active .tariff').first().click({ force: true });
    await page.getByRole('button', { name: /СБП/ }).first().click({ force: true });
    await page.waitForTimeout(600);

    const { issues, checked, skipped, tightest, gradients } = await page.evaluate(AUDIT);
    console.log(`\n── ${theme} / ${name} (${w}×${h}) — проверено узлов: ${checked}, пропущено невидимых: ${skipped}`);
    if (!issues.length) console.log('  нарушений нет');
    for (const i of issues) {
      console.log(`  ${i.r}:1 (нужно ${i.need}) ${i.px}px/${i.weight} «${i.text}» .${i.cls}  ${i.fg} на ${i.bg}`);
      bad++;
    }
    console.log('  с наименьшим запасом:');
    for (const t of tightest) console.log(`    ${t.r}:1 при пороге ${t.need} — «${t.text}» .${t.cls}`);
    for (const g of gradients)
      console.log(`    ${g.fg} «${g.text}»: худшая опорная точка ${g.r}:1 при пороге ${g.need}`);
    await ctx.close();
  }
}
// ─── Витрина в объёме ──────────────────────────────────────────────
// Отдельный проход: у сцены боковые карточки приглушены, а под
// курсором соседи притухают ещё раз. Это новые пары «текст/фон»,
// и они обязаны держать тот же порог. Обычные проходы идут
// с выключенным движением и сцену не поднимают вовсе.
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.mouse.move(60, 200);
  await page.mouse.move(64, 204);
  await page.evaluate(() => document.querySelector('.shop').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1800);
  const up = await page.evaluate(() => document.querySelector('.shelf3d').hasAttribute('data-3d'));
  if (!up) { console.log(`\n── ${theme} / витрина в объёме: сцена не поднялась, проверять нечего`); bad++; await ctx.close(); continue; }
  // Наводимся по координатам: карточки микропарят, а hover ждёт
  // «стабильности», которой у плывущей карточки не бывает.
  {
    const b = await page.locator('.pcard').nth(2).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  }
  await page.waitForTimeout(1200);

  const { issues, checked, tightest } = await page.evaluate(AUDIT);
  const cards = tightest.filter((t) => /pcard|tariff/.test(t.cls ?? ''));
  console.log(`\n── ${theme} / витрина в объёме, курсор на боковой карточке — проверено узлов: ${checked}`);
  if (!issues.length) console.log('  нарушений нет');
  for (const i of issues) {
    console.log(`  ${i.r}:1 (нужно ${i.need}) плотность ${i.eff} «${i.text}» .${i.cls}  ${i.fg} на ${i.bg}`);
    bad++;
  }
  for (const t of (cards.length ? cards : tightest).slice(0, 3))
    console.log(`    ${t.r}:1 при пороге ${t.need}, плотность ${t.eff} — «${t.text}» .${t.cls}`);
  await ctx.close();
}

// ─── Краска пузырей под текстом ────────────────────────────────────
//
// Оба прохода выше берут фон ВЫЧИСЛЕННЫЙ: стопку элементов под точкой
// и их объявленные заливки. Холст пузырей в эту стопку не попадает
// никогда — у него pointer-events: none, и elementsFromPoint его
// не видит, — а с тех пор как он лежит под всей страницей, краска
// пузыря оказывается ровно между текстом и фоном страницы.
//
// Без этого прохода проверка уверенно печатала бы «нарушений нет»,
// меряя чистый --c-bg под буквами, за которыми на самом деле плавает
// краска. Ровно то молчание, ради которого проверки и пишут.
//
// Меряется по настоящим пикселям и по ОКНУ, а не по одной точке.
// Одна точка здесь не годится: краска пузыря — это отдельные точки
// с просветами между ними, и ядро одной точки темнее того, что
// глаз видит на месте буквы. Берётся среднее по квадрату 6×6 px —
// примерно размер прогала внутри глифа, — и худший такой квадрат
// в коробке блока. Сам текст на время замера скрыт: иначе самым
// тёмным квадратом окажется он сам.
const otn = (a, b) => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const la = L(a), lb = L(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const { PNG } = await import('pngjs');
/** Блоки, под которыми виден фон страницы, а значит и пузыри.
 *  Плашки, карточки и чек непрозрачны — краска за ними не видна
 *  вовсе, и мерить там нечего. */
// Заголовок первого экрана сюда НЕ входит намеренно: он залит
// градиентом через background-clip, его собственный color прозрачен,
// и мерить контраст по нему нечем. Градиентный текст разбирает
// основной проход выше, по опорным точкам градиента.
const NAD_FONOM = ['.hero__lead', '.shop__title', '.shop__lead',
                   '.steps__title', '.step__title', '.step__text', '.footer__title'];
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.mouse.move(700, 500);
  await page.waitForTimeout(2400);
  if (!(await page.evaluate(() => !!document.querySelector('canvas.bubbles')))) {
    console.log(`\n── ${theme} / краска пузырей: холста нет, проверять нечего`);
    bad++; await ctx.close(); continue;
  }
  console.log(`\n── ${theme} / текст на краске пузырей`);
  let hudshee = null;
  let promeryano = 0;
  for (const sel of NAD_FONOM) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(700);
    const dano = await el.evaluate((n) => {
      const b = n.getBoundingClientRect();
      const c = getComputedStyle(n).color.match(/\d+/g).slice(0, 3).map(Number);
      const px = parseFloat(getComputedStyle(n).fontSize);
      const w = getComputedStyle(n).fontWeight;
      return { b: { x: b.x, y: b.y, w: b.width, h: b.height }, c, px, w };
    }).catch(() => null);
    if (!dano) continue;
    const kadr = {
      x: Math.max(0, Math.round(dano.b.x)),
      y: Math.max(0, Math.round(dano.b.y)),
      width: Math.round(Math.min(1512 - Math.max(0, dano.b.x), dano.b.w)),
      height: Math.round(Math.min(900 - Math.max(0, dano.b.y), dano.b.h)),
    };
    if (kadr.width < 12 || kadr.height < 12) continue;
    // Прячем САМ текст, а не всё вокруг: нужен фон ровно под ним.
    await el.evaluate((n) => { n.dataset.pryachu = '1'; n.style.visibility = 'hidden'; });
    await page.waitForTimeout(120);
    const png = PNG.sync.read(await page.screenshot({ clip: kadr }));
    await el.evaluate((n) => { n.style.visibility = ''; delete n.dataset.pryachu; });
    const W = png.width, H = png.height, OKNO = 6;
    let hud = null, hudR = 99;
    const nado = dano.px >= 24 || (dano.px >= 18.66 && Number(dano.w) >= 700) ? 3 : 4.5;
    for (let y = 0; y + OKNO <= H; y += 2) {
      for (let x = 0; x + OKNO <= W; x += 2) {
        let r = 0, g = 0, b2 = 0;
        for (let j = 0; j < OKNO; j++) for (let i2 = 0; i2 < OKNO; i2++) {
          const k = ((y + j) * W + (x + i2)) * 4;
          r += png.data[k]; g += png.data[k + 1]; b2 += png.data[k + 2];
        }
        const n2 = OKNO * OKNO;
        const sred = [r / n2, g / n2, b2 / n2];
        const rr = otn(dano.c, sred);
        if (rr < hudR) { hudR = rr; hud = sred.map((v) => Math.round(v)); }
      }
    }
    promeryano++;
    const zapis = { sel, r: hudR, need: nado, fon: hud, c: dano.c };
    if (!hudshee || hudR / nado < hudshee.r / hudshee.need) hudshee = zapis;
    if (hudR < nado) { console.log(`  НЕТ ${hudR.toFixed(2)}:1 (нужно ${nado}) — «${sel}» на rgb(${hud})`); bad++; }
  }
  if (!promeryano) { console.log('  ни один блок не промерян — проба устарела, поправьте селекторы'); bad++; }
  else console.log(`  промерено блоков ${promeryano}, наименьший запас ${hudshee.r.toFixed(2)}:1 при пороге ${hudshee.need} — «${hudshee.sel}» на rgb(${hudshee.fon})`);
  await ctx.close();
}

await browser.close();
console.log(bad ? `\nВсего нарушений: ${bad}` : '\nКонтраст в порядке во всех сочетаниях');
process.exit(bad ? 1 : 0);
