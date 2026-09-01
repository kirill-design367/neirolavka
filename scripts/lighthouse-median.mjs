/**
 * Десять прогонов Lighthouse в мобильном профиле, берём медиану.
 * Один прогон ничего не значит: разброс между запусками больше,
 * чем разница между «хорошо» и «плохо».
 *
 * Запуск: node scripts/lighthouse-median.mjs http://localhost:4173/neirolavka/ 10
 */
import fs from 'node:fs';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const URL = process.argv[2];
const RUNS = Number(process.argv[3] ?? 10);

// Браузер ищем, а не прописываем: в этом контейнере лежит Chromium
// от Playwright, на бегунке GitHub — системный Chrome. Прибитый путь
// работал бы ровно в одном месте из двух.
const NAYTI_BRAUZER = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]) {
    if (fs.existsSync(p)) return p;
  }
  // chrome-launcher найдёт сам, если не нашли мы.
  return undefined;
};

const chrome = await chromeLauncher.launch({
  chromePath: NAYTI_BRAUZER(),
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
});

const rows = [];
for (let i = 0; i < RUNS; i++) {
  const res = await lighthouse(
    URL,
    { port: chrome.port, output: 'json', logLevel: 'error' },
    // Мобильный профиль по умолчанию: замедленный процессор и 4G.
    undefined,
  );
  const c = res.lhr.categories;
  const a = res.lhr.audits;
  rows.push({
    perf: Math.round(c.performance.score * 100),
    a11y: Math.round(c.accessibility.score * 100),
    bp: Math.round(c['best-practices'].score * 100),
    seo: Math.round(c.seo.score * 100),
    fcp: a['first-contentful-paint'].numericValue,
    lcp: a['largest-contentful-paint'].numericValue,
    tbt: a['total-blocking-time'].numericValue,
    cls: a['cumulative-layout-shift'].numericValue,
    si: a['speed-index'].numericValue,
    bench: res.lhr.environment.benchmarkIndex,
  });
  process.stdout.write(`прогон ${i + 1}/${RUNS}: ${rows.at(-1).perf}\n`);
}
await chrome.kill();

const med = (k) => {
  const v = rows.map((r) => r[k]).sort((x, y) => x - y);
  const m = v.length / 2;
  return v.length % 2 ? v[Math.floor(m)] : (v[m - 1] + v[m]) / 2;
};

console.log('\n── Медиана десяти прогонов, мобильный профиль ──');
console.log(`  Производительность   ${med('perf')}`);
console.log(`  Доступность          ${med('a11y')}`);
console.log(`  Лучшие практики      ${med('bp')}`);
console.log(`  Поисковая оптимизация ${med('seo')}`);
console.log(`  FCP  ${(med('fcp') / 1000).toFixed(2)} с`);
console.log(`  LCP  ${(med('lcp') / 1000).toFixed(2)} с`);
console.log(`  TBT  ${med('tbt').toFixed(0)} мс`);
console.log(`  CLS  ${med('cls').toFixed(4)}`);
console.log(`  Speed Index ${(med('si') / 1000).toFixed(2)} с`);
console.log(`  Разброс производительности: ${Math.min(...rows.map(r=>r.perf))}–${Math.max(...rows.map(r=>r.perf))}`);
// Оценка скорости самой машины. Lighthouse считает время не по часам,
// а моделью, откалиброванной по этому числу: на медленной машине один
// и тот же код честно получает меньше баллов. Без него «стало хуже»
// и «машина сегодня медленнее» неотличимы — а это разные диагнозы,
// и половина дня уходит на поиск регрессии, которой нет.
console.log(`  Скорость машины (benchmarkIndex): ${med('bench').toFixed(0)}`);
