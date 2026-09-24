/**
 * Витрина продуктов: карточки по дуге в трёхмерной сцене плюс
 * слой настоящего HTML поверх неё.
 *
 * Проверка отвечает на четыре вопроса, и на каждый — числом:
 *
 *   1. Карточки стоят В СВОЁМ БЛОКЕ. Это не придирка: слой HTML
 *      получает матрицу от камеры, и одна перепутанная перестановка
 *      в списке transform уводит всю тройку на пятьсот пикселей вверх,
 *      на первый экран. Выглядит это как «карточки поверх заголовка»,
 *      а ни проверка разрешений, ни проверка контраста этого не ловят:
 *      по горизонтали ничего не вылезает и контраст в порядке.
 *   2. Текст остаётся текстом. Названия, сроки и цены должны читаться
 *      из DOM, а не быть точками внутри WebGL.
 *   3. Выбор работает: нажатие раскрывает тарифы своей карточки,
 *      закрывает чужие и доезжает до панели заказа.
 *   4. Без WebGL и при выключенном движении остаётся плоская витрина,
 *      на которой всё это по-прежнему можно сделать.
 *
 * Запуск: node scripts/check-shelf.mjs <url>
 */
import { chromium } from 'playwright';

const URL = process.argv[2];
if (!URL) { console.error('нужен адрес'); process.exit(2); }

const browser = await chromium.launch({ executablePath: (process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
let bad = 0;
let kartochekVScene = 0;
const ok = (s) => console.log(`  ok   ${s}`);
const no = (s) => { bad++; console.log(`  НЕТ  ${s}`); };

/** Нажатие по плывущей карточке.
 *
 *  Карточки витрины микропарят, а actionability-проверки Playwright
 *  ждут «стабильности» элемента, которой у плывущей карточки не бывает:
 *  обычный click уходит в таймаут. force её пропускает, но заодно
 *  пропускает и прокрутку к элементу — на телефоне карточка оказывалась
 *  ниже окна, клик уходил в пустоту, и проверка показывала «нажали
 *  на третью, выбрана первая». Поэтому прокрутку делаем сами. */
const tap = async (page, loc) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(250);
  await loc.click({ force: true });
};

/* Чужой счётчик глушится на время замера — тем же приёмом и по той же
 * причине, что в `verify-live`. Проверка отвечает за НАШУ витрину;
 * из контейнера разработки узел Яндекса недоступен вовсе, и его
 * неудачный запрос засчитывался ошибкой консоли — шесть красных строк
 * на совершенно исправной сборке.
 *
 * Ответ ПУСТОЙ, а не обрыв: обрыв пишет в консоль «Failed to load
 * resource: net::ERR_FAILED» без адреса, и свой обрыв становится
 * неотличим от чужой поломки. Условие — функция по имени узла,
 * а не образец: промах образца читался бы как «счётчика нет».
 * Сам счётчик проверяет `check-metrika`, и там он не глушится. */
const bezSchetchika = (ctx) =>
  ctx.route((u) => /(^|\.)yandex\.[a-z]+$/.test(u.hostname), (r) => r.fulfill({ status: 200, body: '' }));

/* ─── СВОЙ КАТАЛОГ ВМЕСТО ЧУЖОГО ПРАЙСА ────────────────────────────
 *
 * Проба, которой нужен продукт с особым свойством, НЕ ИЩЕТ его
 * в прайсе владельца. Прайс принадлежит ему, он вправе завести
 * или снять что угодно — и уже дважды это роняло проверки, которые
 * держались за его содержимое: сначала у бота (`PRODUKT_BEZ_UROVNEY`
 * искался в файле каталога и исчез, уронив двенадцать файлов разом),
 * потом здесь (проба «продукт без уровней» краснела на совершенно
 * исправном сайте, потому что таких продуктов в лавке не осталось).
 *
 * У бота это вылечено тем, что стенд ЗАВОДИТ продукт сам. Здесь —
 * тем же: проба подставляет странице свой каталог. Единственное
 * место, куда она может дотянуться до того, как страница его
 * прочитает, — сеть, поэтому подменяется кусок сборки.
 *
 * Три вещи, которые легко сделать неправильно:
 *
 *   1. Конец массива ищется СЧЁТОМ СКОБОК, а не регуляркой: внутри
 *      продуктов лежат вложенные массивы уровней, и ленивое `]`
 *      закрыло бы первый попавшийся.
 *   2. Заголовки кодирования и длины СНИМАЮТСЯ. Тело уже раскодировано
 *      `route.fetch()`, и оставленный `content-encoding: gzip` заставил
 *      бы браузер разбирать распакованный текст как сжатый: кусок
 *      не загрузился бы, сцена молча осталась бы плоской, а проба
 *      мерила бы не то.
 *   3. Разметка на сервере отрисована НАСТОЯЩИМ каталогом. React
 *      пересобирает корень заново, и ждать надо СОБЫТИЕ — появление
 *      нужного числа карточек, — а не срок.
 *
 * Не нашёлся кусок с каталогом — это ОТКАЗ, а не пропуск: проба,
 * которая молча померила чужой прайс, хуже упавшей.
 */
const podstavitKatalog = async (ctx, produkty) => {
  const schet = { podmen: 0 };
  await ctx.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
    const r = await route.fetch();
    let t = await r.text();
    const i0 = t.indexOf('products:[');
    if (i0 >= 0) {
      let dep = 0;
      let k = i0 + 'products:'.length;
      for (; k < t.length; k++) {
        if (t[k] === '[') dep++;
        else if (t[k] === ']' && --dep === 0) break;
      }
      t = `${t.slice(0, i0)}products:${JSON.stringify(produkty)}${t.slice(k + 1)}`;
      schet.podmen++;
    }
    const h = { ...r.headers() };
    delete h['content-encoding'];
    delete h['content-length'];
    await route.fulfill({ status: r.status(), headers: h, body: t });
  });
  return schet;
};

