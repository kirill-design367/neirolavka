/**
 * Основной текст должен быть нейтральным. Акцентом красится только
 * то, что акцент: активное состояние, выбранный тариф, ссылка.
 *
 * Обходим все узлы с текстом и сравниваем их цвет с токенами.
 * Всё, что покрашено брендовым или акцентным цветом, выводим списком.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
let bad = 0;

for (const theme of ['light', 'dark']) {
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU', reducedMotion: 'reduce' });
  await c.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const r = await p.evaluate(() => {
    const cs0 = getComputedStyle(document.documentElement);
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const cx = cv.getContext('2d');
    const rgb = (v) => { cx.clearRect(0,0,1,1); cx.fillStyle = v; cx.fillRect(0,0,1,1);
                         const d = cx.getImageData(0,0,1,1).data; return [d[0],d[1],d[2]]; };
    const tok = (n) => rgb(cs0.getPropertyValue(n).trim());
    const near = (a, t) => Math.hypot(a[0]-t[0], a[1]-t[1], a[2]-t[2]) < 26;
    // --c-on-fill-muted намеренно нейтральный, в набор акцентов не входит.
    const accents = { brand: tok('--c-brand'), accentText: tok('--c-accent-text') };
    // Насыщенность считается в OKLCH, а не размахом каналов RGB.
    // Размах зависит от светлоты: у светлой кремовой и у тёмной
    // почти чёрной одной и той же насыщенности он отличается втрое,
    // и мера ловила не подкраску, а то, что цвет светлый.
    const chroma = (c) => {
      const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const [r, g, b] = c.map(f);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
      const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
      return Math.hypot(A, B);
    };
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
                                    .map((n) => n.textContent.trim()).join(' ');
      if (!txt) continue;
      if (!el.getClientRects().length) continue;
      const col = rgb(getComputedStyle(el).color);
      for (const [name, t] of Object.entries(accents)) {
        if (near(col, t)) {
          out.push({ name, cls: el.className.toString().split(/\s+/).slice(0,2).join('.'),
                     txt: txt.slice(0, 40) });
          break;
        }
      }
    }
    // отдельно: насколько подкрашен текст на цветной заливке
    const onFill = [...document.querySelectorAll('.referral__text, .fact__label, .fact__value, .referral__soon')]
      .map((el) => ({ cls: el.className.toString().split(/\s+/)[0], chroma: chroma(rgb(getComputedStyle(el).color)) }));
    // Мерилом служит насыщенность собственного основного текста
    // страницы: закон запрещает красить текст АКЦЕНТОМ, а не иметь
    // тёплую нейтраль. В тёплой палитре нейтраль тёплая по
    // определению, и требовать от неё нулевой насыщенности значит
    // требовать чужеродного холодного серого.
    return { out, onFill, textChroma: chroma(tok('--c-text')),
             brandChroma: chroma(tok('--c-brand')) };
  });
  console.log(`\n── ${theme === 'dark' ? 'тёмная' : 'светлая'}: текст акцентным цветом (${r.out.length}) ──`);
  if (!r.out.length) console.log('  нет');
  const seen = new Set();
  for (const x of r.out) {
    const k = x.cls + '|' + x.name;
    if (seen.has(k)) continue; seen.add(k);
    console.log(`  ${x.name.padEnd(12)} .${x.cls.padEnd(28)} «${x.txt}»`);
  }
  const maxCh = Math.max(...r.onFill.map((x) => x.chroma));
  const limit = r.textChroma + 0.012;
  console.log(`  насыщенность текста на цветной заливке: ${maxCh.toFixed(3)} по OKLCH ` +
    `при ${r.textChroma.toFixed(3)} у основного текста и ${r.brandChroma.toFixed(3)} у акцента ` +
    `${maxCh <= limit ? '(нейтраль этой палитры)' : '(ПОДКРАШЕН)'}`);
  if (maxCh > limit) bad++;
  await c.close();
}
await b.close();
console.log(bad ? '\nТЕКСТ НА ЗАЛИВКЕ ПОДКРАШЕН' : '\nОсновной текст нейтрален в обеих темах');
process.exit(bad ? 1 : 0);
