/**
 * ОПЛАТА С САЙТА: уходит ли браузер на Робокассу и видно ли оплату.
 *
 * Проверка написана по двум багам владельца, и оба выглядели как
 * «кнопка не работает», а были разными:
 *
 *   1. С ПРОМОКОДОМ ОПЛАТА НЕ ЗАПУСКАЛАСЬ. На самом деле не
 *      запускалась она на ПОВТОРНОМ нажатии по заказу, который уже
 *      оплачен или отменён: ключ нажатия живёт, пока не поменялся
 *      выбор, а страница переживает уход на Робокассу и возврат
 *      «Назад». Бот отвечал «Оплата сейчас не работает», браузер
 *      никуда не уходил. Промокод лишь ДЕРЖАЛ человека на той же
 *      странице — набирать код заново неохота.
 *   2. ПОСЛЕ ОПЛАТЫ САЙТ ПОКАЗЫВАЛ НЕОПЛАЧЕННЫЙ ЧЕК. Сайт ни у кого
 *      не спрашивал: квитанция писалась ДО ухода на Робокассу
 *      и вечно говорила «вы начали оплату».
 *
 * Бот здесь ПОДСТАВНОЙ, и это осознанно: правильность его ответов
 * держат 314 проверок в `bot/test`, а здесь проверяется ровно то,
 * что делает с этими ответами СТРАНИЦА. Подставной бот отвечает
 * мгновенно и одинаково — на живом такие ветки пришлось бы
 * подстраивать, доводя заказы до нужного состояния.
 */

import { chromium } from 'playwright';

const ADRES = process.argv[2] ?? 'http://localhost:4173/';
const ROBOKASSA =
  'https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=Neirolavka&OutSum=1259.10&InvId=7';
const V_BOT = 'https://t.me/neirolavka_ai_bot?start=zakaz_4eddffc4117b889193ecedf94e1aac81';

let ploho = 0;
const horosho = [];
const ruganina = [];
const tak = (uslovie, chto) => {
  if (uslovie) horosho.push(chto);
  else {
    ploho += 1;
    ruganina.push(chto);
  }
};

/**
 * Обстановка одной пробы: свежая страница со своим подставным ботом.
 *
 * Свежая, а не общая, — потому что квитанция живёт в `localStorage`,
 * и проба, начатая на чужой квитанции, меряла бы не то. Тот же закон,
 * что у замера кадров: мерить надо на СВЕЖЕЙ странице.
 */
async function proba(b, { otvetZakaza, otvetSostoyaniya, hranilishche }) {
  const ctx = await b.newContext({ viewport: { width: 1512, height: 900 } });
  const p = await ctx.newPage();
  const zaprosy = { post: [], get: [] };
  let kuda = '';

  await p.route('**/api/promo*', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ godit: true, kod: 'LETO25', skidkaProc: 10 }),
    }),
  );
  await p.route('**/api/zakaz*', (r) => {
    const zapros = r.request();
    if (zapros.method() === 'POST') {
      zaprosy.post.push(zapros.postData() ?? '');
      const o = otvetZakaza(zaprosy.post.length);
      return r.fulfill({ status: o.kod, contentType: 'application/json', body: JSON.stringify(o.telo) });
    }
    zaprosy.get.push(zapros.url());
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(otvetSostoyaniya(zaprosy.get.length)),
    });
  });
  await p.route('https://auth.robokassa.ru/**', (r) => {
    kuda = r.request().url();
    return r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Робокасса</h1>' });
  });

  if (hranilishche) {
    await p.addInitScript(
      ([k, v]) => {
        try {
          window.localStorage.setItem(k, v);
        } catch {
          /* приватное окно — проба просто не состоится, и это видно */
        }
      },
      ['neirolavka:zakaz', JSON.stringify(hranilishche)],
    );
  }

  await p.goto(ADRES, { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  return { ctx, p, zaprosy, kuda: () => kuda };
}

/** Выбрать уровень и способ оплаты — то же, что делает человек. */
async function vybrat(p) {
  const urovni = p.locator('.pcard--active .tariff');
  if ((await urovni.count()) === 0) throw new Error('витрина не поднялась: уровней подписки нет');
  await urovni.first().click({ force: true });
  await p.waitForTimeout(500);
  await p.locator('.pays__item').first().click({ force: true });
  await p.waitForTimeout(300);
}

/** Ввести промокод и дождаться скидки в чеке. */
async function promokod(p) {
  await p.locator('.promo__zvat').first().click({ force: true });
  await p.locator('.promo__vvod').first().fill('LETO25');
  await p.locator('.promo__knopka').first().click({ force: true });
  await p.waitForTimeout(800);
}

const UDACHA = {
  kod: 200,
  telo: { vyshlo: true, nomer: 7, adres: ROBOKASSA, vBot: V_BOT },
};

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });

