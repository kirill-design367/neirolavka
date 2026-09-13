/**
 * Заголовки трёх шагов стоят на ОДНОЙ линии.
 *
 * Проверка мелкая, а поломка была незаметной: цифры при этом стоят
 * ровно, и разъезд читается «текст сдвинут», а не «сетка растянула
 * строку». Причина — `align-content: stretch` по умолчанию: лишняя
 * высота, которую внешняя сетка отдаёт короткому шагу, делится между
 * строкой с цифрой и строкой с текстом поровну.
 *
 * Мерится ОТРИСОВАННАЯ страница при выключенном движении: появление
 * блоков двигает тело шага на десятки пикселей, и на живой анимации
 * замер показывал бы её, а не раскладку.
 *
 * Проверено на способность падать: со снятым `align-content: start`
 * краснеет на всех трёх десктопных ширинах (разброс 36.0 px).
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const PREDEL = 1.0; // css-px: дробные доли даёт округление сетки
const SHIRINY = [1920, 1512, 1366];

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
});
let ploho = false;
for (const w of SHIRINY) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('.steps')?.scrollIntoView());
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const shagi = [...document.querySelectorAll('.step')];
    return shagi.map((s) => {
      const t = s.querySelector('.step__title');
      const n = s.querySelector('.step__node');
      return {
        zagolovok: t ? t.getBoundingClientRect().top : null,
        cifra: n ? n.getBoundingClientRect().top : null,
      };
    });
  });
  if (r.length < 3) {
    console.log(`ПЛОХО ${w}: шагов ${r.length}, а проверка написана про три`);
    ploho = true;
    await ctx.close();
    continue;
  }
  if (r.some((x) => x.zagolovok === null || x.cifra === null)) {
    console.log(`ПЛОХО ${w}: у шага нет заголовка или цифры — разметка изменилась`);
    ploho = true;
    await ctx.close();
    continue;
  }
  const z = r.map((x) => x.zagolovok);
  const c = r.map((x) => x.cifra);
  const razbrosZ = Math.max(...z) - Math.min(...z);
  const razbrosC = Math.max(...c) - Math.min(...c);
  const plohoTut = razbrosZ > PREDEL || razbrosC > PREDEL;
  if (plohoTut) ploho = true;
  console.log(
    `${plohoTut ? 'ПЛОХО' : 'ок'} ${w}: заголовки ${razbrosZ.toFixed(1)} px, ` +
      `цифры ${razbrosC.toFixed(1)} px при пределе ${PREDEL}`,
  );
  await ctx.close();
}
await b.close();
process.exit(ploho ? 1 : 0);
