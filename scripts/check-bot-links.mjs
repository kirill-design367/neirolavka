/**
 * Ссылки в бот и честность текстов про оплату.
 *
 * Три вопроса, и все три ломаются молча.
 *
 *  1. КНОПКИ ВЕДУТ В БОТ. Пока `botUrl` был пуст, на месте кнопок
 *     стояли надписи-заглушки. Заглушка, оставшаяся после запуска, —
 *     это не «мелочь в тексте», а человек, который не может купить.
 *     Проверяется и панель заказа на широком экране, и нижняя полоса
 *     на телефоне, в обеих темах.
 *
 *  2. ССЫЛКА ПРИГОДНА ДЛЯ TELEGRAM. Если в ней есть параметр `start`,
 *     он обязан укладываться в то, что Telegram вообще передаёт боту:
 *     латиница, цифры, дефис и подчёркивание, не длиннее 64 знаков.
 *     Всё остальное молча теряется.
 *
 *  3. ТЕКСТЫ НЕ ОБЕЩАЮТ ТОГО, ЧЕГО НЕТ. Оплата в боте не подключена:
 *     заказ записывается, а как заплатить — говорит администратор.
 *     Список запрещённых оборотов ниже — это ровно те формулировки,
 *     которые на сайте стояли и обещали лишнее.
 *
 * Живой ответ t.me проверяется, только если сеть до него есть:
 * из контейнера разработки шлюз её не пускает. На бегунке GitHub
 * пускает, и там проба настоящая.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://127.0.0.1:4173/';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BOT = 'https://t.me/neirolavka_ai_bot';

let bad = 0;
const ok = (t) => console.log(`  ok   ${t}`);
const no = (t) => { bad++; console.log(`  НЕТ  ${t}`); };
const info = (t) => console.log(`  —    ${t}`);

/** Обороты, которые обещают то, чего в боте нет, или остались от заглушки. */
const ZAPRET = [
  ['Бот скоро откроется', 'заглушка кнопки'],
  ['готовится к запуску', 'бот уже запущен'],
  // Реферальный блок снят владельцем целиком. Ловим не заглушку,
  // а сам блок: его заголовок и подписи трёх колонок.
  ['Приводите своих', 'реферальный блок снят владельцем'],
  ['Кому ссылка', 'колонка снятого реферального блока'],
  ['Когда начисляется', 'колонка снятого реферального блока'],
  ['Реферальные ссылки', 'реферальный блок снят владельцем'],
  ['оплата картой, через СБП или USDT', 'обещает оплату в боте'],
  ['Платите в боте', 'оплаты в боте нет'],
  ['с уже собранным заказом', 'заказ в бот не передаётся'],
  ['Оплата, выдача доступа и поддержка — в Telegram-боте', 'оплаты в боте нет'],
];

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
  });
  await ctx.addInitScript((t) => localStorage.setItem('neirolavka-theme', t), theme);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // Собираем заказ: тариф и способ оплаты.
  await page.locator('.pcard--active .tariff').first().click({ force: true });
  await page.waitForTimeout(700);
  await page.locator(w < 500 ? '.bar__pay' : '.pays__item').first().click({ force: true });
  await page.waitForTimeout(500);

  const knopki = await page.evaluate(() => {
    const sob = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return {
        tag: el.tagName,
        href: el.getAttribute('href') ?? '',
        target: el.getAttribute('target') ?? '',
        rel: el.getAttribute('rel') ?? '',
        text: el.textContent.trim(),
        disabled: el.hasAttribute('disabled'),
        vidna: el.getBoundingClientRect().width > 0,
      };
    };
    return { chek: sob('.order__cta'), polosa: sob('.bar__cta') };
  });

  const nuzhna = w < 500 ? 'polosa' : 'chek';
  const k = knopki[nuzhna];
  /* КНОПКА ЗАКАЗА — ЭТО ОПЛАТА, А НЕ ССЫЛКА В БОТ.
     Так было не всегда: до появления оплаты на сайте здесь стоял
     `<a href="t.me/…">`, и проверка требовала именно ссылку. Теперь
     адрес оплаты известен только ПОСЛЕ ответа бота, поэтому ссылкой
     кнопка быть не может по построению. */
  if (!k) { no(`кнопки ${nuzhna === 'chek' ? 'чека' : 'нижней полосы'} нет на странице`); }
  else if (k.tag !== 'BUTTON') no(`кнопка оплаты стала <${k.tag.toLowerCase()}>: «${k.text}»`);
  else if (k.disabled) no(`кнопка оплаты не нажимается при собранном заказе: «${k.text}»`);
  else if (!/оплатить/i.test(k.text)) no(`кнопка не зовёт платить: «${k.text}»`);
  else ok(`кнопка заказа зовёт платить: «${k.text}»`);

  // Заглушки и лишние обещания.
  const text = await page.evaluate(() => document.body.innerText);
  const nayden = ZAPRET.filter(([f]) => text.toLowerCase().includes(f.toLowerCase()));
  if (nayden.length) {
    for (const [f, pochemu] of nayden) no(`на странице осталось «${f}» — ${pochemu}`);
  } else {
    ok(`запрещённых оборотов нет (проверено ${ZAPRET.length})`);
  }

  await ctx.close();
}

