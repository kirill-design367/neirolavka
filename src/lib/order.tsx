'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { findPlan, getCatalog, type PaymentMethod, type Plan, type Product } from '@/lib/catalog';

type OrderState = {
  /** Выбранный продукт на витрине. null — не выбран ни один. */
  openProductId: string | null;
  planId: string | null;
  paymentId: PaymentMethod['id'] | null;
  /** Выбранный тариф вместе с продуктом, либо null. */
  selection: { product: Product; plan: Plan } | null;
  payment: PaymentMethod | null;
  total: number;
  /** Выбор полон: тариф и способ оплаты. */
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

  // Выбор ДЕРЖИТСЯ, пока не выбран другой продукт: повторное нажатие
  // по выбранной карточке ничего не сворачивает. Витрина, с которой
  // можно случайно снять выбор, заставляет выбирать дважды.
  const chooseProduct = useCallback((id: string) => {
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
    const selection = found ? { product: found.product, plan: found.plan } : null;
    const payment = catalog.payments.find((p) => p.id === paymentId) ?? null;
    const total = selection ? selection.plan.priceRub : 0;
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
      if (catalog.botStartPayload) {
        const params = new URLSearchParams();
        if (selection) params.set('tovar', selection.plan.id);
        if (payment) params.set('oplata', payment.id);
        const start = params.toString().replace(/[=&]/g, '_').slice(0, 64);
        if (start) botHref = `${catalog.botUrl}?start=${start}`;
      }
    }

    return {
      openProductId,
      planId,
      paymentId,
      selection,
      payment,
      total,
      ready,
      botReady,
      botHref,
      chooseProduct,
      choosePlan,
      choosePayment,
      reset,
    };
  }, [catalog.botUrl, catalog.botStartPayload, catalog.payments, openProductId, paymentId, planId, chooseProduct, choosePlan, choosePayment, reset]);

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrder(): OrderState {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error('useOrder вызван вне OrderProvider');
  return ctx;
}