/** Дождаться, пока страница перерисуется подставленным каталогом. */
const zhdatKartochki = async (page, skolko) =>
  page
    .waitForFunction((k) => document.querySelectorAll('.pcard').length === k, skolko,
                     { timeout: 15000 })
    .then(() => true)
    .catch(() => false);

/** Продукт пробы: уровни задаются списком, всё остальное — заглушки. */
const proba = (n, urovni) => ({
  id: `proba-${n}`,
  name: `Проба ${n}`,
  tagline: 'Подставлено проверкой',
  note: 'Этого продукта нет в прайсе владельца',
  priceRub: urovni.length ? null : 990,
  plans: urovni.map((u, j) => ({
    id: `proba-${n}-${j + 1}`, short: u, title: `Проба ${n}, ${u}`, priceRub: 100 * (j + 1),
  })),
});

/** Разбудить отложенную загрузку: сцена ждёт первого действия человека. */
// Сцена поднимается по ПЕРВОМУ действию человека, и тяжёлый кусок
// с Three.js едет по сети. Фиксированная пауза здесь — гонка: на
// локальной выдаче 1800 мс хватало всегда, на боевом адресе с чистым
// кешем контекста хватило девять раз из десяти, а на десятом (390×844,
// тёмная) прогон покраснел при исправном сайте. Ждём СОБЫТИЕ, а не
// срок: опрашиваем data-3d до потолка. Проверка при этом не ослаблена —
// если сцена не поднимется вовсе, ожидание упрётся в потолок и вердикт
// будет тот же самый, только на 8 секунд позже.
const POTOLOK_SCENY_MS = 8000;

/** Насколько карточку может закрыть передний сосед. См. пояснение у замера. */
const PREDEL_ZAKRYTIYA = 0.93;
const wake = async (page) => {
  await page.mouse.move(60, 200);
  await page.mouse.move(64, 204);
  await page.evaluate(() => document.querySelector('.shop').scrollIntoView({ block: 'center' }));
  await page
    .waitForFunction(() => document.querySelector('.shelf3d')?.hasAttribute('data-3d'), null,
                     { timeout: POTOLOK_SCENY_MS, polling: 100 })
    .catch(() => {});
  // Сцена объявилась — дать ей кадр-другой доехать до конечных мест.
  await page.waitForTimeout(600);
};

const geometry = async (page) => page.evaluate(() => {
  const root = document.querySelector('.shelf3d');
  const r = root.getBoundingClientRect();
  return {
    d3: root.hasAttribute('data-3d'),
    box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    cards: [...document.querySelectorAll('.pcard')].map((el) => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height,
               z: Number(getComputedStyle(el).zIndex) || 0 };
    }),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
});

