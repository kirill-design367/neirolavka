'use client';

import { useCallback } from 'react';
import { getCatalog } from '@/lib/catalog';
import { useOrder } from '@/lib/order';
import { useCountUp, useExpand } from '@/lib/motion';

const formatRub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

/**
 * Панель заказа — она же чек.
 *
 * Сайт ничего не обрабатывает: выбранный тариф и способ оплаты уезжают
 * в бот параметром ссылки. Ни полей ввода, ни персональных данных.
 *
 * Пока ничего не выбрано, чек пустой: способ оплаты и итог не показываются.
 * Спрашивать про оплату раньше, чем человек выбрал товар, — ставить
 * второй шаг перед первым.
 */
export function OrderPanel() {
  const catalog = getCatalog();
  const { selection, paymentId, total, ready, botHref, choosePayment } = useOrder();
  const totalRef = useCountUp(total, useCallback(formatRub, []));
  const restRef = useExpand<HTMLDivElement>(Boolean(selection));

  return (
    <aside className="order" aria-label="Заказ">
      <div className="order__paper">
        <h2 className="order__title">Заказ</h2>

        <div className="order__block">
          <p className="order__label">Товар</p>
          {selection ? (
            <div className="order__item">
              <p className="order__item-name">{selection.plan.title}</p>
              <p className="order__item-note">{selection.plan.note}</p>
            </div>
          ) : (
            <p className="order__empty">
              Пока пусто. Выберите нейросеть и тариф — они появятся здесь.
            </p>
          )}
        </div>

        {/* Всё остальное разворачивается, когда товар выбран. */}
        <div className="order__rest" ref={restRef}>
          <div>
            <div className="order__block" data-expand-item>
              <p className="order__label" id="sposob-oplaty">
                Способ оплаты
              </p>
              <ul className="order__payments" aria-labelledby="sposob-oplaty">
                {catalog.payments.map((method) => {
                  const active = paymentId === method.id;
                  return (
                    <li key={method.id}>
                      <button
                        type="button"
                        className={`pay${active ? ' pay--active' : ''}`}
                        onClick={() => choosePayment(method.id)}
                        aria-pressed={active}
                      >
                        <span className="pay__dot" aria-hidden="true" />
                        <span className="pay__text">
                          <span className="pay__title">{method.title}</span>
                          <span className="pay__caption">{method.caption}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="order__total" data-expand-item>
              <span className="order__total-label">Итого</span>
              <span ref={totalRef} className="order__total-value tnum">
                {formatRub(total)}
              </span>
            </div>
          </div>
        </div>

        <a
          className={`order__cta${ready ? '' : ' order__cta--off'}`}
          href={ready ? botHref : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!ready}
          tabIndex={ready ? undefined : -1}
        >
          {!selection ? 'Выберите тариф' : ready ? 'Перейти в бот' : 'Выберите способ оплаты'}
        </a>

        <p className="order__fineprint">
          Регистрация, оплата и выдача доступа — в боте. На сайте ничего вводить не нужно.
        </p>
      </div>
    </aside>
  );
}

/** Нижняя полоса для телефона. Та же логика, другая раскладка. */
export function OrderBar() {
  const catalog = getCatalog();
  const { selection, total, ready, botHref, paymentId, choosePayment } = useOrder();
  const totalRef = useCountUp<HTMLParagraphElement>(total, useCallback(formatRub, []));

  return (
    <div className="bar" aria-label="Заказ">
      {selection && (
        <div className="bar__pays" role="group" aria-label="Способ оплаты">
          {catalog.payments.map((method) => (
            <button
              key={method.id}
              type="button"
              className={`bar__pay${paymentId === method.id ? ' bar__pay--active' : ''}`}
              onClick={() => choosePayment(method.id)}
              aria-pressed={paymentId === method.id}
            >
              {method.title}
            </button>
          ))}
        </div>
      )}

      <div className="bar__row">
        <div className="bar__info">
          {selection ? (
            <>
              <p className="bar__name">{selection.plan.title}</p>
              <p ref={totalRef} className="bar__total tnum">
                {formatRub(total)}
              </p>
            </>
          ) : (
            <p className="bar__empty">Выберите нейросеть и тариф</p>
          )}
        </div>

        <a
          className={`bar__cta${ready ? '' : ' bar__cta--off'}`}
          href={ready ? botHref : undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!ready}
          tabIndex={ready ? undefined : -1}
        >
          В бот
        </a>
      </div>
    </div>
  );
}
