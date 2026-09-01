/**
 * Пять разрешений: не вылезает ли что-нибудь за ширину экрана
 * и не появляется ли горизонтальная прокрутка.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
let bad = 0;
for (const [w, h] of [[2560, 1440], [1920, 1080], [1512, 820], [1366, 768], [390, 844]]) {
  for (const theme of ['light', 'dark']) {
    const c = await b.newContext({ viewport: { width: w, height: h }, locale: 'ru-RU',
                                   isMobile: w < 500, hasTouch: w < 500 });
    await c.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
    const p = await c.newPage();
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
    // Прокручиваем всю страницу, чтобы всё появилось и померилось.
    await p.evaluate(async () => {
      const H = document.body.scrollHeight;
      for (let y = 0; y < H; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
      window.scrollTo(0, 0);
    });
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const de = document.documentElement;
      const over = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || !el.checkVisibility?.()) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0) continue;
        // Слои перелива нарочно крупнее своих карточек и обрезаются
        // предком: за экран они не выходят, за рамку — да.
        let clipped = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const s2 = getComputedStyle(a);
          if (s2.overflowX !== 'visible' || s2.overflowY !== 'visible') { clipped = true; break; }
        }
        if (clipped) continue;
        if (b.right > de.clientWidth + 1 || b.left < -1) {
          const n = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : el.tagName;
          if (!over.some((o) => o.n === n)) over.push({ n, l: Math.round(b.left), r: Math.round(b.right) });
        }
      }
      return { scrollW: de.scrollWidth, clientW: de.clientWidth, over: over.slice(0, 6) };
    });
    const ok = r.scrollW <= r.clientW && r.over.length === 0;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok ' : 'НЕТ'} ${w}x${h}, ${theme === 'dark' ? 'тёмная' : 'светлая'}: ширина прокрутки ${r.scrollW} при экране ${r.clientW}` +
      (r.over.length ? `, вылезают: ${r.over.map((o) => `${o.n} ${o.l}…${o.r}`).join('; ')}` : ''));
    await c.close();
  }
}
await b.close();
console.log(bad ? `\nПроблем: ${bad}` : '\nНи на одном разрешении ничего не вылезает');
process.exit(bad ? 1 : 0);
