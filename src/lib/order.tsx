'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { findPlan, findProduct, getCatalog, priceOf, type PaymentMethod, type Plan, type Product } from '@/lib/catalog';
import { KLYUCH_METKI, metkaIzAdresa, sobratPayload } from '@/lib/metka';

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
      if (metka) pary[KLYUCH_METKI] = metka;
      const start = sobratPayload(pary);
      if (start) botHref = `${catalog.botUrl}?start=${start}`;
    }

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
      chooseProduct,
      choosePlan,
      choosePayment,
      reset,
    };
  }, [catalog.botUrl, catalog.botStartPayload, catalog.payments, openProductId, paymentId, planId, tronul, chooseProduct, choosePlan, choosePayment, reset, metka]);

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrder(): OrderState {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error('useOrder вызван вне OrderProvider');
  return ctx;
}
