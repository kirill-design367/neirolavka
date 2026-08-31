/**
 * Пузыри: число, лопание, восстановление, кадры и невмешательство
 * в интерфейс.
 *
 * Число целых пузырей компонент выставляет атрибутом data-bubbles на
 * самом холсте — по пикселям его считать ненадёжно. Попадание ищется
 * перебором точек: скрипт не знает, где именно плавают пузыри, и
 * тыкает по сетке, пока число не уменьшится. Это же доказывает, что
 * промах ничего не ломает.
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let bad = 0;

const countOf = (p) => p.locator('.bubbles').getAttribute('data-bubbles').then(Number);

for (const [w, h, name, want] of [[1512, 900, 'десктоп', 8], [390, 844, 'мобильная', 5]]) {
  const c = await b.newContext({ viewport: { width: w, height: h }, locale: 'ru-RU',
                                 isMobile: w < 500, hasTouch: w < 500 });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const n0 = await countOf(p);
  const okCount = n0 === want;
  if (!okCount) bad++;

  // ─── Кадры, пока пузыри в поле зрения и ничего больше не движется.
  const fps = await p.evaluate(async () => {
    const f = [];
    let last = performance.now();
    await new Promise((res) => {
      const t = (x) => { f.push(x - last); last = x;
        performance.now() - f.length * 0 > 0 && f.length < 240 ? requestAnimationFrame(t) : res(); };
      requestAnimationFrame(t);
    });
    const s = f.slice(3).sort((a, z) => a - z);
    return { n: s.length, p50: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)],
             over: s.filter((x) => x > 17).length };
  });

  // ─── Лопание: тычем по сетке, пока число не уменьшится.
  const box = await p.locator('.hero').boundingBox();
  let popped = false, tries = 0;
  outer:
  for (let gy = 0.12; gy <= 0.9 && !popped; gy += 0.08) {
    for (let gx = 0.06; gx <= 0.96; gx += 0.05) {
      tries++;
      await p.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
      await p.waitForTimeout(30);
      if (await countOf(p) < n0) { popped = true; break outer; }
    }
  }
  if (!popped) bad++;

  // ─── Через паузу число обязано вернуться.
  await p.waitForTimeout(2200);
  const n1 = await countOf(p);
  const okBack = n1 === n0;
  if (!okBack) bad++;

  // ─── Холст не должен ловить мышь. Проверяем не поведением, а
  //     тем, что под курсором в его области всегда лежит не он.
  const grab = await p.evaluate(() => {
    const cv = document.querySelector('.bubbles');
    const r = cv.getBoundingClientRect();
    let hits = 0, total = 0;
    for (let gy = 0.05; gy < 1; gy += 0.1)
      for (let gx = 0.05; gx < 1; gx += 0.1) {
        const el = document.elementFromPoint(r.left + r.width * gx, r.top + r.height * gy);
        total++;
        if (el === cv) hits++;
      }
    return { hits, total };
  });
  const okLayer = grab.hits === 0;
  if (!okLayer) bad++;

  // ─── Клик по ссылке первого экрана не должен лопать пузырь и
  //     обязан сработать сам. Ссылки-чипы есть только на телефоне.
  const chip = p.locator('.hero__chip').first();
  const hasChip = await chip.isVisible().catch(() => false);
  // Хеш при этом НЕ меняется, и так задумано: якорные ссылки в
  // проекте перехватываются и едут через Lenis. Признак срабатывания —
  // прокрутка, а не адрес.
  let okLink = true, before = await countOf(p), after = before, moved = '(чипов нет на этой ширине)';
  if (hasChip) {
    const y0 = await p.evaluate(() => window.scrollY);
    await chip.click();
    await p.waitForTimeout(900);
    after = await countOf(p);
    const y1 = await p.evaluate(() => window.scrollY);
    moved = `прокрутка ${y0} → ${y1}`;
    okLink = after === before && y1 > y0 + 40;
    if (!okLink) bad++;
  }

  console.log(`  ${okCount && popped && okBack && okLink && okLayer ? 'ok ' : 'НЕТ'} ${name} ${w}x${h}`);
  console.log(`      пузырей ${n0} при ожидаемых ${want}; лопнул с ${tries}-й попытки; через 2.2 с снова ${n1}`);
  console.log(`      слой мышь не ловит: холст оказался под курсором ${grab.hits} раз из ${grab.total}`);
  console.log(`      клик по ссылке: пузырей ${before} → ${after}, ${moved}`);
  console.log(`      кадры на первом экране: медиана ${fps.p50.toFixed(2)} мс (${(1000 / fps.p50).toFixed(1)} fps), ` +
              `95-й ${fps.p95.toFixed(2)} мс, дольше 17 мс — ${fps.over} из ${fps.n} (${(fps.over / fps.n * 100).toFixed(1)} %)`);
  await c.close();
}

// ─── Движение выключено: пузыри стоят.
{
  const c = await b.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU', reducedMotion: 'reduce' });
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const same = await p.evaluate(async () => {
    const cv = document.querySelector('.bubbles');
    const a = cv.toDataURL();
    await new Promise((r) => setTimeout(r, 1200));
    return a === cv.toDataURL();
  });
  if (!same) bad++;
  console.log(`  ${same ? 'ok ' : 'НЕТ'} выключенное движение: холст за 1.2 с ${same ? 'не изменился' : 'ИЗМЕНИЛСЯ'}`);
  await c.close();
}

await b.close();
console.log(bad ? `\nПроблем: ${bad}` : '\nПузыри держат число, лопаются, возвращаются и интерфейсу не мешают');
process.exit(bad ? 1 : 0);
