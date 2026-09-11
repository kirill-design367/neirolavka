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
  if (!k) { no(`кнопки ${nuzhna === 'chek' ? 'чека' : 'нижней полосы'} нет на странице`); }
  else if (k.tag !== 'A') no(`кнопка заказа осталась заглушкой: <${k.tag.toLowerCase()}> «${k.text}»`);
  else if (!k.href.startsWith(BOT)) no(`кнопка заказа ведёт не в бот: ${k.href}`);
  else if (k.target !== '_blank' || !k.rel.includes('noopener')) no(`ссылка в бот без target=_blank / rel=noopener: ${k.target} / ${k.rel}`);
  else ok(`кнопка заказа — ссылка в бот: «${k.text}» → ${k.href}`);

  // Параметр start, если он есть, обязан быть пригоден для Telegram.
  if (k && k.href.includes('?start=')) {
    const start = k.href.split('?start=')[1];
    const godno = /^[A-Za-z0-9_-]{1,64}$/.test(start);
    if (!godno) no(`параметр start не пройдёт через Telegram: «${start}» (нужна латиница, цифры, дефис и подчёркивание, до 64 знаков)`);
    else ok(`параметр start пригоден: «${start}», ${start.length} знаков`);
  } else {
    info('параметр start в ссылке не передаётся — заказ за флагом botStartPayload, метки в адресе нет');
  }

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

/* ── Метка рекламного канала доезжает с сайта до ссылки в бот ──────
 *
 * Проверяется САМОЕ ХРУПКОЕ звено всей затеи: сайт статический,
 * метку он берёт из адреса страницы в эффекте, а дальше она обязана
 * оказаться в параметре `start`. Порвётся здесь — статистика каналов
 * просто будет пустой, и заметить это можно будет только через месяц
 * по строке «без метки» на все сто процентов.
 *
 * Заодно это проверка того, что метка едет НЕ за флагом
 * `botStartPayload`: заказ по-прежнему за ним, а метка нет.
 */
{
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, locale: 'ru-RU' });
  const page = await ctx.newPage();

  for (const [adres, zhdem, chto] of [
    ['?m=vk-posty', 'metka_vk-posty', 'своя короткая метка ?m='],
    ['?utm_source=VK%20Posty', 'metka_vk-posty', 'чужая ссылка с utm_source'],
    ['?utm_source=%D0%92%D0%9A', '', 'utm_source из одной кириллицы'],
    ['', '', 'адрес без метки'],
  ]) {
    await page.goto(`${URL}${adres}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    /* Кнопка чека становится ССЫЛКОЙ только когда собран заказ:
       до этого там `<button>` со словами «выберите тариф», и href
       у него нет по построению. Проба без этих двух нажатий мерила бы
       не метку, а незаполненный чек — и молчала бы при любой поломке. */
    await page.locator('.pcard--active .tariff').first().click({ force: true });
    await page.waitForTimeout(600);
    await page.locator('.pays__item').first().click({ force: true });
    await page.waitForTimeout(400);
    const href = await page.evaluate(() => document.querySelector('.order__cta')?.getAttribute('href') ?? '');
    const start = href.includes('?start=') ? href.split('?start=')[1] : '';
    if (start !== zhdem) {
      no(`${chto}: в ссылке «${start || 'ничего'}», а ждали «${zhdem || 'ничего'}»`);
    } else if (zhdem) {
      ok(`${chto}: метка доехала — ?start=${start}`);
    } else {
      ok(`${chto}: метки нет, и в ссылке её тоже нет`);
    }
    if (start && !/^[A-Za-z0-9_-]{1,64}$/.test(start)) {
      no(`метка не пройдёт через Telegram: «${start}»`);
    }
  }
  await ctx.close();
}

await browser.close();
console.log(bad ? '\nССЫЛКИ В БОТ РАБОТАЮТ НЕ ТАК' : '\nКнопки ведут в бот, метка доезжает, заглушек и лишних обещаний нет');
process.exit(bad ? 1 : 0);
