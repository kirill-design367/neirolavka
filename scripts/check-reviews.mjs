/**
 * Бегущая строка отзывов.
 *
 * Проверяется не «красиво ли», а четыре свойства, каждое из которых
 * ломается тихо:
 *
 *  1. ПОЛОВИНА ДОРОЖКИ РАВНА ОДНОЙ КОПИИ. На этом держится
 *     бесшовность. Сдвиг идёт на −50 % ширины дорожки, и если
 *     промежутки заданы так, что половина не равна копии, лента
 *     на каждом обороте дёргается. Глазом это заметно раз в минуту
 *     с лишним — то есть не заметно вовсе, пока кто-нибудь
 *     не пожалуется.
 *  2. СТЫКА НЕ ВИДНО. Проверяется картинкой: снимок в момент 0
 *     и снимок в момент «полдороги» обязаны совпасть попиксельно.
 *     Это прямая проверка того же свойства, но уже по видимому
 *     результату, а не по числам раскладки.
 *  3. ПОД КУРСОРОМ ЛЕНТА СТОИТ. Иначе отзыв нельзя дочитать.
 *  4. ПРИ ВЫКЛЮЧЕННОМ ДВИЖЕНИИ ЛЕНТА СТОИТ И ЛИСТАЕТСЯ. Не «стоит
 *     и всё»: половина отзывов тогда была бы недостижима.
 *
 * Плюс к этому: высота блока (ради неё всё и затевалось), отсутствие
 * горизонтальной прокрутки у страницы и честная пометка про примеры.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let bad = 0;
const ok = (t) => console.log(`  ok   ${t}`);
const no = (t) => { bad++; console.log(`  НЕТ  ${t}`); };
const info = (t) => console.log(`  —    ${t}`);

const VIEWS = [
  { name: 'десктоп 1512×900', w: 1512, h: 900, mobile: false },
  { name: 'телефон 390×844', w: 390, h: 844, mobile: true },
];

const browser = await chromium.launch({ executablePath: CHROME });

/** Открыть страницу и доехать до отзывов. */
async function otkryt(vp, { reduced = false, tema = 'light' } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    locale: 'ru-RU',
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), tema);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('#otzyvy').scrollIntoView());
  await page.waitForTimeout(1400);
  return { ctx, page };
}

/** Анимация дорожки — по имени, а не «первая попавшаяся». */
const lentaAnim = `[...document.querySelector('.reviews__track').getAnimations()]
  .find((a) => a.animationName === 'reviews-run')`;

