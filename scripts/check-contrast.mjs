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

const AUDIT = async () => {
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
  // Ловит ли элемент мышь. Такой, что не ловит, elementsFromPoint
  // пропускает, хотя нарисован он честно, — и «не нашёлся в стопке»
  // для него не значит «невидим».
  //
  // Свойство НАСЛЕДУЕМОЕ, поэтому спрашивать надо у самого элемента,
  // а не обходить предков. Обход давал ложное «не ловит» там, где
  // предок отключил мышь, а потомок включил обратно: у витрины
  // в объёме держатель камеры стоит pointer-events: none, а карточка
  // внутри него — auto. Из-за обхода строки тарифов внутри закрытых
  // створок снова получали выдуманный фон, хотя мышь они ловят.
  const skvoznoy = (el) => getComputedStyle(el).pointerEvents === 'none';

  const bgOf = (el, x, y) => {
    const stack = document.elementsFromPoint(x, y);
    const from = stack.indexOf(el);
    // ЭЛЕМЕНТА В ТОЧКЕ НЕТ — значит, он там не нарисован, и фона
    // у него в этой точке не существует.
    //
    // Прежде здесь стояло `from >= 0 ? stack.slice(from) : stack`,
    // то есть при промахе брался ВЕСЬ стек: фоном текста становилось
    // то, что лежит на этом месте вместо него. Так строки тарифов
    // внутри закрытой створки получали фоном карточку витрины,
    // на которой они не лежат: overflow: hidden режет отрисовку,
    // но коробку потомка не трогает, и точка замера падает мимо
    // всего нарисованного. Замер сообщал о паре, которой на экране
    // нет ни одного кадра, — и поймать это можно было только сменой
    // цвета карточки: пока она была светлой, выдуманная пара давала
    // 10.70:1 и молчала.
    //
    // Исключение одно: элемент, который сам или чей предок не ловит
    // мышь. Он нарисован, просто невидим для elementsFromPoint —
    // для него оставляем прежний путь.
    if (from < 0 && !skvoznoy(el)) return null;
    const below = from >= 0 ? stack.slice(from) : stack;
    let acc = null;
    for (const node of below) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a > 0) acc = acc ? over(acc, c) : c;
      if (acc && acc.a >= 1) return acc;
      // ПОДЛОЖКИ-ПСЕВДОЭЛЕМЕНТЫ. elementsFromPoint не возвращает
      // ::before и ::after никогда, а половина подложек в проекте
      // сделана именно ими: капсула шапки — это .nav__inner::before
      // с background: var(--c-surface) и opacity: var(--nav-p).
      // Проверка смотрела СКВОЗЬ непрозрачную капсулу на то, что под
      // ней, и объявляла счётчик шапки нечитаемым (1.89:1 на карточке
      // условий), хотя на экране он лежит на капсуле. Поймать это
      // можно было только сменой цвета того, что под шапкой: пока там
      // было дерево, выдуманная пара давала 5.09:1 и молчала.
      for (const psevdo of ['::before', '::after']) {
        const ps = getComputedStyle(node, psevdo);
        if (ps.content === 'none') continue;
        const pc = parse(ps.backgroundColor);
        const op = Number(ps.opacity);
        if (!(pc.a > 0) || !(op > 0)) continue;
        // Считаем только те, что накрывают точку: у позиционированного
        // псевдоэлемента вычисленные left/top/width/height уже в px
        // от коробки родителя.
        const nr = node.getBoundingClientRect();
        const px = nr.left + (parseFloat(ps.left) || 0);
        const py = nr.top + (parseFloat(ps.top) || 0);
        const pw = parseFloat(ps.width) || 0;
        const ph = parseFloat(ps.height) || 0;
        if (ps.position === 'static' || pw <= 0 || ph <= 0) continue;
        if (x < px || x > px + pw || y < py || y > py + ph) continue;
        const eff = { r: pc.r, g: pc.g, b: pc.b, a: pc.a * op };
        acc = acc ? over(acc, eff) : eff;
        if (acc.a >= 1) return acc;
      }
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

  // Пересечение коробки элемента со всеми предками, которые режут
  // содержимое. null — от элемента на экране не осталось ничего.
  const vidimyRect = (el) => {
    const r0 = el.getBoundingClientRect();
    let [l, t, rt, b] = [r0.left, r0.top, r0.right, r0.bottom];
    let p = el.parentElement;
    while (p) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        l = Math.max(l, pr.left); t = Math.max(t, pr.top);
        rt = Math.min(rt, pr.right); b = Math.min(b, pr.bottom);
        if (rt - l < 1 || b - t < 1) return null;
      }
      p = p.parentElement;
    }
    return { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t };
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
    // ДАЁМ СТРАНИЦЕ ДОЕХАТЬ И ПЕРЕСЧИТАТЬ СТИЛЬ, а не меряем в тот же
    // тик. Прокрутка здесь сглажена Lenis, и часть оформления считается
    // от неё же: капсула шапки проявляется переменной --nav-p на первых
    // 120 px. Без кадра между прокруткой и замером счётчик шапки
    // измерялся с ПРОЗРАЧНОЙ капсулой над содержимым, до которого
    // страница на самом деле доезжает только когда капсула уже
    // непрозрачна: замер давал 1.89:1 на паре, которой на экране
    // не бывает. Проба по пикселям на всей прокрутке даёт у того же
    // счётчика 6.64:1 на телефоне и 6.76:1 на десктопе.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Коробка ВИДИМОЙ части, а не коробка элемента.
    //
    // overflow: hidden у предка обрезает ОТРИСОВКУ, но коробку
    // потомка не трогает: строка тарифа внутри закрытой створки
    // по-прежнему отдаёт свои 174×85, хотя на экране от неё
    // остаётся полоска в 16 px. Точка замера падала в середину
    // такой коробки — то есть мимо всего, что нарисовано, —
    // elementsFromPoint не находил там саму строку и возвращал
    // стопку без неё. Фоном текста оказывалась КАРТОЧКА, на которой
    // строка не лежит: замер сообщал о паре, которой на экране нет.
    //
    // Поймать это можно было только сменой цвета карточки: пока она
    // была светлой, выдуманная пара давала 10.70:1 и молчала.
    const rect = vidimyRect(el);
    if (!rect) { skippedCount++; continue; }
    const x = Math.min(Math.max(rect.left + Math.min(rect.width / 2, 40), 1), innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
    const cs = getComputedStyle(el);
    let bg = bgOf(el, x, y);
    if (!bg) { skippedCount++; continue; }
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

await browser.close();
console.log(bad ? `\nВсего нарушений: ${bad}` : '\nКонтраст в порядке во всех сочетаниях');
process.exit(bad ? 1 : 0);
