/**
 * Промокод в чеке на сайте.
 *
 * Что проверяется и почему именно это.
 *
 * Сайт статический и базы не видит: годность кода он спрашивает
 * у бота по `/api/promo`. Значит его собственная работа — ровно
 * четыре вещи, и все четыре ломаются молча:
 *
 *   1. показать «исходная цена — скидка — итог», когда код подошёл;
 *   2. объяснить СЛОВАМИ, почему не подошёл, — и по-разному для
 *      «нет такого», «истёк» и «кончились активации»;
 *   3. НЕ соврать, когда спросить было некого: молчание бота — это
 *      не «кода нет»;
 *   4. довезти код до бота параметром `start` рядом с меткой канала.
 *
 * ОТВЕТЫ БОТА ПОДСТАВЛЯЮТСЯ, а не ждутся от живого сервера, и это
 * не упрощение. Проверка про САЙТ: его дело — нарисовать то, что
 * ответили. Гоняй мы живой бот, проба мерила бы заодно его базу
 * и сеть, а на выдаче без бота (а она такая всегда) не запускалась
 * бы вовсе. Правильность самого ответа держат проверки бота —
 * `bot/test/promokody.test.ts`, 19 проб.
 *
 * Запуск: node scripts/check-promo.mjs <url>
 */
import { chromium } from 'playwright';

const ADRES = process.argv[2];
if (!ADRES) {
  console.log('ПЛОХО: не задан адрес. node scripts/check-promo.mjs <url>');
  process.exit(1);
}
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let bad = 0;
const ok = (s) => console.log(`  ✓ ${s}`);
const no = (s) => {
  console.log(`  ✗ ${s}`);
  bad++;
};

/** Ответы бота, которые подставляются вместо живого /api/promo. */
const OTVETY = {
  godit: { godit: true, kod: 'LETO25', skidkaProc: 10 },
  net: { godit: false, pochemu: 'net', soobshchenie: 'Такого промокода нет. Проверьте, не потерялась ли буква.' },
  istyok: { godit: false, pochemu: 'istyok', soobshchenie: 'Срок действия промокода истёк.' },
  konchilis: {
    godit: false,
    pochemu: 'konchilis',
    soobshchenie: 'Активации промокода кончились — его уже разобрали.',
  },
};

const browser = await chromium.launch({ executablePath: CHROME });

/** Число из строки вида «1 399 ₽» или «−139,90 ₽». */
const chislo = (s) => Number(String(s).replace(/[^\d,.-]/g, '').replace(',', '.'));