// ─── Объёмная витрина: геометрия, текст, выбор ─────────────────────
for (const [w, h, phone] of [[1512, 900, false], [1920, 1080, false], [390, 844, true]]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h }, locale: 'ru-RU', isMobile: phone, hasTouch: phone,
    });
    await bezSchetchika(ctx);
    await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await wake(page);

    console.log(`\n── ${w}×${h}, ${theme === 'light' ? 'светлая' : 'тёмная'} ──`);
    const g = await geometry(page);
    if (!g.d3) { no('сцена не поднялась — здесь она должна быть'); await ctx.close(); continue; }

    // 1. Карточки в своём блоке. Запас в 24 px — на подъём выбранной
    //    карточки и мягкий край тени; уход на сотни пикселей это ловит.
    const out = g.cards
      .map((c, i) => ({ i, up: g.box.top - c.top, down: c.bottom - g.box.bottom }))
      .filter((c) => c.up > 24 || c.down > 24);
    if (out.length) {
      for (const c of out) no(`карточка ${c.i + 1} вне блока: сверху ${c.up.toFixed(0)} px, снизу ${c.down.toFixed(0)} px`);
    } else {
      const up = Math.max(...g.cards.map((c) => g.box.top - c.top));
      const down = Math.max(...g.cards.map((c) => c.bottom - g.box.bottom));
      ok(`все ${g.cards.length} карточек внутри блока: наибольший выход сверху ${up.toFixed(0)} px, снизу ${down.toFixed(0)} px`);
    }
    if (g.overflow > 0) no(`страница шире экрана на ${g.overflow} px`); else ok('страница не шире экрана');

    // Карточка обязана оставаться в СВОЁМ блоке и по горизонтали.
    //
    // Прежде проверялась только вертикаль, и это молчало ровно там,
    // где ломается дуга: на широком экране витрина делит строку
    // с панелью заказа, и уехавшая вбок карточка лезет под панель,
    // не расширяя страницу. Поймать это можно было только глазами.
    const outX = g.cards
      .map((c, i) => ({ i, l: g.box.left - c.left, r: c.right - g.box.right }))
      .filter((c) => c.l > 2 || c.r > 2);
    if (outX.length) {
      for (const c of outX) no(`карточка ${c.i + 1} вылезает вбок: слева ${c.l.toFixed(0)} px, справа ${c.r.toFixed(0)} px`);
    } else {
      const zapas = Math.min(...g.cards.map((c) => Math.min(c.left - g.box.left, g.box.right - c.right)));
      ok(`по горизонтали карточки в блоке: наименьший запас ${zapas.toFixed(0)} px`);
    }

    // НИ ОДНА КАРТОЧКА НЕ СПРЯТАНА ЦЕЛИКОМ.
    //
    // Прежнее правило — «перекрытие не больше половины» — было
    // написано для трёх карточек, которые в дугу помещались, не
    // задевая друг друга. Шесть в ту же колонку так не помещаются
    // никак: одна середина занимает 286 px из 736. Значит вопрос
    // не «есть ли перекрытие», а «остался ли от карточки хоть
    // край»: продукт, спрятанный на 100 %, нельзя ни увидеть,
    // ни нажать.
    //
    // Считается перекрытие теми, кто СПЕРЕДИ: порядок держит
    // z-index, и карточка позади прячется только под теми, у кого
    // он больше.
    const covered = g.cards.map((a, i) => {
      let worstOne = 0;
      g.cards.forEach((b, j) => {
        if (i === j || b.z <= a.z) return;
        const dx = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const dy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        worstOne = Math.max(worstOne, (dx * dy) / (a.w * a.h));
      });
      return worstOne;
    });
    // ПОРОГ ОДИН И ТОТ ЖЕ, что у пробы «дуга при 3…8 продуктах» ниже,
    // и это не косметика. Здесь стояло 0.97, и оно пропускало ровно
    // ту поломку, ради которой написано: при шести продуктах четвёртую
    // карточку закрывало на 95–96 %, владелец это увидел, а проверка
    // молчала. Разница между «закрыта на 95 %» и «закрыта целиком»
    // для человека, который хочет нажать, никакая.
    //
    // 0.93 — не подобранное «сегодня зелено», а следствие обещания
    // раскладки: каждый ряд обязан выступить из-за предыдущего
    // на 18 px экрана, и на самой мелкой карточке дуги это 11–14 %
    // её площади. Замер по отрисованной странице: 84–88 % при
    // шести продуктах.
    const worst = Math.max(...covered);
    if (worst > PREDEL_ZAKRYTIYA) no(`карточка ${covered.indexOf(worst) + 1} закрыта соседом на ${(worst * 100).toFixed(0)} % — её не видно и не нажать`);
    else ok(`каждая карточка видна: наибольшее закрытие передним соседом ${(worst * 100).toFixed(0)} % площади`);

    // 2. Текст остаётся текстом.
    const texts = await page.evaluate(() => ({
      names: [...document.querySelectorAll('.pcard__name')].map((e) => e.textContent.trim()),
      prices: [...document.querySelectorAll('.tariff__price')].map((e) => e.textContent.trim()),
      selectable: getComputedStyle(document.querySelector('.pcard__name')).userSelect !== 'none',
    }));
    kartochekVScene = g.cards.length;
    if (texts.names.length === g.cards.length && texts.names.every((t) => t.length > 2)) {
      ok(`названия читаются из DOM: ${texts.names.join(', ')}`);
    } else {
      no(`названий в DOM ${texts.names.length} при ${g.cards.length} карточках: ${JSON.stringify(texts.names)}`);
    }
    // Цена — ТЕКСТ, а не текстура внутри WebGL. Цифра в ней не
    // обязательна: пока прайса нет, в этом месте стоит слово
    // «уточняется», и требовать от него цифру значило бы требовать
    // выдуманную цену.
    if (texts.prices.length >= 1 && texts.prices.every((t) => t.length > 2)) {
      ok(`цены — текст: ${texts.prices.join(' · ')}`);
    } else {
      no(`цены не читаются: ${JSON.stringify(texts.prices)}`);
    }

    // 3. Наведение выводит боковую карточку вперёд и возвращает назад.
    if (!phone) {
      // Наводимся на ПЕРВОГО соседа выбранной, а не на третью
      // карточку по счёту: дальние в колоде закрыты передними,
      // и середина их коробки приходится на чужую карточку —
      // наведение уходило бы не туда, а проверка мерила бы покой.
      const side = page.locator('.pcard').nth(1);
      const before = (await side.boundingBox()).width;
      // Наводимся мышью по координатам, а не locator.hover(): карточки
      // микропарят, а hover ждёт «стабильности» элемента, которой
      // у плывущей карточки не бывает, и уходит в таймаут.
      const hoverAt = async (loc) => {
        const b = await loc.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      };
      await hoverAt(side);
      await page.waitForTimeout(1100);
      const during = (await side.boundingBox()).width;
      await page.mouse.move(4, 4);
      await page.waitForTimeout(1100);
      const after = (await side.boundingBox()).width;
      const grow = during / before - 1;
      const back = Math.abs(after / before - 1);
      // Нижняя граница обязательна: без неё «карточка не двинулась»
      // засчиталось бы как «двинулась плавно».
      if (grow > 0.03 && back < 0.02) ok(`наведение выводит карточку вперёд: ширина +${(grow * 100).toFixed(1)} %, возврат в ${(back * 100).toFixed(1)} %`);
      else no(`наведение: ширина +${(grow * 100).toFixed(1)} % (нужно >3 %), возврат ${(back * 100).toFixed(1)} % (нужно <2 %)`);
    }

    // 4. Выбор: нажатие раскрывает тарифы своей карточки и закрывает чужие.
    await tap(page, page.locator('.pcard').nth(1).locator('.pcard__face'));
    await page.waitForTimeout(900);
    const open = await page.evaluate(() => [...document.querySelectorAll('.pcard')]
      // Признак раскрытой створки — отсутствие inert, а не hidden:
      // hidden выключает отрисовку, и створку с ним нельзя закрыть
      // плавно. inert так же изымает содержимое из обхода и нажатий,
      // но позволяет анимировать высоту.
      .map((c) => !c.querySelector('.pcard__plans').hasAttribute('inert')));
    if (open.filter(Boolean).length === 1 && open[1]) ok('раскрыта ровно одна карточка — та, по которой нажали');
    else no(`раскрыто карточек: ${JSON.stringify(open)}`);

    await tap(page, page.locator('.pcard--active .tariff').first());
    await page.waitForTimeout(700);
    // Панель заказа на телефоне — полоса внизу, на широком экране —
    // чек справа. Берём обе и печатаем то, что нашлось: пустая строка
    // в отчёте о пройденной проверке ничем не лучше упавшей проверки.
    const order = await page.evaluate(() => {
      const t = (sel) => document.querySelector(sel)?.innerText ?? '';
      return `${t('.order__paper')} ${t('.bar')}`.replace(/\s+/g, ' ').trim();
    });
    // Сверяем с ИМЕНЕМ той карточки, по которой нажали, а не
    // с зашитым в проверку словом: каталог меняется, и зашитое имя
    // однажды перестанет встречаться — проверка покраснеет на
    // исправном сайте. Цена может быть и словом «уточняется»:
    // пока прайса нет, требовать ₽ значит требовать выдуманную цену.
    const imya = await page.evaluate(() =>
      document.querySelector('.pcard--active .pcard__name')?.textContent?.trim() ?? '');
    if (imya && order.includes(imya) && /₽|уточняется/.test(order)) {
      ok(`выбор доехал до панели заказа: ${order.slice(0, 90)}`);
    } else {
      no(`панель заказа не приняла выбор «${imya}»: ${JSON.stringify(order.slice(0, 120))}`);
    }

    if (errors.length) no(`ошибок в консоли ${errors.length}: ${errors[0]}`); else ok('ошибок в консоли нет');
    await ctx.close();
  }
}

