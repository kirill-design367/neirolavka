/**
 * Чёткость текста на карточках витрины.
 *
 * Карточки выводятся слоем HTML, которому каждый кадр выставляется
 * matrix3d от камеры сцены. Браузер растеризует такой слой ОДИН раз
 * в размере раскладки, а показывает — в размере, который задала
 * матрица. Ближняя карточка показывается КРУПНЕЕ раскладки, и её
 * готовый растр браузер растягивает: кромка буквы размывается ровно
 * во столько раз, во сколько слой увеличен.
 *
 * Меряется это шириной ступеньки на кромке буквы — сколько точек
 * занимает переход от фона к краске. Вердикт — ОТНОШЕНИЕ ступеньки
 * ближней карточки к боковым: у одинаково растеризованных слоёв оно
 * около единицы, у растянутого — заметно больше.
 *
 * Почему среднее, а не наибольшее: наибольшая ступенька растёт вместе
 * с числом просмотренных точек, и вердикт начинает зависеть от размера
 * куска, а не от картинки. Среднее сходится.
 *
 * И почему ступенька делится на ТОЛЩИНУ ШТРИХА, а не берётся в точках
 * как есть. Голая ступенька в точках сравнивает несравнимое: боковые
 * карточки повёрнуты вокруг своей оси, и горизонтальный скан пересекает
 * их наклонные штрихи под углом — переход растягивается сам по себе,
 * без всякой размытости. Плюс боковые показываются мельче ближней,
 * и у них тоньше сами штрихи. Первая версия этой проверки мерила
 * голую ступеньку и объявила ближнюю карточку ВТРОЕ чётче боковых —
 * то есть мерила поворот и размер, а не резкость.
 *
 * Отношение ступеньки к штриху безразмерно: наклон и размер растягивают
 * оба числа одинаково и из отношения уходят.
 *
 * Запуск: node scripts/check-card-sharpness.mjs <url> [тема]
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const THEME = process.argv[3] ?? 'light';
const PREDEL = 1.05;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({
  viewport: { width: 1512, height: 900 },
  locale: 'ru-RU',
  deviceScaleFactor: 2,
});
await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), THEME);
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'networkidle' });

// Первое движение мыши поднимает отложенные куски (сцену и пузыри).
await page.mouse.move(760, 300);
await page.locator('.shop').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(2600);
// Курсор уводится с витрины: под ним карточки замирают и притухают,
// а нам нужны обычные, не приглушённые.
await page.mouse.move(20, 20);
await page.waitForTimeout(1200);

const est3d = await page.evaluate(() => !!document.querySelector('[data-3d]'));
if (!est3d) {
  console.log('!! сцена не поднялась — мерить нечего');
  await browser.close();
  process.exit(1);
}

/** Коробки заголовков на экране плюс масштаб показа каждой карточки. */
const meta = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.pcard')];
  return cards.map((el, i) => {
    const name = el.querySelector('.pcard__name');
    const r = name.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    return {
      i,
      x: r.x, y: r.y, w: r.width, h: r.height,
      masshtab: +(c.width / el.offsetWidth).toFixed(4),
      z: +getComputedStyle(el).zIndex,
    };
  });
});

const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1512, height: 900 } });

