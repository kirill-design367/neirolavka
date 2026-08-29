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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

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
    // Накопленная прозрачность: у скрытого предка текст не виден вовсе,
    // и мерить его контраст бессмысленно.
    let eff = Number(cs.opacity);
    let p = el;
    while ((p = p.parentElement)) eff *= Number(getComputedStyle(p).opacity);
    if (eff < 0.99) { skippedCount++; continue; }
    targets.push({ el, text });
  }

  for (const { el, text } of targets) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left + Math.min(rect.width / 2, 40), 1), innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
    const cs = getComputedStyle(el);
    const bg = bgOf(el, x, y);

    // Текст, залитый градиентом через background-clip, имеет
    // прозрачный цвет: браузер рисует его фоном. Сравнивать прозрачное
    // с фоном бессмысленно — берём КАЖДУЮ опорную точку градиента
    // и проверяем худшую из них.
    const clipped = (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text')
      && parse(cs.color).a < 0.05;
    const fgs = clipped
      ? (cs.backgroundImage.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/gi) || []).map((c) => over(parse(c), bg))
      : [over(parse(cs.color), bg)];
    const fg = fgs[0];

    const px = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = fgs.length ? Math.min(...fgs.map((f) => ratio(f, bg))) : ratio(fg, bg);
    const row = { text: text.slice(0, 46), cls: el.className?.toString().slice(0, 34), px, weight, r: +r.toFixed(2), need,
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
    // Собираем заказ, чтобы проверить и заполненные состояния
    await page.getByRole('button', { name: /6 месяцев/ }).first().click().catch(() => {});
    await page.getByRole('button', { name: /СБП/ }).first().click().catch(() => {});
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
await browser.close();
console.log(bad ? `\nВсего нарушений: ${bad}` : '\nКонтраст в порядке во всех сочетаниях');
process.exit(bad ? 1 : 0);