// ─── Микропарение карточек ─────────────────────────────────────────
//
// Витрина в покое не должна стоять намертво. Дыхание сделано
// свойствами translate и rotate, а не transform: transform занят
// матрицей от камеры, а отдельные свойства складываются с ним поверх
// и ведутся браузером — сцене для этого не нужно ни одного кадра,
// и она по-прежнему засыпает.
//
// Проверяем три вещи: движение ЕСТЬ, оно НЕ БОЛЬШЕ задуманного
// (микропарение, а не качели) и карточки идут НЕ В ФАЗУ.
{
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  await bezSchetchika(ctx);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await wake(page);
  console.log('\n── микропарение карточек ──');

  if (!(await page.evaluate(() => document.querySelector('.shelf3d').hasAttribute('data-3d')))) {
    no('сцена не поднялась — проверять нечего');
  } else {
    // Курсор убираем: наведение двигает карточки само, и его ход
    // на порядок крупнее дыхания.
    await page.mouse.move(4, 4);
    await page.waitForTimeout(1400);
    // Рядов столько, сколько карточек: зашитая тройка падала
    // с TypeError, как только продуктов стало шесть.
    const skolko = await page.evaluate(() => document.querySelectorAll('.pcard').length);
    const series = Array.from({ length: skolko }, () => []);
    for (let i = 0; i < 34; i++) {
      const r = await page.evaluate(() => [...document.querySelectorAll('.pcard')]
        .map((c) => { const b = c.getBoundingClientRect(); return [b.left, b.top]; }));
      r.forEach((v, k) => series[k].push(v));
      await page.waitForTimeout(120);
    }
    const amps = series.map((s) => {
      const xs = s.map((v) => v[0]);
      const ys = s.map((v) => v[1]);
      return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    });
    const lo = Math.min(...amps);
    const hi = Math.max(...amps);
    // Нижняя граница обязательна: без неё «карточки стоят намертво»
    // засчиталось бы за «движение в пределах допуска».
    if (lo >= 1.2 && hi <= 12) ok(`карточки плывут: размах ${amps.map((a) => a.toFixed(1)).join(' / ')} px за 4 с, допуск 1.2–12`);
    else no(`размах парения ${amps.map((a) => a.toFixed(1)).join(' / ')} px, допуск 1.2–12`);

    // Фаза. Берём вертикальную составляющую и считаем корреляцию пар:
    // синхронное покачивание трёх предметов читается механизмом.
    const dev = series.map((s) => { const ys = s.map((v) => v[1]); const m = ys.reduce((a, b) => a + b, 0) / ys.length; return ys.map((y) => y - m); });
    const corr = (a, b) => {
      const sa = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
      const sb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
      if (!sa || !sb) return 1;
      return a.reduce((s, v, i) => s + v * b[i], 0) / (sa * sb);
    };
    const pairs = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => corr(dev[i], dev[j]));
    const worst = Math.max(...pairs.map(Math.abs));
    if (worst <= 0.9) ok(`карточки идут не в фазу: наибольшая связь пары ${worst.toFixed(2)} при пороге 0.9`);
    else no(`карточки качаются синхронно: связь пары ${worst.toFixed(2)} при пороге 0.9`);
  }
  await ctx.close();
}