// Вторая опора, и главная. Ближняя карточка сравнивается САМА С СОБОЙ
// без сцены: у плоской раскладки нет ни матрицы, ни поворота, ни
// приглушения — это и есть образец правильной растеризации. Сравнение
// с боковыми карточками такой опорой быть не может: у них другой
// кегль заголовка, свой поворот и своя прозрачность.
await page.evaluate(() => {
  const root = document.querySelector('[data-3d]');
  if (root) root.removeAttribute('data-3d');
  for (const el of document.querySelectorAll('.pcard')) el.style.transform = 'none';
});
await page.waitForTimeout(500);
const ploskieMeta = await page.evaluate(() => {
  const el = document.querySelector('.pcard--active') ?? document.querySelectorAll('.pcard')[0];
  const r = el.querySelector('.pcard__name').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const bufPloskie = await page.screenshot({ clip: { x: 0, y: 0, width: 1512, height: 900 } });
await browser.close();
const png = PNG.sync.read(buf);
const pngPloskie = PNG.sync.read(bufPloskie);
const DPR = png.width / 1512;

const yarkIz = (img) => (x, y) => {
  const o = ((y * img.width) + x) * 4;
  return 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
};

/**
 * Средняя ширина ступеньки по строкам заголовка.
 *
 * По каждой строке ищутся перепады между краской и фоном; считается,
 * сколько точек занимает переход от 15 % до 85 % перепада.
 */
function stupenka(box, img = png) {
  const yark = yarkIz(img);
  const x0 = Math.round(box.x * DPR);
  const x1 = Math.round((box.x + box.w) * DPR);
  const y0 = Math.round(box.y * DPR);
  const y1 = Math.round((box.y + box.h) * DPR);
  let summa = 0;
  let kromok = 0;
  let shtrihov = 0;
  let shirinaShtrihov = 0;
  for (let y = y0 + 2; y < y1 - 2; y += 1) {
    const stroka = [];
    for (let x = x0; x < x1; x += 1) stroka.push(yark(x, y));
    if (stroka.length < 8) continue;
    const max = Math.max(...stroka);
    const min = Math.min(...stroka);
    if (max - min < 60) continue; // в этой строке букв нет
    const verh = min + (max - min) * 0.85;
    const niz = min + (max - min) * 0.15;
    // Идём по строке и меряем каждый переход между уровнями.
    let nachalo = -1;
    let sverhu = stroka[0] > verh;
    for (let i = 1; i < stroka.length; i += 1) {
      const v = stroka[i];
      const vnutri = v < verh && v > niz;
      if (vnutri && nachalo < 0) nachalo = i;
      if (!vnutri && nachalo >= 0) {
        const teper = v > verh;
        // Считаем только настоящие перепады: вход и выход по разные
        // стороны. Дрожание внутри одного уровня — не кромка.
        if (teper !== sverhu) {
          summa += i - nachalo;
          kromok += 1;
        }
        sverhu = teper;
        nachalo = -1;
      }
      if (!vnutri) sverhu = v > verh;
    }

    // Толщина штриха: длина сплошного тёмного участка. Ею и делится
    // ступенька, чтобы из вердикта ушли и наклон, и размер.
    let temnyh = 0;
    for (let i = 0; i < stroka.length; i += 1) {
      if (stroka[i] < niz) {
        temnyh += 1;
      } else if (temnyh > 0) {
        // Края строки не считаем: там штрих может быть обрезан.
        if (i - temnyh > 0 && i < stroka.length - 1) {
          shirinaShtrihov += temnyh;
          shtrihov += 1;
        }
        temnyh = 0;
      }
    }
  }
  const shtrih = shtrihov ? shirinaShtrihov / shtrihov : 0;
  const stup = kromok ? summa / kromok : 0;
  return { srednyaya: stup, kromok, shtrih, myagkost: shtrih ? stup / shtrih : 0 };
}

const zamery = meta
  .map((m) => ({ ...m, ...stupenka(m) }))
  .sort((a, b) => b.z - a.z);
const ploskaya = stupenka(ploskieMeta, pngPloskie);

console.log(`\n── чёткость текста на карточках витрины (${THEME}) ──`);
for (const z of zamery) {
  console.log(
    `  карточка ${z.i}: показ ×${z.masshtab.toFixed(3)}, ступенька ${z.srednyaya.toFixed(2)} px, ` +
      `штрих ${z.shtrih.toFixed(2)} px, мягкость ${z.myagkost.toFixed(3)} по ${z.kromok} кромкам`,
  );
}

const blizhnyaya = zamery[0];
const bokovye = zamery.slice(1);
if (!blizhnyaya || bokovye.length === 0 || bokovye.some((b) => !b.kromok)) {
  console.log('\n!! кромок не нашлось — проверка ничего не измерила');
  process.exit(1);
}
const bok = bokovye.reduce((s, b) => s + b.myagkost, 0) / bokovye.length;
const otnBok = blizhnyaya.myagkost / bok;
const otnPlosk = ploskaya.myagkost ? blizhnyaya.myagkost / ploskaya.myagkost : 0;

console.log(
  `  та же карточка ПЛОСКОЙ: ступенька ${ploskaya.srednyaya.toFixed(2)} px, ` +
    `штрих ${ploskaya.shtrih.toFixed(2)} px, мягкость ${ploskaya.myagkost.toFixed(3)} по ${ploskaya.kromok} кромкам`,
);
console.log(`\n  мягкость: ближняя в сцене ${blizhnyaya.myagkost.toFixed(3)}, боковые ${bok.toFixed(3)}, плоская ${ploskaya.myagkost.toFixed(3)}`);
console.log(`  к боковым ${otnBok.toFixed(3)} (мера кривая: у боковых свой кегль, поворот и прозрачность)`);
console.log(`  К ПЛОСКОЙ  ${otnPlosk.toFixed(3)} при пороге ${PREDEL} — вот это и есть размытие от слоя`);

if (!ploskaya.kromok) {
  console.log('\n!! плоскую карточку измерить не вышло — проверка ничего не доказала');
  process.exit(1);
}
const ok = otnPlosk <= PREDEL;
console.log(ok ? '\nСлой не размывает текст' : '\n!! Текст в слое мягче, чем в плоской раскладке');
process.exit(ok ? 0 : 1);