try {
  /* ── 1. С ПРОМОКОДОМ ОПЛАТА ЗАПУСКАЕТСЯ ─────────────────────── */
  {
    const { ctx, p, zaprosy, kuda } = await proba(b, {
      otvetZakaza: () => UDACHA,
      otvetSostoyaniya: () => ({ nayden: false, oplachen: false, otmenen: false, vBot: '' }),
    });
    await vybrat(p);
    await promokod(p);
    tak((await p.locator('.order__item-row--skidka').count()) > 0, 'с промокодом в чеке есть строка скидки');
    await p.locator('.order__cta').first().click({ force: true });
    await p.waitForTimeout(2000);
    tak(kuda().startsWith('https://auth.robokassa.ru/'), 'с промокодом браузер уходит на Робокассу');
    tak(
      (zaprosy.post[0] ?? '').includes('promo=LETO25'),
      'промокод уезжает боту в теле запроса',
    );
    tak(
      (await p.locator('.order__otkaz').count()) === 0,
      'на исправной оплате отказа на экране нет',
    );
    await ctx.close();
  }

  /* ── 2. ПОВТОР ПО ОПЛАЧЕННОМУ: квитанция, а не «оплата сломана» ── */
  {
    const { ctx, p, kuda } = await proba(b, {
      otvetZakaza: () => ({
        kod: 200,
        telo: { vyshlo: true, oplachen: true, nomer: 7, adres: '', vBot: V_BOT },
      }),
      otvetSostoyaniya: () => ({ nayden: true, oplachen: true, otmenen: false, vBot: V_BOT }),
    });
    await vybrat(p);
    await promokod(p);
    await p.locator('.order__cta').first().click({ force: true });
    await p.waitForTimeout(2000);
    tak(kuda() === '', 'по оплаченному заказу второй раз на Робокассу не ведём');
    const kvit = (await p.locator('.kvit__text').first().textContent().catch(() => '')) ?? '';
    tak(kvit.includes('оплачен'), `квитанция говорит про оплату (сказала: «${kvit.trim()}»)`);
    tak(
      (await p.locator('.kvit--oplachen').count()) > 0,
      'оплаченная квитанция отличается от начатой не только словами',
    );
    tak(
      (await p.locator('.order__otkaz').count()) === 0,
      'оплаченному заказу не говорят «оплата сейчас не работает»',
    );
    await ctx.close();
  }

  /* ── 3. ПОВТОР ПО ОТМЕНЁННОМУ: сайт сам начинает заново ───────── */
  {
    const { ctx, p, zaprosy, kuda } = await proba(b, {
      // Первый запрос — «ключ мёртв», второй — обычная удача.
      otvetZakaza: (n) =>
        n === 1
          ? {
              kod: 400,
              telo: {
                vyshlo: false,
                pochemu: 'zakaz_zakryt',
                soobshchenie: 'Прошлый заказ закрыт — начинаю новый.',
              },
            }
          : UDACHA,
      otvetSostoyaniya: () => ({ nayden: false, oplachen: false, otmenen: false, vBot: '' }),
    });
    await vybrat(p);
    await p.locator('.order__cta').first().click({ force: true });
    await p.waitForTimeout(2500);
    tak(kuda().startsWith('https://auth.robokassa.ru/'), 'на мёртвом ключе сайт заводит новый заказ сам');
    tak(zaprosy.post.length === 2, `повтор ровно один, а не круг (запросов: ${zaprosy.post.length})`);
    const klyuchi = zaprosy.post.map((t) => new URLSearchParams(t).get('popytka'));
    tak(klyuchi[0] !== klyuchi[1], 'повтор идёт с НОВЫМ ключом нажатия, иначе упрётся в тот же заказ');
    await ctx.close();
  }

  /* ── 4. НОМЕРА ЗАКАЗА У ПОКУПАТЕЛЯ НЕТ ───────────────────────── */
  {
    const { ctx, p } = await proba(b, {
      otvetZakaza: () => UDACHA,
      otvetSostoyaniya: () => ({ nayden: true, oplachen: false, otmenen: false, vBot: V_BOT }),
      hranilishche: { nomer: 24, vBot: V_BOT },
    });
    const kvit = (await p.locator('.kvit__text').first().textContent().catch(() => '')) ?? '';
    tak(kvit.length > 0, 'квитанция из хранилища показана');
    tak(!/№|\b24\b/.test(kvit), `в квитанции нет номера заказа (сказала: «${kvit.trim()}»)`);
    tak(kvit.includes('начали оплату'), 'неоплаченная квитанция говорит «вы начали оплату»');
    await ctx.close();
  }

  /* ── 5. ОПЛАТА ВИДНА БЕЗ ПЕРЕЗАГРУЗКИ РУКАМИ ──────────────────── */
  {
    // Первый ответ — «ещё не оплачен», второй — «оплачен»: так
    // выглядит человек, вернувшийся во вкладку после оплаты.
    const { ctx, p, zaprosy } = await proba(b, {
      otvetZakaza: () => UDACHA,
      otvetSostoyaniya: (n) => ({
        nayden: true,
        oplachen: n > 1,
        otmenen: false,
        vBot: V_BOT,
      }),
      hranilishche: { nomer: 24, vBot: V_BOT },
    });
    tak(zaprosy.get.length > 0, 'сайт СПРАШИВАЕТ бота про заказ, а не молчит');
    tak(
      (zaprosy.get[0] ?? '').includes('klyuch=4eddffc4'),
      'спрашивает по секрету заказа, а не по номеру',
    );
    const doOplaty = (await p.locator('.kvit__text').first().textContent()) ?? '';
    tak(doOplaty.includes('начали оплату'), 'до оплаты квитанция не объявляет заказ оплаченным');

    // Возврат во вкладку — то же событие, что у человека.
    await p.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await p.waitForTimeout(1200);
    const posle = (await p.locator('.kvit__text').first().textContent()) ?? '';
    tak(
      posle.includes('оплачен'),
      `после оплаты страница САМА показывает её (сказала: «${posle.trim()}»)`,
    );
    tak((await p.locator('.kvit--oplachen').count()) > 0, 'оплаченная квитанция получает свой вид');
    await ctx.close();
  }

  /* ── 6. ОТМЕНЁННЫЙ ЗАКАЗ УБИРАЕТ КВИТАНЦИЮ ───────────────────── */
  {
    const { ctx, p } = await proba(b, {
      otvetZakaza: () => UDACHA,
      otvetSostoyaniya: () => ({ nayden: true, oplachen: false, otmenen: true, vBot: V_BOT }),
      hranilishche: { nomer: 24, vBot: V_BOT },
    });
    await p.waitForTimeout(800);
    tak(
      (await p.locator('.kvit__text').count()) === 0,
      'у отменённого заказа квитанции нет: ссылка вела бы в никуда',
    );
    await ctx.close();
  }
  /* ── 7. КОНТРАСТ КВИТАНЦИИ В ОБЕИХ ТЕМАХ ─────────────────────
   *
   * Общий `check-contrast` до неё не доходит и дойти не может:
   * квитанция видна только тому, у кого есть СВОЙ начатый заказ,
   * то есть при непустом хранилище. Меряется тем же способом —
   * по отрисованной странице, холстом, а не разбором записи цвета:
   * `color-mix(...)` вычисляется в `color(srgb 0.94 …)`, и доли
   * там легко принять за каналы 0…255. */
  for (const tema of ['light', 'dark']) {
    const { ctx, p } = await proba(b, {
      otvetZakaza: () => UDACHA,
      otvetSostoyaniya: () => ({ nayden: true, oplachen: true, otmenen: false, vBot: V_BOT }),
      hranilishche: { nomer: 24, vBot: V_BOT },
    });
    await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
    await p.waitForTimeout(700);
    const pary = await p.evaluate(() => {
      const cvet = (zapis) => {
        const h = document.createElement('canvas');
        h.width = h.height = 1;
        const k = h.getContext('2d');
        k.fillStyle = zapis;
        k.fillRect(0, 0, 1, 1);
        const [r, g, b] = k.getImageData(0, 0, 1, 1).data;
        return [r, g, b];
      };
      const svet = ([r, g, b]) => {
        const f = (v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const kvit = document.querySelector('.kvit');
      if (!kvit) return null;
      const fon = cvet(getComputedStyle(kvit).backgroundColor);
      const par = [];
      for (const sel of ['.kvit__text', '.kvit__cta', '.kvit__skryt']) {
        const u = kvit.querySelector(sel);
        if (!u) continue;
        const a = svet(cvet(getComputedStyle(u).color));
        const bb = svet(fon);
        par.push([sel, (Math.max(a, bb) + 0.05) / (Math.min(a, bb) + 0.05)]);
      }
      return par;
    });
    /* ПРЕДМЕТ ПРОБЫ НЕ НАШЁЛСЯ — ЭТО ОТКАЗ, А НЕ ЗАМЕТКА. Проверка,
       молча пропускающая узел, зелена всегда. */
    tak(pary && pary.length === 3, `квитанция найдена и у неё три пары (${tema})`);
    for (const [sel, k] of pary ?? []) {
      tak(k >= 4.5, `${tema}: ${sel} — ${k.toFixed(2)}:1 при пороге 4.5`);
    }
    await ctx.close();
  }
} finally {
  await b.close();
}

for (const s of horosho) console.log('  ок   ', s);
for (const s of ruganina) console.log('  ПЛОХО', s);
console.log(`\nпроб ${horosho.length + ruganina.length}, плохо ${ploho}`);
process.exit(ploho ? 1 : 0);
