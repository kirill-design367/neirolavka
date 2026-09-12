'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { findPlan, findProduct, getCatalog, priceOf, type PaymentMethod, type Plan, type Product } from '@/lib/catalog';
import { KLYUCH_METKI, metkaIzAdresa, sobratPayload } from '@/lib/metka';
import { KLYUCH_PROMO, kodPromo, otkazSlovami, skidkaKop, type OtkazPromo } from '@/lib/promokod';

/**
 * Что сейчас с промокодом.
 *
 * Состояние, а не булево «есть/нет»: у отказа пять разных причин,
 * и человеку надо сказать, какая именно, — «код не подошёл» без
 * объяснения заставляет набирать его ещё раз, чтобы получить тот же
 * ответ.
 */
export type PromoSostoyanie =
  | { vid: 'net' }
  | { vid: 'proveryaem'; kod: string }
  | { vid: 'godit'; kod: string; skidkaProc: number }
  | { vid: 'ne_podoshel'; kod: string; soobshchenie: string }
  /** Спросить было некого: бот не ответил. Это НЕ «кода нет». */
  | { vid: 'ne_proverili'; kod: string };

/** Адрес проверки. Тот же домен, что и сайт: бот стоит за nginx. */
const PROVERKA = '/api/promo';

/** Адрес заведения заказа. Тот же бот за тем же nginx. */
const ZAKAZ = '/api/zakaz';

/**
 * Где браузер помнит начатую оплату.
 *
 * ЭТО ЕДИНСТВЕННОЕ, ЧТО САЙТ ХРАНИТ, и исключение объявлено вслух.
 * Правило «на сайте не хранится ничего» написано про данные
 * О ЧЕЛОВЕКЕ — метку канала, промокод, что он смотрел. Здесь другое:
 * это его собственная квитанция, ссылка на его же оплаченный заказ.
 *
 * Без неё человек, закрывший вкладку после оплаты и не нажавший
 * «забрать в боте», теряет единственную ниточку к своим деньгам:
 * входа на сайте нет, и опознать его мы не можем ничем. Ниточка
 * есть и у нас — команда видит такой заказ в панели, — но она
 * требует живого человека и переписки. Квитанция в браузере
 * возвращает её самому покупателю.
 *
 * Хранится ровно две вещи: номер заказа и готовая ссылка в бот.
 * Ни выбора, ни цены, ни промокода, ни метки.
 */
const KLYUCH_KVITANCII = 'neirolavka:zakaz';

export type Kvitanciya = { nomer: number; vBot: string };

function prochitatKvitanciyu(): Kvitanciya | null {
  try {
    const syroe = window.localStorage.getItem(KLYUCH_KVITANCII);
    if (!syroe) return null;
    const d = JSON.parse(syroe) as Partial<Kvitanciya>;
    return typeof d.nomer === 'number' && typeof d.vBot === 'string' && d.vBot
      ? { nomer: d.nomer, vBot: d.vBot }
      : null;
  } catch {
    // Приватное окно, запрещённые данные сайта, мусор в хранилище —
    // всё это не поломка: квитанции просто нет.
    return null;
  }
}

function zapisatKvitanciyu(k: Kvitanciya | null): void {
  try {
    if (k) window.localStorage.setItem(KLYUCH_KVITANCII, JSON.stringify(k));
    else window.localStorage.removeItem(KLYUCH_KVITANCII);
  } catch {
    /* Не записалось — не беда: ссылку человек получит на странице
       возврата из Робокассы, а заказ в любом случае виден команде. */
  }
}

/**
 * Ключ ОДНОГО нажатия.
 *
 * Сайт придумывает его сам и держит, пока не изменился выбор.
 * Второе нажатие с тем же ключом возвращает ТОТ ЖЕ заказ — иначе
 * человек, нажавший «Оплатить» дважды, получил бы два заказа
 * и потратил бы две активации промокода. Разнимает их база, а ключ
 * даёт ей, по чему разнимать.
 */
