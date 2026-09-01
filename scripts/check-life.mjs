/**
 * Живые реакции: замеряем амплитуду, а не «есть или нет».
 * Проверяем, что движение в заданных пределах, что текст нигде
 * не масштабируется и что при prefers-reduced-motion всё стоит.
 */
import { chromium } from 'playwright';
const URL = process.argv[2];
const b = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
let bad = 0;

// ── 1. Параллакс: размах за весь проход блока ──
{
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const H = await p.evaluate(() => document.body.scrollHeight);
  const seen = {};
  for (let y = 0; y <= H; y += 120) {
    await p.evaluate((v) => window.scrollTo(0, v), y);
    await p.waitForTimeout(70);
    const vals = await p.evaluate(() => {
      const o = {};
      for (const el of document.querySelectorAll('[data-parallax]')) {
        const key = el.className.toString().split(/\s+/)[0] || el.tagName.toLowerCase();
        const v = parseFloat(getComputedStyle(el).getPropertyValue('--par')) || 0;
        (o[key] ||= []).push(v);
      }
      return o;
    });
    for (const [k, v] of Object.entries(vals)) (seen[k] ||= []).push(...v);
  }
  console.log('── параллакс: размах по блокам ──');
  for (const [k, v] of Object.entries(seen)) {
    const amp = Math.max(...v) - Math.min(...v);
    const ok = amp > 1 && amp <= 17;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok ' : 'НЕТ'} ${k.padEnd(22)} ${amp.toFixed(1)} px`);
  }
  await c.close();
}

// ── 2. Дыхание: амплитуда и период ──
{
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const r = await p.evaluate(async () => {
    const probes = [
      ['карточка тарифа', '.tariff', '::before', 'opacity'],
      ['панель заказа', '.order__paper', '::before', 'opacity'],
      ['плашка надзаголовка', '.hero__eyebrow', '::before', 'transform'],
    ];
    const acc = probes.map(() => new Set());
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        probes.forEach(([, sel, ps, prop], i) => {
          const el = document.querySelector(sel);
          if (el) acc[i].add(getComputedStyle(el, ps)[prop]);
        });
        performance.now() - t0 < 6500 ? requestAnimationFrame(tick) : res();
      };
      requestAnimationFrame(tick);
    });
    return probes.map(([label], i) => {
      const vals = [...acc[i]];
      const nums = vals.map((v) => {
        const m = String(v).match(/matrix\(([\d.]+)/);
        return m ? parseFloat(m[1]) : parseFloat(v);
      }).filter((x) => !isNaN(x));
      return { label, steps: vals.length, min: Math.min(...nums), max: Math.max(...nums) };
    });
  });
  console.log('\n── дыхание за 6.5 с ──');
  for (const x of r) {
    const amp = x.max - x.min;
    const ok = x.steps > 10 && amp > 0.004 && amp < 0.06;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok ' : 'НЕТ'} ${x.label.padEnd(22)} значений ${String(x.steps).padStart(3)}, размах ${amp.toFixed(4)}`);
  }
  await c.close();
}

// ── 3. Текст не масштабируется ──
{
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.hover('.tariff');
  await p.waitForTimeout(400);
  const scaled = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const t = getComputedStyle(el).transform;
      const m = t.match(/matrix\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/);
      if (m && (Math.abs(parseFloat(m[1]) - 1) > 0.001 || Math.abs(parseFloat(m[4]) - 1) > 0.001))
        out.push(el.className.toString().slice(0, 40) + ' → ' + t);
    }
    return out;
  });
  console.log(`\n── масштаб на узлах с текстом ──`);
  if (scaled.length) { bad++; scaled.forEach((s) => console.log('  НЕТ ' + s)); }
  else console.log('  ok  ни один узел с текстом не масштабируется');
  await c.close();
}

// ── 4. prefers-reduced-motion ──
{
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, reducedMotion: 'reduce', locale: 'ru-RU' });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const r = await p.evaluate(async () => {
    const acc = new Set();
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        acc.add(getComputedStyle(document.querySelector('.tariff'), '::before').opacity +
                '|' + getComputedStyle(document.querySelector('.hero__eyebrow'), '::before').transform);
        performance.now() - t0 < 2500 ? requestAnimationFrame(tick) : res();
      };
      requestAnimationFrame(tick);
    });
    const par = [...document.querySelectorAll('[data-parallax]')]
      .map((el) => parseFloat(getComputedStyle(el).getPropertyValue('--par')) || 0);
    return { states: acc.size, lenis: document.documentElement.className.includes('lenis'), parMax: Math.max(...par.map(Math.abs)) };
  });
  const ok = r.states === 1 && !r.lenis && r.parMax === 0;
  if (!ok) bad++;
  console.log(`\n── prefers-reduced-motion ──`);
  console.log(`  ${ok ? 'ok ' : 'НЕТ'} состояний дыхания за 2.5 с: ${r.states}, Lenis поднят: ${r.lenis}, максимальный сдвиг параллакса: ${r.parMax} px`);
  await c.close();
}

await b.close();
console.log(bad ? `\nПроблем: ${bad}` : '\nВсе живые реакции в заданных пределах');
process.exit(bad ? 1 : 0);