{
  // При выключенном движении парения быть не должно вовсе.
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU', reducedMotion: 'reduce' });
  await bezSchetchika(ctx);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await wake(page);
  await page.mouse.move(4, 4);
  await page.waitForTimeout(900);
  const moved = await page.evaluate(async () => {
    const card = document.querySelector('.pcard');
    const a = card.getBoundingClientRect();
    await new Promise((r) => setTimeout(r, 1500));
    const b = card.getBoundingClientRect();
    return Math.hypot(b.left - a.left, b.top - a.top);
  });
  if (moved < 0.6) ok(`при выключенном движении карточка стоит: сдвиг ${moved.toFixed(2)} px за 1.5 с`);
  else no(`при выключенном движении карточка едет на ${moved.toFixed(2)} px за 1.5 с`);
  await ctx.close();
}

// ─── Нажатие не должно разбирать сцену ─────────────────────────────
//
// Отдельная проверка, потому что поломка была именно такой и её
// не видно ни по геометрии, ни по контрасту, ни по разрешениям.
// activeIndex стоял в списке зависимостей эффекта, поднимающего сцену,
// и каждое нажатие по карточке разбирало её и собирало заново: на
// мгновение показывалась плоская вёрстка — три одинаковые карточки
// в ряд, — а сцена возвращалась только после следующего движения мыши.
//
// Смотрим не «стало ли в итоге хорошо», а весь промежуток: атрибут
// data-3d слушается наблюдателем, поэтому мигание между пробами
// тоже попадётся.
for (const [w, h, phone] of [[1512, 900, false], [390, 844, true]]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, locale: 'ru-RU', isMobile: phone, hasTouch: phone,
  });
  await bezSchetchika(ctx);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await wake(page);
  console.log(`\n── нажатие по карточке, ${w}×${h} ──`);

  if (!(await page.evaluate(() => document.querySelector('.shelf3d').hasAttribute('data-3d')))) {
    no('сцена не поднялась — проверять нечего');
    await ctx.close();
    continue;
  }

  // Выбираем тариф у текущей карточки: он должен уехать в чек,
  // а после смены продукта — смениться, но не из-за пересборки сцены.
  await tap(page, page.locator('.pcard--active .tariff').first());
  await page.waitForTimeout(800);

  // Наблюдатель за data-3d: ловит и то, что происходит между пробами.
  await page.evaluate(() => {
    window.__d3log = [];
    const root = document.querySelector('.shelf3d');
    new MutationObserver(() => window.__d3log.push(root.hasAttribute('data-3d')))
      .observe(root, { attributes: true, attributeFilter: ['data-3d'] });
  });

  const state = () => page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pcard')];
    const wid = cards.map((c) => Math.round(c.getBoundingClientRect().width));
    return {
      d3: document.querySelector('.shelf3d').hasAttribute('data-3d'),
      open: cards.map((c) => !c.querySelector('.pcard__plans').hasAttribute('inert')),
      active: cards.findIndex((c) => c.classList.contains('pcard--active')),
      // Плоская вёрстка выдаёт себя одинаковой шириной всех трёх
      // карточек: в сцене они на разной глубине и равными быть не могут.
      flat: new Set(wid).size === 1,
      // Сцена ставит преобразование каждой карточке. Раньше здесь
      // искалась подстрока matrix3d — теперь сцена пишет разные записи:
      // повёрнутой карточке perspective()+rotateY(), неповёрнутой
      // (выбранной, и всем на телефоне) обычный двумерный translate+scale.
      // Проверять надо ФАКТ преобразования, а не его запись, иначе
      // проверка держится за способ и падает на первой же правке.
      matrix: cards.every((c) => {
        const t = c.style.transform;
        return t !== '' && t !== 'none';
      }),
      wid,
    };
  });

  // Нажимаем ПЕРВОГО соседа выбранной, а не третью карточку
  // по счёту: в колоде из шести дальние закрыты передними, и клик
  // в середину их коробки достаётся чужой карточке — проверка
  // ловила бы «нажали 3, выбрана 2» на исправной витрине.
  const target = 1;
  await tap(page, page.locator('.pcard').nth(target).locator('.pcard__face'));

  const probes = [];
  for (const at of [100, 1500]) {
    await page.waitForTimeout(at - (probes.at(-1)?.at ?? 0));
    probes.push({ at, ...(await state()) });
  }
  // Мышь после нажатия — в поломанной версии именно она поднимала
  // сцену заново, и без неё блок так и оставался плоским.
  await page.mouse.move(w / 2, h / 2);
  await page.mouse.move(w / 2 + 6, h / 2 + 4);
  await page.waitForTimeout(1200);
  probes.push({ at: 2700, ...(await state()) });

  for (const s of probes) {
    const beda = [];
    if (!s.d3) beda.push('сцены нет (data-3d снят)');
    if (s.flat) beda.push(`плоская вёрстка: ширины ${s.wid.join('/')} одинаковы`);
    if (!s.matrix) beda.push('карточкам не выставлено преобразование от сцены');
    if (s.open.filter(Boolean).length !== 1) beda.push(`раскрыто карточек ${s.open.filter(Boolean).length}`);
    if (s.active !== target) beda.push(`выбрана карточка ${s.active + 1}, а нажимали ${target + 1}`);
    if (beda.length) no(`+${s.at} мс: ${beda.join('; ')}`);
    else ok(`+${s.at} мс: сцена жива, раскрыта одна карточка (${s.active + 1}), ширины ${s.wid.join('/')}`);
  }

  const log = await page.evaluate(() => window.__d3log);
  if (log.length) no(`data-3d менялся ${log.length} раз(а) после нажатия: ${JSON.stringify(log)} — сцену пересобирают`);
  else ok('data-3d за всё время не дрогнул — сцену не пересобирали');

  const order = await page.evaluate(() => {
    const t = (sel) => document.querySelector(sel)?.innerText ?? '';
    return `${t('.order__paper')} ${t('.bar')}`.replace(/\s+/g, ' ').trim();
  });
  if (/Seedance/.test(order) || /Выберите|Пока пусто/.test(order)) ok('панель заказа в согласованном состоянии после смены продукта');
  else no(`панель заказа показывает чужое: ${JSON.stringify(order.slice(0, 120))}`);

  await ctx.close();
}