function novyKlyuchNazhatiya(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Древний браузер без randomUUID: годится что угодно, лишь бы
  // не повторялось у одного человека за одну сессию.
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Что сейчас с оплатой. */
export type OplataSostoyanie =
  | { vid: 'net' }
  /** Заводим заказ и ждём адрес Робокассы. Кнопка в это время занята. */
  | { vid: 'idem' }
  | { vid: 'otkaz'; soobshchenie: string };

type OrderState = {
  /** Выбранный продукт на витрине. null — не выбран ни один. */
  openProductId: string | null;
  planId: string | null;
  paymentId: PaymentMethod['id'] | null;
  /**
   * Что уедет в чек: продукт и уровень подписки.
   *
   * `plan` равен null у продуктов БЕЗ уровней (Claude Pro, Seedance):
   * у них покупается сам продукт, и выбор считается сделанным сразу
   * по нажатию на карточку. Раньше выбор всегда был выбором тарифа,
   * и продукт без тарифов просто нельзя было купить.
   */
  selection: { product: Product; plan: Plan | null } | null;
  payment: PaymentMethod | null;
  total: number;
  /** Известна ли цена выбранного. Пока прайса нет — всюду false. */
  priceKnown: boolean;
  /** Выбор полон: продукт (с уровнем, если они есть) и способ оплаты. */
  ready: boolean;
  /** Бот заведён и по ссылке есть куда идти. */
  botReady: boolean;
  /** Ссылка в бот с выбранным заказом в параметре, либо пусто. */
  botHref: string;
  /** Что сейчас с введённым промокодом. */
  promo: PromoSostoyanie;
  /**
   * Размер скидки в рублях. Ноль — скидки нет или цена неизвестна:
   * процент от неизвестной цены — это неизвестное, а не ноль выгоды.
   */
  skidka: number;
  /** Сколько остаётся заплатить: цена минус скидка. */
  kOplate: number;
  /** Что сейчас с оплатой: ничего, идём заводить заказ, отказ. */
  oplata: OplataSostoyanie;
  /**
   * Начатая оплата, о которой помнит браузер. Нужна человеку,
   * закрывшему вкладку: без неё ссылка на свой оплаченный заказ
   * теряется навсегда.
   */
  kvitanciya: Kvitanciya | null;
  /** Завести заказ и уйти на страницу оплаты. */
  oplatit: () => void;
  /** Убрать квитанцию: заказ забран или человек не хочет её видеть. */
  zabytKvitanciyu: () => void;
  /** Проверить введённый код. Пусто — просто снять применённый. */
  primenitPromo: (syroe: string) => void;
  ubratPromo: () => void;
  chooseProduct: (id: string) => void;
  choosePlan: (id: string) => void;
  choosePayment: (id: PaymentMethod['id']) => void;
  reset: () => void;
};

const OrderContext = createContext<OrderState | null>(null);

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const catalog = getCatalog();
  // Первый продукт выбран сразу. Человек видит цену, не совершая
  // действий: на этом рынке спрятанная за клик цена читается
  // как «скажу в личке».
  const [openProductId, setOpenProductId] = useState<string | null>(
    () => catalog.products[0]?.id ?? null,
  );
  const [planId, setPlanId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<PaymentMethod['id'] | null>(null);
  // Нажимал ли человек по карточке вообще.
  //
  // Первый продукт РАСКРЫТ сразу, но не выбран: у продукта без
  // уровней выбор совпадает с раскрытием, и без этого флага чек
  // оказался бы заполненным ещё до единого нажатия — то есть
  // за человека. Флаг поднимается только из chooseProduct.
  const [tronul, setTronul] = useState(false);

  /**
   * Метка рекламного канала из адреса страницы.
   *
   * Читается ОДИН раз, в эффекте, а не в теле рендера: сборка
   * статическая, и на ней `window` не существует вовсе. И держится
   * в состоянии, а не читается при каждом нажатии, — чтобы ссылка
   * в бот не зависела от того, успел ли человек уйти по якорю
   * и вернуться.
   *
   * НИЧЕГО НЕ ЗАПОМИНАЕТСЯ В БРАУЗЕРЕ: код канала живёт ровно
   * столько, сколько открыта вкладка. Класть его в хранилище значило
   * бы оставлять след о человеке на его же устройстве ради нашей
   * статистики, а сайт не собирает о людях ничего.
   */
  const [metka, setMetka] = useState('');
  useEffect(() => {
    setMetka(metkaIzAdresa(window.location.search));
  }, []);

  /**
   * Промокод.
   *
   * НА САЙТЕ НЕ ХРАНИТСЯ НИЧЕГО — ни в `localStorage`, ни в куках,
   * ровно как метка канала. Код живёт столько, сколько открыта
   * вкладка, и уезжает в ссылку на бота.
   *
   * Проверяется он по кнопке, а не на каждую букву. Две причины:
   * у проверки стоит предел частоты в nginx (перебором код из восьми
   * знаков ловится за ночь), и «не подошёл» на середине набора
   * читается отказом, хотя человек ещё печатает.
   */
  const [promo, setPromo] = useState<PromoSostoyanie>({ vid: 'net' });

  /**
   * Оплата и квитанция.
   *
   * Квитанция читается В ЭФФЕКТЕ, а не при первой отрисовке: сборка
   * статическая, и на сервере `window` не существует вовсе. Тот же
   * приём, что у метки канала.
   */
  const [oplata, setOplata] = useState<OplataSostoyanie>({ vid: 'net' });
  const [kvitanciya, setKvitanciya] = useState<Kvitanciya | null>(null);
  useEffect(() => {
    setKvitanciya(prochitatKvitanciyu());
  }, []);

  /* Ключ нажатия живёт, пока не изменился ВЫБОР. Два нажатия подряд
     по одной и той же подписке — это одно нажатие; сменил человек
     уровень или код — это уже другой заказ. */
  const popytka = useRef<{ podpis: string; id: string }>({ podpis: '', id: '' });

  const zabytKvitanciyu = useCallback(() => {
    zapisatKvitanciyu(null);
    setKvitanciya(null);
  }, []);
  /* Номер запроса: ответ на позапрошлый код не должен перебивать
     ответ на нынешний. Сеть ответы не упорядочивает. */
  const zapros = useRef(0);

  const primenitPromo = useCallback((syroe: string) => {
    const kod = kodPromo(syroe);
    const nomer = ++zapros.current;
    if (!kod) {
      setPromo({ vid: 'net' });
      return;
    }
    setPromo({ vid: 'proveryaem', kod });
    fetch(`${PROVERKA}?kod=${encodeURIComponent(kod)}`, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { godit?: boolean; kod?: string; skidkaProc?: number; pochemu?: string }) => {
        if (nomer !== zapros.current) return;
        if (d.godit && typeof d.skidkaProc === 'number') {
          setPromo({ vid: 'godit', kod: d.kod ?? kod, skidkaProc: d.skidkaProc });
        } else {
          setPromo({ vid: 'ne_podoshel', kod, soobshchenie: otkazSlovami((d.pochemu ?? 'net') as OtkazPromo) });
        }
      })
      .catch(() => {
        if (nomer !== zapros.current) return;
        /* СПРОСИТЬ БЫЛО НЕКОГО — это не «кода нет». Сказать человеку,
           что его код не существует, когда мы просто не дозвонились,
           значит соврать ровно там, где он проверяет, можно ли нам
           верить. Код при этом всё равно уезжает в бот: настоящее
           решение принимает он. */
        setPromo({ vid: 'ne_proverili', kod });
      });
  }, []);

  const ubratPromo = useCallback(() => {
    zapros.current++;
    setPromo({ vid: 'net' });
  }, []);

  // Выбор ДЕРЖИТСЯ, пока не выбран другой продукт: повторное нажатие
  // по выбранной карточке ничего не сворачивает. Витрина, с которой
  // можно случайно снять выбор, заставляет выбирать дважды.
  const chooseProduct = useCallback((id: string) => {
    setTronul(true);
    setOpenProductId((current) => {
      if (current === id) return current;
      // Сменили продукт — снимаем выбор тарифа с прежнего, иначе
      // в панели остался бы товар с невидимой карточки.
      setPlanId((planCurrent) => {
        if (!planCurrent) return null;
        const found = findPlan(planCurrent);
        return found && found.product.id === id ? planCurrent : null;
      });
      return id;
    });
  }, []);

  const choosePlan = useCallback((id: string) => {
    setPlanId((current) => (current === id ? null : id));
  }, []);

  const choosePayment = useCallback((id: PaymentMethod['id']) => {
    setPaymentId(id);
  }, []);

  const reset = useCallback(() => {
    setPlanId(null);
    setPaymentId(null);
  }, []);

  const value = useMemo<OrderState>(() => {
    const found = planId ? findPlan(planId) : null;
    // Продукт без уровней покупается сам по себе — как только человек
    // по нему нажал. Продукт с уровнями ждёт выбора уровня.
    const golyy = tronul && openProductId ? findProduct(openProductId) : null;
    const selection = found
      ? { product: found.product, plan: found.plan as Plan | null }
      : golyy && golyy.plans.length === 0
        ? { product: golyy, plan: null }
        : null;
    const payment = catalog.payments.find((p) => p.id === paymentId) ?? null;
    // Цены может не быть вовсе — тогда в итоге ноль, а чек показывает
    // «цена уточняется». Считать ноль ценой нельзя, поэтому наружу
    // уходит ещё и признак «цена известна».
    const price = selection ? priceOf(selection.product, selection.plan) : null;
    const total = price ?? 0;
    const priceKnown = price !== null;
    const ready = Boolean(selection && payment);

    /* Скидка считается ОТ ЦЕНЫ ТАРИФА — теми же копейками и той же
       функцией, что в боте. Иначе сайт показал бы одно число,
       а в заказе оказалось бы другое, и разошлись бы они на копейку
       в первый же день. */
    const skidka = promo.vid === 'godit' && priceKnown
      ? skidkaKop(Math.round(total * 100), promo.skidkaProc) / 100
      : 0;
    const kOplate = Math.max(0, total - skidka);

    // Пока адрес бота пуст, ссылки не собираются вовсе: вести
    // на несуществующего бота хуже, чем честно ничего не предлагать.
    const botReady = catalog.botUrl.length > 0;
    let botHref = '';
    if (botReady) {
      botHref = catalog.botUrl;
      // Заказ в параметре `start` — за флагом, и флаг сейчас выключен.
      // Почему — написано у самого флага в catalog.ts: бот эту строку
      // не читает, а в незаконченном разговоре она уйдёт человеку
      // в ввод. Сама сборка строки живёт здесь, чтобы включить её
      // можно было одним значением, когда бот научится.
      //
      // Telegram разрешает в `start` только латиницу, цифры, дефис
      // и подчёркивание, не длиннее 64 знаков, — отсюда замена
      // «=» и «&» на подчёркивание.
      //
      // МЕТКА КАНАЛА ЕДЕТ ОТДЕЛЬНО ОТ ЗАКАЗА и флагом не закрыта.
      // Две причины, по которым выключен `botStartPayload`, к ней
      // не относятся: бот метку читает (`/start` разбирает payload),
      // а человека с незаконченным вводом она больше не запирает —
      // регулярка выхода из разговора расширена до `(\s|$)`.
      const pary: Record<string, string> = {};
      if (catalog.botStartPayload) {
        if (selection) pary['tovar'] = selection.plan?.id ?? selection.product.id;
        if (payment) pary['oplata'] = payment.id;
      }
      /* ПРОМОКОД ЕДЕТ ТЕМ ЖЕ PAYLOAD, ЧТО И МЕТКА, и флагом
         `botStartPayload` не закрыт — по той же причине: бот его
         ЧИТАЕТ. Тот флаг про пару «товар + оплата», которую
         обработчик `/start` не разбирает; промокод он разбирает
         и записывает человеку.

         Стоит ПЕРЕД меткой: payload обрезается до 64 знаков,
         и при обрезке пострадать должно то, что дешевле потерять.
         Потерянная метка — это строка в статистике; потерянный
         промокод — это деньги человека. */
      if (promo.vid === 'godit' || promo.vid === 'ne_proverili') pary[KLYUCH_PROMO] = promo.kod;
      if (metka) pary[KLYUCH_METKI] = metka;
      const start = sobratPayload(pary);
      if (start) botHref = `${catalog.botUrl}?start=${start}`;
    }

    /**
     * ОПЛАТА НА САЙТЕ.
     *
     * Сайт не заводит заказ сам и не хранит ничего о покупке: он
     * отдаёт выбор боту, получает адрес Робокассы и уводит туда
     * браузер. Всё, что дальше, — заказ, активация промокода, счёт,
     * подпись — по-прежнему живёт в боте, то есть правило «сайт
     * ничего не обрабатывает» цело.
     *
     * КВИТАНЦИЯ ПИШЕТСЯ ДО УХОДА НА ОПЛАТУ, а не после. После —
     * не получится: со страницы Робокассы человек к нам не вернётся,
     * а вернётся на страницу бота. И это правильнее по смыслу: заказ
     * уже заведён и уже виден команде, независимо от того, дойдут ли
     * деньги.
     */
    const oplatit = () => {
      if (!selection || !payment || !priceKnown || oplata.vid === 'idem') return;
      const tovar = selection.plan?.id ?? selection.product.id;
      const kod = promo.vid === 'godit' || promo.vid === 'ne_proverili' ? promo.kod : '';
      const podpis = `${tovar}|${kod}`;
      if (popytka.current.podpis !== podpis) {
        popytka.current = { podpis, id: novyKlyuchNazhatiya() };
      }
      setOplata({ vid: 'idem' });
      const telo = new URLSearchParams({
        tovar,
        oplata: payment.id,
        promo: kod,
        metka,
        popytka: popytka.current.id,
      });
      fetch(ZAKAZ, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: telo.toString(),
      })
        .then((r) => r.json())
        .then((d: { vyshlo?: boolean; adres?: string; nomer?: number; vBot?: string; soobshchenie?: string }) => {
          if (!d.vyshlo || !d.adres) {
            setOplata({
              vid: 'otkaz',
              soobshchenie: d.soobshchenie || 'Не получилось завести заказ. Попробуйте ещё раз.',
            });
            return;
          }
          if (typeof d.nomer === 'number' && d.vBot) {
            const k = { nomer: d.nomer, vBot: d.vBot };
            zapisatKvitanciyu(k);
            setKvitanciya(k);
          }
          window.location.href = d.adres;
          /* КНОПКУ НАДО ОТПУСТИТЬ, хотя страница уже уходит.
             Браузер сохраняет её в кеше «назад-вперёд» как есть,
             и человек, нажавший «Назад» со страницы Робокассы (это
             делают постоянно: передумал, не тот способ, не пришла
             смска), вернулся бы на страницу с кнопкой «Уводим
             на оплату…», которая больше не нажимается никогда.

             Второе нажатие от этого не опасно: ключ нажатия тот же,
             и бот вернёт ТОТ ЖЕ заказ, а не заведёт второй. */
          setOplata({ vid: 'net' });
        })
        .catch(() => {
          /* НЕ ДОЗВОНИЛИСЬ — это не «оплата сломана». Заказ мог
             и завестись: ответ потерялся, а запрос дошёл. Поэтому
             ключ нажатия НЕ сбрасывается — повторное нажатие вернёт
             тот же заказ, а не заведёт второй. */
          setOplata({
            vid: 'otkaz',
            soobshchenie: 'Не дозвонились до лавки. Проверьте связь и нажмите ещё раз.',
          });
        });
    };

    return {
      openProductId,
      planId,
      paymentId,
      selection,
      payment,
      total,
      priceKnown,
      ready,
      botReady,
      botHref,
      promo,
      skidka,
      kOplate,
      oplata,
      kvitanciya,
      oplatit,
      zabytKvitanciyu,
      primenitPromo,
      ubratPromo,
      chooseProduct,
      choosePlan,
      choosePayment,
      reset,
    };
  }, [catalog.botUrl, catalog.botStartPayload, catalog.payments, openProductId, paymentId, planId, tronul, chooseProduct, choosePlan, choosePayment, reset, metka, promo, primenitPromo, ubratPromo, oplata, kvitanciya, zabytKvitanciyu]);

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrder(): OrderState {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error('useOrder вызван вне OrderProvider');
  return ctx;
}
