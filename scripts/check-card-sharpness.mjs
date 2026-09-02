/**
 * Чёткость текста на карточках витрины.
 *
 * Карточки выводятся слоем HTML, которому каждый кадр выставляется
 * преобразование от камеры сцены. Пока это была matrix3d при
 * `perspective` на контейнере, браузер растеризовал слой ОДИН раз
 * в размере раскладки, а показывал в размере, который задала матрица:
 * готовый растр растягивался, и кромка буквы размывалась. Сейчас
 * у неповёрнутой карточки обычное двумерное преобразование, и растр
 * считается сразу в нужном размере — эта проверка стережёт, чтобы
 * так и осталось.
 *
 * Меряется это шириной ступеньки на кромке буквы — сколько точек
 * занимает переход от фона к краске.
 *
 * Вердиктов ДВА, и они про разное. Первый — цена СЦЕНЫ: мягкость
 * ближней карточки в сцене против её же мягкости вне сцены при том
 * же увеличении и с остановленным парением. Опора отличается от
 * предмета ровно одним свойством, иначе меряется их сумма. Второй —
 * цена ПАРЕНИЯ: та же карточка в сцене, но с работающим парением.
 * Порог у него шире, потому что дробный сдвиг стоит по-разному
 * на разных машинах.
 *
 * Отношение к боковым печатается, но вердиктом быть не может:
 * у боковых свой кегль, свой поворот и своя прозрачность.
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
/** Порог для парения — см. пояснение у вердикта. */
const PREDEL_PARENIE = 1.35;

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
// Холст пузырей убирается из кадра, как и в остальных попиксельных
// проверках. Здесь он мешает не краской — карточка непрозрачна, —
// а нагрузкой: слой во весь экран перерисовывается каждый второй кадр,
// и на медленной машине снимок парящей карточки застаёт её в другой
// доле пикселя. На бегунке это подняло «цену парения» с 1.217 до
// 1.362 при пороге 1.35 — то есть проверка покраснела за то, что
// меряет не она.
await page.addStyleTag({ content: 'canvas.bubbles{display:none!important}' });

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

// Первый снимок — страница КАК ЕСТЬ: сцена держит карточку, парение
// работает. Это то, что видит человек.
const bufZhivoy = await page.screenshot({ clip: { x: 0, y: 0, width: 1512, height: 900 } });

// Второй — та же сцена, но парение ОСТАНОВЛЕНО и сброшено в ноль.
// Отменять надо через getAnimations: анимация побеждает inline-стиль
// по каскаду, а смена animation-name перезапускает её с кадра покоя
// и заодно выключает то, что выключать не просили.
await page.evaluate(() => {
  for (const el of document.querySelectorAll('.pcard')) {
    for (const a of el.getAnimations()) a.cancel();
  }
});
await page.waitForTimeout(400);
const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 1512, height: 900 } });

