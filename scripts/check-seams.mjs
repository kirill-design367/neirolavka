/**
 * Стык фонов по вертикали: фон страницы обязан течь непрерывно,
 * а у полноширинных полос кромка обязана быть ОДНА и намеренная.
 *
 * Страница открывается с ВЫКЛЮЧЕННЫМ движением: так в кадре остаются
 * только фоны, ровно то, ради чего скрипт написан.
 *
 * ЧТО ЭТА ПРОВЕРКА ВИДИТ, А ЧТО НЕТ — сказано здесь прямо, потому что
 * первая редакция обещала больше, чем делала. Проба идёт по узкой
 * полосе у левого края (x = 20) — «слева от содержимого, там нет
 * карточек, только фон секций». Содержимое на 1512 px стоит от 164-го
 * пикселя, поэтому в полосу попадают ТОЛЬКО заливки во всю ширину
 * окна; фон секции, нарисованный внутри колонки, проба не видит вовсе.
 * Замер: `.steps { background: #e0e6e0 }` — вторая ровная заливка
 * посреди страницы — не сдвинула вердикт ни на сотую. Полосы внутри
 * колонки взять негде: на x = 166…756 приходится от 136 до 379 шагов
 * крупнее порога, это буквы и карточки, а не фон.
 *
 * Отсюда устройство. Проверка спрашивает У СТРАНИЦЫ, какие элементы
 * красят фон во всю ширину окна, и печатает их список — если однажды
 * не найдётся ни одного, это ОТКАЗ, а не тихий зелёный прогон.
 * Дальше два разных вопроса:
 *   1. вне кромок этих полос фон обязан течь непрерывно (порог 6
 *      из 255 — меньше глазом не поймать);
 *   2. каждая кромка обязана укладываться в ОДНУ строку пикселей:
 *      размазанный на две-три строки край означает, что заливка едет
 *      подложкой чего-то ещё.
 *
 * КРОМКА ПОДВАЛА НАМЕРЕННАЯ, И ЭТО НЕ ПОДГОНКА ПОРОГА. Проверка
 * писалась, когда подвал набирался градиентом на 12rem и любой
 * заметный шаг означал недосмотр. В сентябре 2026 владелец попросил
 * убрать бежевый переход и оставить РОВНЫЙ светло-серый фон — а ровная
 * заливка, отличимая от страницы, по построению даёт шаг на своей
 * верхней кромке: #fdfbf9 → #ebeae5 это 31.8 из 255, и меньше быть
 * не может, пока полоса видна глазом. Прежний порог запрещал
 * не недосмотр, а само решение.
 *
 * Проверено на способность падать: вторая полноширинная заливка,
 * размазанная на несколько строк кромка и страница без единой полосы
 * краснят три разные пробы.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
/** Непреднамеренный стык: 6 из 255 глазом уже не поймать. */
const POROG = 6;
/** Полоса пробы: левое поле страницы, туда не попадает содержимое. */
const X = 20;

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
let bad = 0;
console.log('Стыки фонов (движение выключено)');

for (const theme of ['light', 'dark']) {
  const tema = theme === 'dark' ? 'тёмная' : 'светлая';
  const c = await b.newContext({
    viewport: { width: 1512, height: 900 },
    locale: 'ru-RU',
    reducedMotion: 'reduce',
  });
  await c.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const p = await c.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  /* Кромки берутся из РАЗМЕТКИ, а не вписываются числами: числа
     разъедутся с вёрсткой на первой же правке отступов. */
  const polosy = await p.evaluate((probaX) => {
    const naydeno = [];
    for (const e of document.querySelectorAll('body *')) {
      const st = getComputedStyle(e);
      const krasit =
        (st.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(st.backgroundColor)) ||
        (st.backgroundImage && st.backgroundImage !== 'none');
      if (!krasit) continue;
      const r = e.getBoundingClientRect();
      // Полоса должна накрывать колонку пробы и идти во всю ширину окна.
      if (r.left > probaX || r.right < innerWidth - probaX) continue;
      if (r.height < 40) continue;
      naydeno.push({
        imya: e.className ? `.${String(e.className).split(/\s+/)[0]}` : e.tagName.toLowerCase(),
        verh: Math.round(r.top + scrollY),
      });
    }
    return naydeno;
  }, X);

  if (polosy.length === 0) {
    console.log(`  ОТКАЗ ${tema}: во всю ширину не красит ни один элемент — пробе нечего смотреть`);
    bad++;
    await c.close();
    continue;
  }

  const png = PNG.sync.read(await p.screenshot({ fullPage: true }));
  const col = [];
  for (let y = 0; y < png.height; y++) {
    const i = (png.width * y + X) << 2;
    col.push([png.data[i], png.data[i + 1], png.data[i + 2]]);
  }
  const shag = (y) =>
    y > 0 && y < col.length
      ? Math.hypot(col[y][0] - col[y - 1][0], col[y][1] - col[y - 1][1], col[y][2] - col[y - 1][2])
      : 0;

  const kromki = [...new Set(polosy.map((s) => s.verh))].filter((y) => y > 0 && y < col.length);
  console.log(
    `  полос во всю ширину: ${polosy.length} (${polosy.map((s) => `${s.imya}@${s.verh}`).join(', ')})`,
  );

  // 1. Вне кромок фон обязан течь непрерывно.
  let worst = 0;
  let worstY = 0;
  for (let y = 1; y < col.length; y++) {
    if (kromki.includes(y)) continue;
    const d = shag(y);
    if (d > worst) {
      worst = d;
      worstY = y;
    }
  }
  const chisto = worst < POROG;
  if (!chisto) bad++;
  console.log(
    `  ${chisto ? 'ok  ' : 'СТЫК'} ${tema}: вне кромок самый резкий перепад ${worst.toFixed(1)} из 255 на высоте ${worstY} px`,
  );

  // 2. Каждая кромка — ровно одна строка пикселей.
  for (const y of kromki) {
    const ryadom = [y - 2, y - 1, y + 1, y + 2].map(shag);
    const grubeyshiy = Math.max(0, ...ryadom);
    const odna = grubeyshiy < POROG;
    if (!odna) bad++;
    console.log(
      `  ${odna ? 'ok  ' : 'РАЗМАЗАНА'} ${tema}: кромка на ${y} px — шаг ${shag(y).toFixed(1)}, у соседних строк не больше ${grubeyshiy.toFixed(1)}`,
    );
  }

  await c.close();
}

await b.close();
console.log(bad ? '\nЕсть резкие стыки' : '\nФон течёт непрерывно, у каждой полосы ровно одна кромка');
process.exit(bad ? 1 : 0);