// Живой ответ Telegram — только там, где сеть до него есть.
//
// Пропуск включается ЯВНО переменной, а не догадкой по коду ответа:
// шлюз контейнера разработки отвечает на CONNECT кодом 403, и «403 —
// значит сети нет» засчитывало бы настоящий отказ Telegram за
// отсутствие сети. На бегунке GitHub переменная стоит, и проба там
// настоящая.
console.log('\n── адрес бота отвечает ──');
if (process.env.SET_DO_TELEGRAM !== '1') {
  info('SET_DO_TELEGRAM не выставлена — живой ответ t.me не проверяется (из контейнера разработки шлюз туда не пускает)');
} else {
  try {
    const r = await fetch(BOT, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (r.ok) ok(`${BOT} отвечает ${r.status}`);
    else no(`${BOT} отвечает ${r.status}`);
  } catch (e) {
    no(`${BOT} не ответил: ${String(e).slice(0, 80)}`);
  }
}

/* ── ЧТО САЙТ ОТПРАВЛЯЕТ, КОГДА ЧЕЛОВЕК ЖМЁТ «ОПЛАТИТЬ» ───────────
 *
 * Самое хрупкое звено всей затеи, и оно переехало. Раньше выбор
 * и метка канала ехали в АДРЕСЕ ссылки на бота, и проверить их можно
 * было, прочитав `href`. Теперь сайт шлёт их запросом на `/api/zakaz`,
 * а в ответ получает адрес Робокассы — то есть читать надо ТЕЛО
 * ЗАПРОСА, а не разметку.
 *
 * Порвётся здесь — и человек либо не уйдёт на оплату вовсе, либо
 * уйдёт без промокода (это его деньги) или без метки (это строка
 * в статистике, которую хватятся через месяц).
 *
 * Запрос ПЕРЕХВАТЫВАЕТСЯ: на статической выдаче бота нет, а гонять
 * проверку по живому серверу значило бы заводить настоящие заказы.
 * Подставной ответ отдаёт адрес на этой же выдаче, поэтому переход
 * происходит по-настоящему и его видно.
 */
{
  console.log('\n── нажатие «Оплатить» ──');
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  const page = await ctx.newPage();

  const kuda = `${URL.replace(/\/$/, '')}/?oplata-proba=1`;
  let telo = null;
  await page.route('**/api/zakaz', async (route) => {
    telo = route.request().postData() ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ vyshlo: true, nomer: 77, adres: kuda, vBot: `${BOT}?start=zakaz_abc` }),
    });
  });
  // Промокод на статической выдаче спросить не у кого — отвечаем сами.
  await page.route('**/api/promo*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ godit: true, kod: 'LETO25', skidkaProc: 10 }),
    }),
  );

  for (const [adres, zhdemMetku, chto] of [
    ['?m=vk-posty', 'vk-posty', 'своя короткая метка ?m='],
    ['?utm_source=VK%20Posty', 'vk-posty', 'чужая ссылка с utm_source'],
    ['?utm_source=%D0%92%D0%9A', '', 'utm_source из одной кириллицы'],
    ['', '', 'адрес без метки'],
  ]) {
    telo = null;
    await page.goto(`${URL}${adres}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.locator('.pcard--active .tariff').first().click({ force: true });
    await page.waitForTimeout(600);
    await page.locator('.pays__item').first().click({ force: true });
    await page.waitForTimeout(400);
    await page.locator('.order__cta').click({ force: true });
    await page.waitForTimeout(900);

    if (telo === null) { no(`${chto}: нажатие не отправило запрос на /api/zakaz вовсе`); continue; }
    const p = new URLSearchParams(telo);
    const metka = p.get('metka') ?? '';
    const tovar = p.get('tovar') ?? '';
    const popytka = p.get('popytka') ?? '';
    if (!tovar) no(`${chto}: в запросе нет товара`);
    if (!popytka) no(`${chto}: нет ключа нажатия — двойное нажатие заведёт два заказа`);
    if (metka !== zhdemMetku) no(`${chto}: метка «${metka || 'ничего'}», а ждали «${zhdemMetku || 'ничего'}»`);
    else ok(`${chto}: ${zhdemMetku ? `метка доехала — ${metka}` : 'метки нет, и в запросе её тоже нет'}`);
    if (metka && !/^[a-z0-9-]{1,24}$/.test(metka)) no(`метка не переживёт Telegram: «${metka}»`);
    // И браузер обязан уйти туда, куда сказал бот.
    if (!page.url().includes('oplata-proba=1')) no(`${chto}: после ответа браузер не ушёл на оплату (${page.url()})`);
    else ok(`${chto}: браузер ушёл на адрес оплаты`);
  }

  /* ПРОМОКОД ЕДЕТ ТЕМ ЖЕ ЗАПРОСОМ. Это деньги человека: он видел
     скидку в чеке и обязан заплатить со скидкой, а не по прайсу. */
  telo = null;
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.locator('.pcard--active .tariff').first().click({ force: true });
  await page.waitForTimeout(600);
  await page.locator('.pays__item').first().click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('.order__paper .promo__zvat').click({ force: true });
  await page.waitForTimeout(300);
  await page.locator('.order__paper .promo__vvod').fill('LETO25');
  await page.locator('.order__paper .promo__knopka').click({ force: true });
  await page.waitForTimeout(700);
  await page.locator('.order__cta').click({ force: true });
  await page.waitForTimeout(900);
  if (telo === null) no('промокод: нажатие «Оплатить» не отправило запрос');
  else {
    const kod = new URLSearchParams(telo).get('promo') ?? '';
    if (kod !== 'LETO25') no(`промокод не уехал в заказ: «${kod || 'ничего'}»`);
    else ok('промокод уехал в заказ вместе с выбором');
  }

  await ctx.close();
}

await browser.close();
console.log(bad ? '\nССЫЛКИ В БОТ РАБОТАЮТ НЕ ТАК' : '\nКнопки ведут в бот, метка доезжает, заглушек и лишних обещаний нет');
process.exit(bad ? 1 : 0);