for (const vp of VIEWS) {
  console.log(`\n── ${vp.name} ──`);
  const { ctx, page } = await otkryt(vp);

  // ── 1. Раскладка: половина дорожки = одна копия ──────────────
  const geom = await page.evaluate(() => {
    const track = document.querySelector('.reviews__track');
    const cards = [...document.querySelectorAll('.review')];
    const cs = getComputedStyle(cards[0]);
    const shag = cards[0].getBoundingClientRect().width + parseFloat(cs.marginRight);
    return {
      kart: cards.length,
      shag,
      dorozhka: track.getBoundingClientRect().width,
      okno: Math.round(document.querySelector('.reviews').getBoundingClientRect().width),
      vysotaLenty: Math.round(document.querySelector('.reviews').getBoundingClientRect().height),
      vysotaBloka: Math.round(document.querySelector('#otzyvy').getBoundingClientRect().height),
      hScroll: document.documentElement.scrollWidth,
      shirinaOkna: document.documentElement.clientWidth,
      pometka: document.querySelector('.footer__disclaimer')?.textContent?.trim() ?? '',
      dubli: document.querySelectorAll('.review[aria-hidden="true"]').length,
      dlitelnost: getComputedStyle(track).animationDuration,
    };
  });

  if (geom.kart !== 12) no(`карточек ${geom.kart}, ожидалось 12 — шесть отзывов в двух копиях`);
  else ok('двенадцать карточек: шесть отзывов дважды');

  if (geom.dubli !== 6) no(`дублей помечено aria-hidden ${geom.dubli}, ожидалось 6 — скринридер прочтёт отзывы дважды`);
  else ok('вторая копия скрыта от скринридера');

  // Половина дорожки обязана совпасть с шестью шагами карточки.
  const kopiya = geom.shag * 6;
  const polovina = geom.dorozhka / 2;
  const rashod = Math.abs(kopiya - polovina);
  if (rashod > 0.75) {
    no(`половина дорожки ${polovina.toFixed(2)} px, а копия ${kopiya.toFixed(2)} px — расхождение ${rashod.toFixed(2)} px, на каждом обороте будет рывок`);
  } else {
    ok(`половина дорожки совпадает с копией в ${rashod.toFixed(2)} px (шаг карточки ${geom.shag.toFixed(2)})`);
  }

  if (geom.hScroll > geom.shirinaOkna) no(`страница поехала вбок: прокрутка ${geom.hScroll} при экране ${geom.shirinaOkna}`);
  else ok(`страница вбок не едет: ${geom.hScroll} при экране ${geom.shirinaOkna}`);

  if (!geom.pometka.includes('Примеры оформления')) no(`пометки про примеры нет, а стоит «${geom.pometka}»`);
  else ok(`пометка на месте: «${geom.pometka}»`);

  info(`высота ленты ${geom.vysotaLenty} px, всего блока ${geom.vysotaBloka} px, цикл ${geom.dlitelnost}`);

  // ── 2. Ход ровный и под курсором стоит ───────────────────────
  // Анимацию здесь НЕ ТРОГАЕМ ни play(), ни pause(), ни currentTime.
  //
  // Стоит вызвать play() — и Web Animations помечает анимацию как
  // управляемую скриптом: CSS-свойство animation-play-state перестаёт
  // на неё действовать, и правило «под курсором лента стоит»
  // не срабатывает. Проверка на этом честно объявила поломку там,
  // где страница исправна: в браузере наведение ленту останавливает,
  // а в замере — нет. Поэтому ход и наведение меряются ПЕРВЫМИ,
  // на нетронутой анимации, а снимки для стыка — последними: они
  // ставят currentTime и портят состояние безвозвратно.
  // Положение берётся в ПИКСЕЛЯХ по коробке дорожки, а не из
  // computed-значения translate: там лежит процент (−25%), и parseFloat
  // от него даёт −25 — число, которое выглядит как пиксели и ими
  // не является.
  const gde = () => page.evaluate(() => document.querySelector('.reviews__track').getBoundingClientRect().x);
  const shagi = [];
  let bylo = await gde();
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(320);
    const teper = await gde();
    shagi.push(bylo - teper);
    bylo = teper;
  }
  const sred = shagi.reduce((a, b) => a + b, 0) / shagi.length;
  const razbros = Math.max(...shagi.map((s) => Math.abs(s - sred)));
  if (sred <= 0.5) no(`лента не едет: средний шаг ${sred.toFixed(2)} px за 0.32 с`);
  else if (razbros > sred * 0.5) no(`ход неровный: шаги ${shagi.map((s) => s.toFixed(1)).join('/')} при среднем ${sred.toFixed(1)}`);
  else ok(`ход ровный: ${(sred / 0.32).toFixed(1)} px/с, наибольшее отклонение шага ${(razbros / sred * 100).toFixed(0)} %`);

  // Наведение. force не нужен: лента не парит, она едет ровно.
  await page.locator('.reviews').hover({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(200);
  const doNavedeniya = await gde();
  await page.waitForTimeout(900);
  const posle = await gde();
  const sdvig = Math.abs(posle - doNavedeniya);
  if (sdvig > 1) no(`под курсором лента продолжает ехать: ${sdvig.toFixed(1)} px за 0.9 с`);
  else ok(`под курсором лента стоит: ${sdvig.toFixed(2)} px за 0.9 с`);

  // Курсор с ленты убираем: дальше идут снимки, и остановленная
  // наведением лента к делу не относится.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(200);

  // ── 3. Стыка не видно: начало цикла против его конца ─────────
  //
  // Время анимации ставится руками, а не выжидается: цикл длится
  // больше минуты, и ждать его в проверке — значит не проверять
  // никогда.
  const snimok = async (ms) => {
    await page.evaluate(([sel, t]) => {
      const a = eval(sel);
      a.pause();
      a.currentTime = t < 0 ? a.effect.getComputedTiming().duration + t : t;
    }, [lentaAnim, ms]);
    await page.waitForTimeout(120);
    const box = await page.evaluate(() => {
      const r = document.querySelector('.reviews').getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    });
    return PNG.sync.read(await page.screenshot({ clip: box }));
  };

  // Сравниваются НАЧАЛО и КОНЕЦ цикла, а не начало и середина.
  // Стык у бегущей строки один: там, где анимация доиграла до −50 %
  // и мгновенно вернулась к нулю. В середине цикла сдвиг равен −25 %,
  // и сравнивать её с нулём бессмысленно — там и должно быть разное.
  // На этой ошибке проверка сначала объявила стык видимым (11.55 %
  // несовпавших точек) на совершенно исправной ленте.
  const a0 = await snimok(0);
  const a1 = await snimok(-0.001);
  let raznyh = 0;
  let hudshiy = 0;
  const n = Math.min(a0.data.length, a1.data.length);
  for (let i = 0; i < n; i += 4) {
    const d = Math.abs(a0.data[i] - a1.data[i]) + Math.abs(a0.data[i + 1] - a1.data[i + 1]) + Math.abs(a0.data[i + 2] - a1.data[i + 2]);
    if (d > 6) { raznyh++; if (d > hudshiy) hudshiy = d; }
  }
  const vsego = n / 4;
  const dolyaRaznyh = (raznyh / vsego) * 100;
  if (dolyaRaznyh > 0.2) {
    no(`начало и конец цикла разные: ${dolyaRaznyh.toFixed(2)} % точек не совпали (худшая ${hudshiy}) — стык будет виден`);
  } else {
    ok(`начало и конец цикла совпадают: несовпавших точек ${dolyaRaznyh.toFixed(3)} % из ${vsego}`);
  }

  await ctx.close();
}

// ── 4. Выключенное движение ───────────────────────────────────
console.log('\n── выключенное движение ──');
{
  const vp = VIEWS[1];
  const { ctx, page } = await otkryt(vp, { reduced: true });
  const s = await page.evaluate(() => {
    const track = document.querySelector('.reviews__track');
    const okno = document.querySelector('.reviews');
    const cs = getComputedStyle(okno);
    return {
      anim: getComputedStyle(track).animationName,
      idet: track.getAnimations().length,
      overflowX: cs.overflowX,
      mozhnoListat: okno.scrollWidth > okno.clientWidth + 4,
      vidnyhDubley: [...document.querySelectorAll('.review[aria-hidden="true"]')]
        .filter((el) => getComputedStyle(el).display !== 'none').length,
      dostupno: [...document.querySelectorAll('.review:not([aria-hidden="true"])')]
        .filter((el) => getComputedStyle(el).display !== 'none').length,
    };
  });
  if (s.anim !== 'none' || s.idet > 0) no(`лента едет при выключенном движении: ${s.anim}, живых анимаций ${s.idet}`);
  else ok('лента стоит');
  if (!s.mozhnoListat || s.overflowX === 'hidden') no(`лента не листается: overflow-x ${s.overflowX}, прокрутка ${s.mozhnoListat}`);
  else ok(`лента листается жестом: overflow-x ${s.overflowX}`);
  if (s.vidnyhDubley) no(`видно ${s.vidnyhDubley} дублей — листать один и тот же отзыв дважды незачем`);
  else ok('дублей не видно');
  if (s.dostupno !== 6) no(`доступно отзывов ${s.dostupno}, а их шесть`);
  else ok('все шесть отзывов доступны');
  await ctx.close();
}

await browser.close();
console.log(bad ? '\nБЕГУЩАЯ СТРОКА РАБОТАЕТ НЕ ТАК' : '\nБегущая строка: без стыка, под курсором стоит, при выключенном движении листается');
process.exit(bad ? 1 : 0);