// ─── Плоская витрина: без WebGL и при выключенном движении ─────────
//
// Сколько карточек должно быть, проверка не знает и знать не может:
// каталог живёт в коде сайта. Берём то число, которое видела сцена
// выше, — если плоский вид потеряет карточку, это вылезет здесь.
for (const [label, opts, init] of [
  ['без WebGL', {}, () => {
    HTMLCanvasElement.prototype.getContext = function () { return null; };
  }],
  ['выключенное движение', { reducedMotion: 'reduce' }, null],
]) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU', ...opts });
  await bezSchetchika(ctx);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await wake(page);
  console.log(`\n── ${label} ──`);

  const g = await geometry(page);
  if (g.d3) no('сцена поднялась там, где её быть не должно');
  else ok('объёма нет — остаётся плоская витрина');
  if (g.cards.length === kartochekVScene) ok(`все ${g.cards.length} карточек на месте`);
  else no(`карточек ${g.cards.length}, а в сцене было ${kartochekVScene}`);

  const chek = () => page.evaluate(() => {
    const t = (sel) => document.querySelector(sel)?.innerText ?? '';
    return `${t('.order__paper')} ${t('.bar')}`.replace(/\s+/g, ' ').trim();
  });
  const nomera = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.pcard')];
    return {
      sUrovnyami: c.findIndex((el) => el.querySelector('.tariff')),
      bezUrovney: c.findIndex((el) => !el.querySelector('.tariff')),
      imena: c.map((el) => el.querySelector('.pcard__name').textContent.trim()),
    };
  });

  // 1. Продукт С УРОВНЯМИ: карточка, потом уровень.
  if (nomera.sUrovnyami < 0) {
    no('в каталоге нет ни одного продукта с уровнями — проба устарела');
  } else {
    await tap(page, page.locator('.pcard').nth(nomera.sUrovnyami).locator('.pcard__face'));
    await page.waitForTimeout(500);
    await tap(page, page.locator('.pcard--active .tariff').first());
    await page.waitForTimeout(500);
    const order = await chek();
    const imya = nomera.imena[nomera.sUrovnyami];
    if (order.includes(imya)) ok(`уровень выбирается и без сцены: ${order.slice(0, 90)}`);
    else no(`выбор уровня не работает («${imya}»): ${JSON.stringify(order.slice(0, 120))}`);
  }

  // ПРОБЫ «ПРОДУКТ БЕЗ УРОВНЕЙ» ЗДЕСЬ БОЛЬШЕ НЕТ, и это не потеря.
  // Она искала такой продукт в прайсе владельца, а прайс принадлежит
  // ему: он снял последний продукт без уровней, и проба покраснела
  // на исправном сайте. Обе ветки покупки проверяются ниже, на СВОЁМ
  // каталоге, — там они не зависят от того, что сегодня в лавке.
  await ctx.close();
}