// Вторая опора, и главная. Ближняя карточка сравнивается САМА С СОБОЙ
// без сцены: у плоской раскладки нет ни сцены, ни поворота, ни
// приглушения. Сравнение с боковыми карточками такой опорой быть
// не может: у них другой кегль заголовка, свой поворот и своя
// прозрачность.
//
// Но опор надо ДВЕ, и вот почему. Ближняя карточка показывается
// крупнее раскладки (около ×1.08): она ближе к зрителю, в этом весь
// смысл витрины. Текст в нецелом масштабе браузер не может подогнать
// штрихами под сетку точек, и на машине с сильным хинтингом он всегда
// будет мягче того же текста без масштаба — независимо от того, есть
// сцена или нет. В контейнере разработки хинтинг слабый и разницы
// почти нет (0.115 против 0.117), на бегунке GitHub она заметна
// (0.126 против 0.092), и проверка с одной опорой краснела там,
// где всё исправно.
//
// Поэтому вердикт ставится по опоре В ТОМ ЖЕ МАСШТАБЕ: карточка вне
// сцены, но увеличенная ровно так же. Что останется — то и есть цена
// сцены. Вторая опора, в масштабе 1, печатается для сведения: она
// показывает цену самого увеличения, а её платит любая витрина
// с глубиной.
const masshtabBlizhney = meta.reduce((a, b) => (a.z > b.z ? a : b)).masshtab;
const snyatSCenu = () => page.evaluate(() => {
  const root = document.querySelector('[data-3d]');
  if (root) root.removeAttribute('data-3d');
  for (const el of document.querySelectorAll('.pcard')) {
    el.style.transform = 'none';
    el.style.animation = 'none';
    el.style.translate = 'none';
    el.style.rotate = 'none';
  }
});
const ploskijZamer = async (k) => {
  await snyatSCenu();
  await page.evaluate((kk) => {
    const el = document.querySelector('.pcard--active') ?? document.querySelectorAll('.pcard')[0];
    el.style.transformOrigin = '50% 50%';
    el.style.transform = kk === 1 ? 'none' : `scale(${kk})`;
  }, k);
  await page.waitForTimeout(500);
  const box = await page.evaluate(() => {
    const el = document.querySelector('.pcard--active') ?? document.querySelectorAll('.pcard')[0];
    const r = el.querySelector('.pcard__name').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const b = await page.screenshot({ clip: { x: 0, y: 0, width: 1512, height: 900 } });
  return { box, png: PNG.sync.read(b) };
};
const vMasshtabe = await ploskijZamer(masshtabBlizhney);
const vEdinice = await ploskijZamer(1);
await browser.close();
const png = PNG.sync.read(buf);
const pngZhivoy = PNG.sync.read(bufZhivoy);
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
const zhivayaBlizhnyaya = stupenka(
  meta.reduce((a, b) => (a.z > b.z ? a : b)),
  pngZhivoy,
);
const ploskaya = stupenka(vMasshtabe.box, vMasshtabe.png);
const ploskayaOdin = stupenka(vEdinice.box, vEdinice.png);

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
  `  та же карточка ВНЕ СЦЕНЫ, ×${masshtabBlizhney.toFixed(3)}: ступенька ${ploskaya.srednyaya.toFixed(2)} px, ` +
    `штрих ${ploskaya.shtrih.toFixed(2)} px, мягкость ${ploskaya.myagkost.toFixed(3)} по ${ploskaya.kromok} кромкам`,
);
console.log(
  `  она же ВНЕ СЦЕНЫ и без увеличения: ступенька ${ploskayaOdin.srednyaya.toFixed(2)} px, ` +
    `штрих ${ploskayaOdin.shtrih.toFixed(2)} px, мягкость ${ploskayaOdin.myagkost.toFixed(3)} по ${ploskayaOdin.kromok} кромкам`,
);
console.log(
  `  она же В СЦЕНЕ и С ПАРЕНИЕМ: ступенька ${zhivayaBlizhnyaya.srednyaya.toFixed(2)} px, ` +
    `штрих ${zhivayaBlizhnyaya.shtrih.toFixed(2)} px, мягкость ${zhivayaBlizhnyaya.myagkost.toFixed(3)} по ${zhivayaBlizhnyaya.kromok} кромкам`,
);
console.log(`\n  мягкость: ближняя в сцене ${blizhnyaya.myagkost.toFixed(3)}, боковые ${bok.toFixed(3)}, вне сцены в том же масштабе ${ploskaya.myagkost.toFixed(3)}`);
console.log(`  к боковым ${otnBok.toFixed(3)} (мера кривая: у боковых свой кегль, поворот и прозрачность)`);
console.log(`  ЦЕНА СЦЕНЫ ${otnPlosk.toFixed(3)} при пороге ${PREDEL} — вот это и есть вердикт`);
if (ploskayaOdin.myagkost) {
  console.log(
    `  цена самого увеличения ×${masshtabBlizhney.toFixed(3)}: ` +
      `${(ploskaya.myagkost / ploskayaOdin.myagkost).toFixed(3)} — её платит любая витрина с глубиной, ` +
      'и на машинах с разным хинтингом она разная',
  );
}

if (!ploskaya.kromok || !ploskayaOdin.kromok) {
  console.log('\n!! карточку вне сцены измерить не вышло — проверка ничего не доказала');
  process.exit(1);
}
// Второй вердикт — про ПАРЕНИЕ, и порог у него свой.
//
// Парение двигает карточку на доли пикселя, и композитор пересчитывает
// слой. Сколько это стоит — зависит от машины: там, где браузер
// подгоняет штрихи под сетку точек, дробный сдвиг обходится дороже.
// В контейнере разработки он не стоит ничего (0.108 против 0.109),
// на бегунке GitHub заметен. Поэтому порог здесь широкий: он ловит
// не проценты, а возврат к прежнему устройству, когда карточка ехала
// готовым растром и мягкость подскакивала в полтора раза.
const otnZhivoy = ploskaya.myagkost ? zhivayaBlizhnyaya.myagkost / ploskaya.myagkost : 0;
console.log(
  `  С ПАРЕНИЕМ ${otnZhivoy.toFixed(3)} при пороге ${PREDEL_PARENIE} — цена дробного сдвига, ` +
    'на разных машинах разная',
);

const ok = otnPlosk <= PREDEL && otnZhivoy <= PREDEL_PARENIE;
if (otnPlosk > PREDEL) console.log('\n!! Текст в сцене мягче, чем вне неё при том же масштабе');
else if (otnZhivoy > PREDEL_PARENIE) console.log('\n!! Парение размывает текст сильнее, чем должно');
else console.log('\nСцена не размывает текст');
process.exit(ok ? 0 : 1);
