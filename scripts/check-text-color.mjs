/**
 * Основной текст должен быть нейтральным. Акцентом красится только
 * то, что акцент: активное состояние, выбранный тариф, ссылка.
 *
 * Обходим все узлы с текстом и сравниваем их цвет с токенами.
 * Всё, что покрашено брендовым или акцентным цветом, выводим списком.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

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
    // насыщенность: у нейтрали разброс каналов маленький
    const chroma = (c) => Math.max(...c) - Math.min(...c);
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
    return { out, onFill };
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
  console.log(`  насыщенность текста на цветной заливке: максимум ${maxCh} из 255 ${maxCh <= 12 ? '(нейтраль)' : '(ПОДКРАШЕН)'}`);
  await c.close();
}
await b.close();