// ─── Обе ветки покупки на СВОЁМ каталоге ──────────────────────────
//
// Ветка «продукт без уровней покупается самой карточкой» жива в коде
// и должна проверяться всегда, а не только в те месяцы, когда такой
// продукт есть в прайсе. Поэтому проба заводит его сама — тем же
// приёмом, каким стенд бота заводит `zavestiProduktBezUrovney`.
//
// WebGL выключен намеренно: ветка живёт в разметке и в чеке, сцена
// к ней отношения не имеет, а без неё проба короче и устойчивее.
{
  console.log('\n── обе ветки покупки на своём каталоге ──');
  const KATALOG = [proba(1, []), proba(2, ['Standard', 'Pro'])];
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  await bezSchetchika(ctx);
  await ctx.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = function () { return null; };
  });
  const schet = await podstavitKatalog(ctx, KATALOG);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const doehalo = await zhdatKartochki(page, KATALOG.length);

  if (schet.podmen !== 1) {
    no(`свой каталог подставить не удалось (подмен ${schet.podmen}) — проба ничего не проверила`);
  } else if (!doehalo) {
    no('страница не перерисовалась своим каталогом — проба ничего не проверила');
  } else {
    const chek = () => page.evaluate(() => {
      const t = (sel) => document.querySelector(sel)?.innerText ?? '';
      return `${t('.order__paper')} ${t('.bar')}`.replace(/\s+/g, ' ').trim();
    });
    const nomera = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.pcard')];
      return {
        bez: c.findIndex((el) => !el.querySelector('.tariff')),
        s: c.findIndex((el) => el.querySelector('.tariff')),
        imena: c.map((el) => el.querySelector('.pcard__name').textContent.trim()),
      };
    });
    if (nomera.bez < 0 || nomera.s < 0) {
      no(`подставленный каталог доехал не целиком: ${JSON.stringify(nomera.imena)}`);
    } else {
      // 1. БЕЗ уровней — покупается самой карточкой.
      await tap(page, page.locator('.pcard').nth(nomera.bez).locator('.pcard__face'));
      await page.waitForTimeout(600);
      const order1 = await chek();
      const vnutri = await page.evaluate(() =>
        document.querySelectorAll('.pcard--active .tariff').length);
      if (order1.includes(nomera.imena[nomera.bez]) && vnutri === 0) {
        ok(`продукт без уровней покупается самой карточкой: «${nomera.imena[nomera.bez]}» в чеке, кнопок уровня 0`);
      } else {
        no(`продукт без уровней не попал в чек («${nomera.imena[nomera.bez]}», кнопок уровня ${vnutri}): ${JSON.stringify(order1.slice(0, 120))}`);
      }
      // 2. С уровнями — карточка, потом уровень.
      await tap(page, page.locator('.pcard').nth(nomera.s).locator('.pcard__face'));
      await page.waitForTimeout(500);
      await tap(page, page.locator('.pcard--active .tariff').first());
      await page.waitForTimeout(500);
      const order2 = await chek();
      if (order2.includes(nomera.imena[nomera.s])) {
        ok(`продукт с уровнями покупается уровнем: ${order2.slice(0, 80)}`);
      } else {
        no(`выбор уровня не работает («${nomera.imena[nomera.s]}»): ${JSON.stringify(order2.slice(0, 120))}`);
      }
    }
  }
  await ctx.close();
}