for (const [w, theme, imya] of [
  [1512, 'light', 'десктоп, светлая'],
  [1512, 'dark', 'десктоп, тёмная'],
  [390, 'light', 'телефон, светлая'],
]) {
  console.log(`\n── ${imya} ──`);
  const telefon = w < 500;
  const ctx = await browser.newContext({
    viewport: { width: w, height: 900 },
    locale: 'ru-RU',
    isMobile: telefon,
    hasTouch: telefon,
  });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);

  /* Ответ подставляется ПЕРЕМЕННОЙ, а не новым маршрутом на каждую
     пробу: перерегистрация маршрута посреди страницы оставляет
     в полёте запрос, отвеченный прежним правилом. */
  let otvet = OTVETY.godit;
  await ctx.route('**/api/promo*', async (route) => {
    if (otvet === 'molchanie') return route.abort('failed');
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(otvet),
    });
  });

  const page = await ctx.newPage();
  // Метка в адресе — чтобы заодно проверить, что промокод её
  // не вытеснил и не подменил.
  await page.goto(`${ADRES}?m=vk-posty`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // Собираем заказ: уровень и способ оплаты.
  await page.locator('.pcard--active .tariff').first().click({ force: true });
  await page.waitForTimeout(700);
  const chip = telefon ? '.bar__pay' : '.pays__item';
  await page.locator(chip).first().click({ force: true });
  await page.waitForTimeout(400);

  const pole = telefon ? '.promo--bar' : '.order .promo';
  const cenaDo = telefon
    ? chislo(await page.locator('.bar__summa').first().innerText())
    : chislo(await page.locator('.order__item-price').first().innerText());

  if (!(cenaDo > 0)) {
    no(`не удалось прочитать цену выбранного (${cenaDo}) — дальше мерить нечего`);
    await ctx.close();
    continue;
  }
  ok(`выбран уровень за ${cenaDo} ₽`);

  // Поле промокода свёрнуто, пока его не тронули.
  const zvat = page.locator(`${pole} .promo__zvat`);
  if ((await zvat.count()) !== 1) no('приглашения ввести промокод нет');
  else ok('поле свёрнуто в приглашение, пока код не введён');
  await zvat.click({ force: true });
  await page.waitForTimeout(200);

  /* Раскрыть поле, ЕСЛИ оно свёрнуто. Click по несуществующему
     локатору ждёт тридцать секунд и только потом отказывает —
     четыре таких ожидания на раскладку превращали проверку
     в шестиминутную. `count()` отвечает сразу. */
  const raskryt = async () => {
    if ((await page.locator(`${pole} .promo__zvat`).count()) > 0) {
      await page.locator(`${pole} .promo__zvat`).click({ force: true });
      await page.waitForTimeout(150);
    }
  };

  const vvesti = async (kod) => {
    await page.locator(`${pole} .promo__vvod`).fill(kod);
    await page.locator(`${pole} .promo__knopka`).click({ force: true });
        // Счётчик добегает 0,55 с — читать раньше значит читать
    // кадр разбега, а не итог.
    await page.waitForTimeout(900);
  };

  // ── 1. код подошёл ────────────────────────────────────────────────
  otvet = OTVETY.godit;
  await vvesti('leto25');

  const kodNaEkrane = await page.locator(`${pole} .promo__kod`).first().innerText().catch(() => '');
  if (kodNaEkrane.trim() !== 'LETO25') no(`применённый код показан как «${kodNaEkrane}»`);
  else ok('применённый код виден в чеке прописными');

  if (telefon) {
    const itogo = chislo(await page.locator('.bar__summa').first().innerText());
    const bylo = chislo(await page.locator('.bar__bylo').first().innerText().catch(() => '0'));
    const zhdem = Math.round(cenaDo * 0.9 * 100) / 100;
    if (Math.abs(itogo - zhdem) > 0.01) no(`итог ${itogo} вместо ${zhdem}`);
    else ok(`итог со скидкой ${itogo} ₽`);
    if (Math.abs(bylo - cenaDo) > 0.01) no(`исходная цена ${bylo} вместо ${cenaDo}`);
    else ok(`исходная цена зачёркнута рядом: ${bylo} ₽`);
  } else {
    const stroka = page.locator('.order__item-row--skidka');
    if ((await stroka.count()) !== 1) no('строки скидки в чеке нет');
    else {
      const skidka = Math.abs(chislo(await stroka.locator('.order__item-price').innerText()));
      const zhdem = Math.round(cenaDo * 10) / 100;
      if (Math.abs(skidka - zhdem) > 0.01) no(`скидка ${skidka} вместо ${zhdem}`);
      else ok(`строка скидки: −${skidka} ₽ от ${cenaDo} ₽`);
    }
    const itogo = chislo(await page.locator('.order__total-value').first().innerText());
    const zhdem = Math.round(cenaDo * 0.9 * 100) / 100;
    if (Math.abs(itogo - zhdem) > 0.01) no(`итог ${itogo} вместо ${zhdem}`);
    else ok(`итого со скидкой ${itogo} ₽`);
    // Цена товара в чеке ОСТАЛАСЬ исходной: строка «было» и есть
    // то, ради чего скидка показывается отдельно.
    const cenaPosle = chislo(await page.locator('.order__item-price').first().innerText());
    if (Math.abs(cenaPosle - cenaDo) > 0.01) no(`цена товара подменилась итогом: ${cenaPosle}`);
    else ok('цена товара в чеке осталась исходной');
  }

  // ── 2. код едет в бот рядом с меткой ──────────────────────────────
  const href = await page.locator(telefon ? '.bar__cta' : '.order__cta').first().getAttribute('href');
  if (!href) no('кнопка в бот не стала ссылкой');
  else {
    const start = new URL(href).searchParams.get('start') ?? '';
    if (!start.includes('promo_LETO25')) no(`в start нет промокода: «${start}»`);
    else ok(`промокод едет в бот: start=${start}`);
    if (!start.includes('metka_vk-posty')) no(`промокод вытеснил метку канала: «${start}»`);
    else ok('метка канала на месте рядом с ним');
    if (start.length > 64) no(`payload длиннее 64 знаков: ${start.length}`);
  }

  // ── 3. код снимается ──────────────────────────────────────────────
  await page.locator(`${pole} .promo__ubrat`).click({ force: true });
  // Счётчик добегает 0,55 с: прочитанный раньше итог — это кадр
  // разбега, и 1 398 вместо 1 399 читается поломкой, которой нет.
  await page.waitForTimeout(900);
  const posleSnyatiya = telefon
    ? chislo(await page.locator('.bar__summa').first().innerText())
    : chislo(await page.locator('.order__total-value').first().innerText());
  if (Math.abs(posleSnyatiya - cenaDo) > 0.01) no(`после снятия кода итог ${posleSnyatiya} вместо ${cenaDo}`);
  else ok('снятый код возвращает полную цену');
  const startBez = await page
    .locator(telefon ? '.bar__cta' : '.order__cta')
    .first()
    .getAttribute('href');
  if (startBez && startBez.includes('promo_')) no('снятый код всё равно уехал в ссылку');
  else ok('снятый код из ссылки исчез');

  // ── 4. отказы объясняются, и по-разному ───────────────────────────
  const otvety = [];
  for (const [vid, ozhidaem] of [
    ['net', 'нет'],
    ['istyok', 'истёк'],
    ['konchilis', 'кончились'],
  ]) {
    otvet = OTVETY[vid];
    await raskryt();
    await vvesti(`PROBA-${vid}`);
    const text = (await page.locator(`${pole} .promo__otvet`).first().innerText().catch(() => '')).trim();
    otvety.push(text);
    if (!text) no(`на отказ «${vid}» сайт не сказал ничего`);
    else if (!text.toLowerCase().includes(ozhidaem)) no(`на «${vid}» сайт ответил «${text}»`);
    else ok(`«${vid}» → «${text}»`);
    // Скидки при отказе быть не должно ни на копейку.
    if ((await page.locator('.order__item-row--skidka').count()) > 0) {
      no(`на отказе «${vid}» в чеке осталась строка скидки`);
    }
  }
  /* Три РАЗНЫХ ответа, а не три одинаковых. Проба на это отдельная:
     объединить причины в одну фразу «код не подошёл» легко и
     незаметно, а человеку тогда нечего делать с ответом. */
  if (new Set(otvety.filter(Boolean)).size !== 3) {
    no(`три причины отказа дали ${new Set(otvety).size} разных ответа`);
  } else {
    ok('три причины отказа объясняются тремя разными фразами');
  }

  // ── 5. молчание бота — это НЕ «кода нет» ──────────────────────────
  otvet = 'molchanie';
  await raskryt();
  await vvesti('MOLCHOK');
  const tihiy = (await page.locator(`${pole} .promo__otvet`).first().innerText().catch(() => '')).trim();
  if (/нет|не существу/i.test(tihiy)) no(`на молчание бота сайт соврал: «${tihiy}»`);
  else if (!tihiy) no('на молчание бота сайт не сказал ничего');
  else ok(`молчание бота названо своим именем: «${tihiy}»`);
  // И код при этом ВСЁ РАВНО едет в бот: настоящее решение за ним.
  const hrefTihiy = await page
    .locator(telefon ? '.bar__cta' : '.order__cta')
    .first()
    .getAttribute('href');
  if (!hrefTihiy || !hrefTihiy.includes('promo_MOLCHOK')) {
    no('непроверенный код не уехал в бот — а решать должен он');
  } else {
    ok('непроверенный код всё равно уехал в бот');
  }

  await ctx.close();
}

await browser.close();
console.log(bad ? `\nПЛОХО: ${bad} замечаний` : '\nПромокод в чеке работает во всех трёх сочетаниях');
process.exit(bad ? 1 : 0);
