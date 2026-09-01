/**
 * Свет из-за цветного блока: как он ложится на фон вокруг.
 *
 * Снимаем область вокруг блока со свечением и без него и смотрим
 * прирост яркости по мере удаления ОТ КРАЯ БЛОКА НАРУЖУ. У подсветки
 * не должно быть ступеньки — иначе она читается обводкой или
 * кольцом, а не светом на стене.
 *
 * Отдельно проверяем, сколько света долетает до соседнего текста
 * сверху и снизу: подсветка не должна перекрывать соседние блоки.
 *
 * У проверки есть нижняя граница, а не только верхняя. Без неё она
 * бесполезна: при нулевом свечении спад «плавный» (нечему спадать),
 * и возврат к вдавленным теням — ровно та поломка, ради которой
 * проверка написана, — проходил бы как успех. В тёмной теме свет у
 * кромки обязан быть, в светлой его обязано не быть.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2];
const THEME = process.argv[3] ?? 'dark';
const VW = Number(process.argv[4] ?? 1512);
const MARGIN = 220;

const b = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
const c = await b.newContext({ viewport: { width: VW, height: 1180 }, locale: 'ru-RU',
                               isMobile: VW < 500, hasTouch: VW < 500 });
await c.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), THEME);
const p = await c.newPage();
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(700);

// Подводим блок так, чтобы вокруг него был запас поля.
await p.evaluate((m) => {
  const el = document.querySelector('.referral');
  window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - m);
}, MARGIN);
await p.waitForTimeout(800);

const geom = await p.evaluate(() => {
  const r = document.querySelector('.referral').getBoundingClientRect();
  const near = (sel, which) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const q = e.getBoundingClientRect();
    return { sel, top: Math.round(q.top), bottom: Math.round(q.bottom), which };
  };
  // Сосед сверху — НИЖНЯЯ СТРОКА текста шагов, а не весь список.
  // Полоса должна быть чуть больше предмета и не больше: усреднение
  // по всему списку в 240 px размазало бы прирост по площади, куда
  // свет не долетает вовсе, и проба стала бы тем тише, чем длиннее
  // список. Прежде здесь стояла плашка `.steps__note`; её убрали,
  // и селектор перестал находиться — молча, потому что отсутствие
  // соседа проба тогда не считала за отказ.
  const nizhnyayaStroka = (which) => {
    const els = [...document.querySelectorAll('.steps .step__text')];
    if (!els.length) return null;
    const bottom = Math.round(Math.max(...els.map((e) => e.getBoundingClientRect().bottom)));
    return { sel: '.step__text, нижняя строка', top: bottom - 40, bottom, which };
  };
  return {
    block: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    above: nizhnyayaStroka('сверху'),
    below: near('.footer__head', 'снизу') || near('.footer', 'снизу'),
    vh: window.innerHeight,
  };
});

const grab = async (on) => {
  await p.evaluate((o) => {
    let st = document.getElementById('glow-probe');
    if (!st) { st = document.createElement('style'); st.id = 'glow-probe'; document.head.appendChild(st); }
    st.textContent = o ? '' : '.referral__glow{display:none !important}';
  }, on);
  await p.waitForTimeout(260);
  return PNG.sync.read(await p.screenshot());
};
const on = await grab(true), off = await grab(false);
await b.close();

const W = on.width, H = on.height;
const bl = geom.block;
const lum = (d, o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

// Прирост яркости по расстоянию наружу от прямоугольника блока.
const bins = new Map();
let outsidePx = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = Math.max(bl.x - x, x - (bl.x + bl.w - 1), 0);
    const dy = Math.max(bl.y - y, y - (bl.y + bl.h - 1), 0);
    if (dx === 0 && dy === 0) continue;          // это сам блок
    const d = Math.round(Math.hypot(dx, dy));
    if (d > 260) continue;
    const o = (y * W + x) << 2;
    const g = lum(on.data, o) - lum(off.data, o);
    const k = Math.floor(d / 10) * 10;
    const e = bins.get(k) || [0, 0, -999];
    e[0] += g; e[1]++; if (g > e[2]) e[2] = g;
    bins.set(k, e);
    outsidePx++;
  }
}
const rows = [...bins.entries()].sort((a, z) => a[0] - z[0]);

console.log(`  ${THEME === 'dark' ? 'тёмная' : 'светлая'} тема, ширина окна ${VW}, блок ${bl.w}x${bl.h} в кадре ${W}x${H}, ${outsidePx} пикселей вокруг`);
console.log('  прирост яркости наружу от края блока (уровни из 255, среднее / наибольшее):');
for (const [d, [sum, n, mx]] of rows.slice(0, 20))
  console.log(`      ${String(d).padStart(3)}–${String(d + 9).padStart(3)} px: ${(sum / n).toFixed(2)} / ${mx.toFixed(2)}`);

let jump = 0;
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1][1][0] / rows[i - 1][1][1], z = rows[i][1][0] / rows[i][1][1];
  jump = Math.max(jump, Math.abs(a - z));
}
const first = rows.length ? rows[0][1][0] / rows[0][1][1] : 0;
console.log(`  у самой кромки ${first.toFixed(2)}, наибольший шаг между соседними полосами ${jump.toFixed(2)}`);

// Сколько света долетает до соседнего текста.
const bandAt = (top, bottom) => {
  let sum = 0, n = 0, mx = -999;
  for (let y = Math.max(0, top); y <= Math.min(H - 1, bottom); y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) << 2;
      const g = lum(on.data, o) - lum(off.data, o);
      sum += g; n++; if (g > mx) mx = g;
    }
  return n ? { avg: sum / n, mx } : null;
};
// Ненайденный сосед — ОТКАЗ, а не заметка. Проба, потерявшая
// предмет, перестаёт что-либо мерить и при этом молчит: ровно тот
// случай, когда проверка опаснее упавшей.
let ustarela = 0;
for (const nb of [geom.above, geom.below]) {
  if (!nb) { console.log('  СОСЕДНИЙ БЛОК НЕ НАЙДЕН — проба устарела, поправьте селектор'); ustarela++; continue; }
  const r = bandAt(nb.top, nb.bottom);
  console.log(`  ${nb.which} (${nb.sel}, строки ${nb.top}–${nb.bottom}): прирост ${r.avg.toFixed(2)} в среднем, ${r.mx.toFixed(2)} наибольший`);
}

// В тёмной теме свет обязан быть и обязан спадать плавно.
// В светлой его обязано не быть вовсе — так решено сознательно.
const MIN_EDGE = 12, MAX_LIGHT = 1;
const smooth = jump <= first * 0.45 + 1;
const strong = THEME === 'dark' ? first >= MIN_EDGE : first <= MAX_LIGHT;
if (!smooth) console.log('  У СВЕЧЕНИЯ ЕСТЬ СТУПЕНЬКА');
if (!strong) console.log(THEME === 'dark'
  ? `  СВЕТА У КРОМКИ НЕТ: ${first.toFixed(2)} при требуемых ${MIN_EDGE} — свет либо убран, либо снова светит внутрь`
  : `  В СВЕТЛОЙ ТЕМЕ ПОЯВИЛСЯ СВЕТ: ${first.toFixed(2)} при допустимых ${MAX_LIGHT}`);
if (smooth && strong) console.log(THEME === 'dark'
  ? '  Свет снаружи есть, спад плавный, ступеньки нет'
  : '  В светлой теме свечения нет, как и задумано');
process.exit(smooth && strong && ustarela === 0 ? 0 : 1);
