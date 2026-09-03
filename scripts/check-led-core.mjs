/**
 * Светодиод на дорожке шагов: форма и ядро.
 *
 * Прежде здесь мерился ПЕРЕЛИВ внутри капли — сколько цветов ползает
 * в её сердцевине. Того перелива больше нет и не должно быть: капля
 * из двух крутящихся долей с разноцветными градиентами читалась
 * аморфным пятном, а не источником света. Проверка переписана
 * под то, что теперь требуется от капли:
 *
 *   1. СИЛУЭТ ВЫТЯНУТ ВДОЛЬ ХОДА. На горизонтальной дорожке капля
 *      шире, чем выше; на вертикальной наоборот. Круглое пятно —
 *      это не движущийся свет.
 *   2. ЯДРО СВЕТЛЕЕ КРОМКИ. В обеих темах: и днём, и ночью
 *      сердцевина взята из --c-spark-3, а кромка из --c-brand,
 *      и порядок светлот там один и тот же.
 *   3. ФОРМА ЯСНАЯ, а не облако. Площадь плотной части капли
 *      сравнивается с площадью объявленной коробки: у размытого
 *      пятна плотной части почти нет, у наклейки она вдвое больше
 *      объявленной.
 *
 * Всё, кроме капли, на время замера прячется: дорожка и цифры дают
 * свою краску, и без этого меряется не капля, а окрестность.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let bad = 0;
const ok = (t) => console.log(`  ok   ${t}`);
const no = (t) => { bad++; console.log(`  НЕТ  ${t}`); };
const info = (t) => console.log(`  —    ${t}`);

const browser = await chromium.launch({ executablePath: CHROME });

for (const [w, theme, name] of [
  [1512, 'light', 'десктоп, светлая'],
  [1512, 'dark', 'десктоп, тёмная'],
  [390, 'light', 'телефон, светлая'],
]) {
  console.log(`\n── ${name} ──`);
  const ctx = await browser.newContext({
    viewport: { width: w, height: 900 },
    locale: 'ru-RU',
    isMobile: w < 500,
    hasTouch: w < 500,
    deviceScaleFactor: 4,
  });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  // Тот же холст пузырей: он закреплён по окну, лежит за содержимым
  // и виден на любой высоте прокрутки. «Фон» здесь берётся ОДНОЙ
  // точкой из угла снимка — заехавший в этот угол пузырь уводит опору,
  // и вся краска капли дальше считается от неверного нуля, вплоть до
  // вердикта «капли на снимке нет». Прячем до первого снимка.
  await page.addStyleTag({ content: 'canvas.bubbles{display:none!important}' });
  await page.evaluate(() => document.querySelector('.steps').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1400);

  // Капля ставится в четверть пути — там она заведомо не накрыта
  // цифрой. Дыхание ореола замораживается, иначе размер пятна гуляет.
  const geom = await page.evaluate(() => {
    const th = document.querySelector('.steps__thread');
    const a = th.getAnimations().find((x) => x.animationName === 'led-run');
    if (!a) return null;
    a.pause();
    a.currentTime = 0.25 * 0.78 * parseFloat(getComputedStyle(th).getPropertyValue('--cycle')) * 1000;
    for (const x of document.getAnimations()) {
      if (x.animationName === 'led-breathe') { x.pause(); x.currentTime = 0; }
    }
    // Прячем всё, кроме капли.
    document.querySelector('.steps__track').style.background = 'transparent';
    document.querySelector('.steps__track-fill').style.visibility = 'hidden';
    for (const s of document.querySelectorAll('.step')) s.style.visibility = 'hidden';
    const led = document.querySelector('.steps__led');
    const r = led.getBoundingClientRect();
    return {
      horiz: th.dataset.trackDir === 'horizontal',
      w: r.width,
      h: r.height,
      box: { x: Math.round(r.x - 22), y: Math.round(r.y - 22),
             width: Math.round(r.width + 44), height: Math.round(r.height + 44) },
    };
  });
  if (!geom) { no('анимации led-run нет — проба устарела'); await ctx.close(); continue; }

  await page.waitForTimeout(150);
  const png = PNG.sync.read(await page.screenshot({ clip: geom.box }));
  const DPR = png.width / geom.box.width;
  const yark = (x, y) => {
    const o = ((y * png.width) + x) * 4;
    return 0.2126 * png.data[o] + 0.7152 * png.data[o + 1] + 0.0722 * png.data[o + 2];
  };
  // Фон — угол снимка: там заведомо ничего нет.
  const fon = yark(1, 1);
  // Краска: отклонение от фона. Направление отклонения разное
  // в темах, поэтому берём модуль.
  const kr = (x, y) => Math.abs(yark(x, y) - fon);

  let pik = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) pik = Math.max(pik, kr(x, y));
  if (pik < 12) { no(`капли на снимке нет: наибольшее отклонение от фона ${pik.toFixed(1)} уровня`); await ctx.close(); continue; }

  // Плотная часть: не меньше половины пика.
  let minX = 1e9; let maxX = -1e9; let minY = 1e9; let maxY = -1e9; let plot = 0;
  let sx = 0; let sy = 0; let sw = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const v = kr(x, y);
      if (v > pik * 0.5) {
        plot++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      sx += v * x; sy += v * y; sw += v;
    }
  }
  const shir = (maxX - minX + 1) / DPR;
  const vys = (maxY - minY + 1) / DPR;
  const vdol = geom.horiz ? shir : vys;
  const poperek = geom.horiz ? vys : shir;
  const rastyazh = poperek ? vdol / poperek : 0;
  info(`плотная часть ${shir.toFixed(1)}×${vys.toFixed(1)} px при коробке ${geom.w.toFixed(1)}×${geom.h.toFixed(1)}`);
  // КАПЛЯ КРУГЛАЯ, и проба перевёрнута именно поэтому.
  //
  // Здесь стояло обратное требование: «вытянута вдоль хода, отношение
  // не меньше 1.6». Вытянутая капля читалась размазанной и, главное,
  // разворачивалась вместе с раскладкой — на телефоне дорожка
  // вертикальная, и форма зависела от ширины окна. Владелец попросил
  // круг; значит, проверять надо круг, а не оставлять правило,
  // которое теперь стережёт отменённое решение.
  //
  // Допуск 0.12 — это не «чтобы сегодня было зелено»: круг снимается
  // по плотной части, у которой края отсекаются порогом в половину
  // пика, и одна и та же окружность даёт 0.98 в одной теме и 1.00
  // в другой. Прежний эллипс 22×9 давал 2.44 и краснеет с любым
  // допуском такого порядка.
  const KRUG = 0.12;
  if (Math.abs(rastyazh - 1) > KRUG) no(`капля не круглая: ${vdol.toFixed(1)} вдоль хода против ${poperek.toFixed(1)} поперёк, отношение ${rastyazh.toFixed(2)} при допуске ${(1 - KRUG).toFixed(2)}–${(1 + KRUG).toFixed(2)}`);
  else ok(`капля круглая: ${vdol.toFixed(1)} вдоль хода против ${poperek.toFixed(1)} поперёк, отношение ${rastyazh.toFixed(2)}`);

  // Площадь плотной части против объявленного круга.
  const ellips = Math.PI * (geom.w / 2) * (geom.h / 2);
  const dolya = (plot / (DPR * DPR)) / ellips;
  if (dolya < 0.5 || dolya > 1.6) no(`форма размыта или разъехалась: плотная часть ${(dolya * 100).toFixed(0)} % объявленного круга (коридор 50–160 %)`);
  else ok(`форма ясная: плотная часть ${(dolya * 100).toFixed(0)} % объявленного круга`);

  // Ядро против кромки: середина обязана быть СВЕТЛЕЕ.
  const cx = sx / sw; const cy = sy / sw;
  const rx = (geom.w / 2) * DPR; const ry = (geom.h / 2) * DPR;
  const kolco = (a, b) => {
    let s = 0; let n = 0;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d >= a && d < b) { s += yark(x, y); n++; }
      }
    }
    return n ? s / n : 0;
  };
  const yadro = kolco(0, 0.3);
  const kromka = kolco(0.72, 0.96);
  const perepad = yadro - kromka;
  if (perepad < 12) no(`ядра не видно: середина ${yadro.toFixed(1)}, кромка ${kromka.toFixed(1)}, перепад ${perepad.toFixed(1)} уровня при пороге 12`);
  else ok(`ядро светлее кромки на ${perepad.toFixed(1)} уровня (середина ${yadro.toFixed(1)}, кромка ${kromka.toFixed(1)})`);

  await ctx.close();
}

await browser.close();
console.log(bad ? '\nСВЕТОДИОД ВЫГЛЯДИТ НЕ ТАК' : '\nСветодиод: силуэт круглый, ядро светлее кромки');
process.exit(bad ? 1 : 0);
