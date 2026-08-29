'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { findPlan, getCatalog, type PaymentMethod, type Plan, type Product } from '@/lib/catalog';

type OrderState = {
  /** Раскрытая нейросеть. null — не выбрана ни одна. */
  openProductId: string | null;
  planId: string | null;
  paymentId: PaymentMethod['id'] | null;
  /** Выбранный тариф вместе с продуктом, либо null. */
  selection: { product: Product; plan: Plan } | null;
  payment: PaymentMethod | null;
  total: number;
  /** Кнопка перехода в бот активна только при полном выборе. */
  ready: boolean;
  /** Ссылка в бот с выбранным заказом в параметре. */
  botHref: string;
  toggleProduct: (id: string) => void;
  choosePlan: (id: string) => void;
  choosePayment: (id: PaymentMethod['id']) => void;
  reset: () => void;
};

const OrderContext = createContext<OrderState | null>(null);

export function OrderProvider({ children }: { children: React.ReactNode }) {
  const catalog = getCatalog();
  // Первая доступная нейросеть раскрыта сразу. Механика разворачивания
  // никуда не девается — она работает при переключении, — но человек
  // видит цену, не совершая действий: на этом рынке спрятанная за клик
  // цена читается как «скажу в личке».
  const [openProductId, setOpenProductId] = useState<string | null>(
    () => catalog.products.find((p) => p.status === 'available')?.id ?? null,
  );
  const [planId, setPlanId] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<PaymentMethod['id'] | null>(null);

  const toggleProduct = useCallback((id: string) => {
    setOpenProductId((current) => {
      const next = current === id ? null : id;
      // Свернули полку — снимаем выбор тарифа с неё же,
      // иначе в панели остался бы товар, которого не видно.
      setPlanId((planCurrent) => {
        if (!planCurrent) return null;
        const found = findPlan(planCurrent);
        return found && found.product.id === next ? planCurrent : null;
      });
      return next;
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

    const params = new URLSearchParams();
    if (selection) {
      params.set('tovar', selection.plan.id);
    }
    if (payment) {
      params.set('oplata', payment.id);
    }
    // Telegram передаёт боту всё, что лежит в start, одной строкой.
    const start = params.toString().replace(/[=&]/g, '_');
    const botHref = start ? `${catalog.botUrl}?start=${start}` : catalog.botUrl;

    return {
      openProductId,
      planId,
      paymentId,
      selection,
      payment,
      total,
      ready,
      botHref,
      toggleProduct,
      choosePlan,
      choosePayment,
      reset,
    };
  }, [catalog.botUrl, catalog.payments, openProductId, paymentId, planId, toggleProduct, choosePlan, choosePayment, reset]);

  return <OrderContext.Provider value={value}>{children}</OrderContext.Provider>;
}

export function useOrder(): OrderState {
  const ctx = useContext(OrderContext);
  if (!ctx) throw new Error('useOrder вызван вне OrderProvider');
  return ctx;
}