// ─── Дуга при ЛЮБОМ числе продуктов ───────────────────────────────
//
// Раскладка дуги ломалась ДВАЖДЫ, и оба раза поломку приносила
// не правка кода, а выкладка прайса из панели: при пяти продуктах
// карточка уезжала в чужой ряд, при шести её закрывала соседка
// на 96 %. Проверять это на том числе, которое сегодня в каталоге,
// — значит узнавать о поломке от владельца.
//
// Здесь проба перебирает числа сама. Мерятся три вещи:
//   1. ни одна карточка не закрыта передними так, что её не найти;
//   2. ни одна не вылезает за блок — там панель заказа;
//   3. НИ ОДНА ПАРА НЕ СТОИТ В ОДНОЙ ТОЧКЕ. Это отдельная проба,
//      и без неё первая СЛЕПА ровно на той поломке, ради которой
//      всё и чинилось: перекрытие считается только теми, у кого
//      z-index больше, а у двух карточек в одной точке он равен —
//      значит ни одна не «передняя», и перекрытие выходит нулевым
//      там, где оно стопроцентное.
//
//      Совпадение z-index само по себе поломкой НЕ является: дуга
//      симметрична, и левый ряд с правым стоят на одной глубине
//      по построению. Поломка — совпадение КОРОБКИ.
//   4. РАЗНЫХ ГЛУБИН СТОЛЬКО ЖЕ, СКОЛЬКО РЯДОВ. Сцена пишет
//      `z-index = 1000 + z`, и два РАЗНЫХ ряда с одной глубиной —
//      это сломанный порядок наложения: кто из них нарисуется
//      поверх, решает порядок в разметке, а не дуга. Видно это
//      только глазами, и только если дальняя карточка окажется
//      поверх ближней; ни перекрытие, ни совпадение коробок
//      такого не ловят — коробки-то разные.
//      Рядов при n карточках ровно `floor(n / 2) + 1`: середина
//      плюс по одному ряду на каждое расстояние по кольцу.
{
  console.log('\n── дуга при 3…8 продуктах ──');
  for (let n = 3; n <= 8; n++) {
    const KATALOG = Array.from({ length: n }, (_, i) => proba(i + 1, ['A', 'B']));
    const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
    await bezSchetchika(ctx);
    const schet = await podstavitKatalog(ctx, KATALOG);
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    const doehalo = await zhdatKartochki(page, n);
    // Сцену будим уже ПОСЛЕ перерисовки: на разметке, которую сейчас
    // снесут, подниматься ей незачем.
    let est3d = false;
    for (let t = 0; t < 4 && !est3d; t++) {
      await page.mouse.move(60 + t, 200 + t);
      await page.mouse.move(64 + t, 204 + t);
      await page.evaluate(() => document.querySelector('.shop')?.scrollIntoView({ block: 'center' }));
      est3d = await page
        .waitForFunction(() => document.querySelector('.shelf3d')?.hasAttribute('data-3d'),
                         null, { timeout: 6000 })
        .then(() => true).catch(() => false);
    }
    await page.waitForTimeout(900);

    if (schet.podmen !== 1 || !doehalo) {
      no(`n=${n}: свой каталог не доехал (подмен ${schet.podmen}, карточек столько же: ${doehalo})`);
    } else if (!est3d) {
      no(`n=${n}: сцена не поднялась — мерить нечего`);
    } else {
      const g = await geometry(page);
      const cov = g.cards.map((a) => {
        let m = 0;
        g.cards.forEach((b) => {
          if (a === b || b.z <= a.z) return;
          const dx = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const dy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          m = Math.max(m, (dx * dy) / (a.w * a.h));
        });
        return m;
      });
      const hud = Math.max(...cov);
      const vylet = Math.min(...g.cards.map((c) => Math.min(c.left - g.box.left, g.box.right - c.right)));
      // Одно место на двоих: коробки совпадают с точностью до парения
      // (карточки микропарят на два-три пикселя, и точного совпадения
      // не бывает даже у наложенных друг на друга).
      let paraVTochke = '';
      for (let a = 0; a < g.cards.length && !paraVTochke; a++) {
        for (let b = a + 1; b < g.cards.length; b++) {
          const x = g.cards[a], y = g.cards[b];
          const ryadom = Math.abs(x.left - y.left) < 6 && Math.abs(x.top - y.top) < 6
            && Math.abs(x.w - y.w) < 6 && Math.abs(x.h - y.h) < 6;
          if (ryadom) { paraVTochke = `${a + 1} и ${b + 1}`; break; }
        }
      }
      const bedy = [];
      if (g.cards.length !== n) bedy.push(`карточек ${g.cards.length}`);
      if (hud > PREDEL_ZAKRYTIYA) bedy.push(`карточка ${cov.indexOf(hud) + 1} закрыта на ${(hud * 100).toFixed(0)} %`);
      if (vylet < -2) bedy.push(`вылет за блок ${vylet.toFixed(0)} px`);
      if (paraVTochke) bedy.push(`карточки ${paraVTochke} стоят в одной точке`);
      const glubin = new Set(g.cards.map((c) => c.z)).size;
      const ryadov = Math.floor(n / 2) + 1;
      if (glubin !== ryadov) {
        bedy.push(`разных глубин ${glubin}, а рядов ${ryadov} — порядок наложения решает разметка, а не дуга`);
      }
      const chisla = `наибольшее закрытие ${(hud * 100).toFixed(0)} %, запас до кромки блока ${vylet.toFixed(0)} px`;
      if (bedy.length) no(`n=${n}: ${bedy.join('; ')} (${chisla})`);
      else ok(`n=${n}: ${chisla}, рядов ${Math.floor(n / 2) + 1} и столько же глубин`);
    }
    await ctx.close();
  }
}

await browser.close();
console.log(bad ? `\nВИТРИНА РАБОТАЕТ НЕ ТАК (${bad})` : '\nВитрина в порядке: геометрия, текст, выбор и запасной плоский вид');
process.exit(bad ? 1 : 0);
