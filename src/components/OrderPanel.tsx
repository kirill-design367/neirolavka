'use client';

import { useCallback, useEffect, useState } from 'react';
import { accessUntil, getCatalog } from '@/lib/catalog';
import { useOrder } from '@/lib/order';
import { useCountUp, useExpand } from '@/lib/motion';

const formatRub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

/**
 * Панель заказа — она же чек.
 *
 * Сайт ничего не обрабатывает: выбранный тариф и способ оплаты уезжают
 * в бот параметром ссылки. Ни полей ввода, ни персональных данных.
 *
 * Пока ничего не выбрано, чек пустой: способ оплаты и итог не
 * показываются. Спрашивать про оплату раньше, чем человек выбрал
 * товар, — ставить второй шаг перед первым.
 *
 * Панель разделена на две части. Верхняя прокручивается, если
 * содержимое не помещается в экран. Нижняя с итогом и кнопкой
 * закреплена и остаётся видимой при любой высоте окна.
 */
export function OrderPanel() {
  const catalog = getCatalog();
  const { selection, payment, paymentId, total, ready, botReady, botHref, choosePayment } = useOrder();
  const totalRef = useCountUp(total, useCallback(formatRub, []));
  const restRef = useExpand<HTMLDivElement>(Boolean(selection));

  // Дату считаем после монтирования: сборка статическая, и вшитая
  // на этапе сборки дата протухла бы через неделю.
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);
  const until = selection?.plan.months && today ? accessUntil(selection.plan.months, today) : null;

  return (
    <aside className="order" aria-label="Заказ">
      <div className="order__paper">
        <div className="order__scroll" data-lenis-scrollable>
          <h2 className="order__title">Заказ</h2>

          <div className="order__block">
            <p className="order__label">Товар</p>
            {selection ? (
              <div className="order__item">
                <p className="order__item-row">
                  <span className="order__item-name">{selection.plan.title}</span>
                  <span className="order__leader" aria-hidden="true" />
                  <span className="order__item-price tnum">{formatRub(selection.plan.priceRub)}</span>
                </p>
                <p className="order__item-note">
                  {until ? `Доступ до ${until}` : selection.plan.note}
                </p>
              </div>
            ) : (
              <p className="order__empty">
                Пока пусто. Выберите нейросеть и тариф — они появятся здесь.
              </p>
            )}
          </div>

          {/* Способ оплаты разворачивается, когда товар выбран. */}
          <div className="order__rest" ref={restRef}>
            <div>
              <div className="order__block" data-expand-item>
                <p className="order__label" id="sposob-oplaty">
                  Способ оплаты
                </p>
                {/* Три способа в строку вместо трёх строк с подписями:
                    так блок занимает втрое меньше высоты, а подпись
                    показывается только у выбранного. */}
                <div className="pays" role="group" aria-labelledby="sposob-oplaty">
                  {catalog.payments.map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      className={`pays__item${paymentId === method.id ? ' pays__item--active' : ''}`}
                      onClick={() => choosePayment(method.id)}
                      aria-pressed={paymentId === method.id}
                    >
                      {method.title}
                    </button>
                  ))}
                </div>
                <p className="order__pay-caption">
                  {payment ? payment.caption : 'Выберите, чем удобнее заплатить'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="order__foot">
          {selection && (
            <div className="order__total">
              <span className="order__total-label">Итого</span>
              <span ref={totalRef} className="order__total-value tnum">
                {formatRub(total)}
              </span>
            </div>
          )}

          {/* Пока бот не заведён, кнопка остаётся кнопкой, но никуда
              не ведёт и прямо говорит почему: ссылка в никуда хуже,
              чем честная надпись. */}
          {ready && botReady ? (
            <a className="order__cta" href={botHref} target="_blank" rel="noopener noreferrer">
              Перейти в бот
            </a>
          ) : (
            <button type="button" className="order__cta order__cta--off" disabled>
              {!selection ? 'Выберите тариф' : !ready ? 'Выберите способ оплаты' : 'Бот скоро откроется'}
            </button>
          )}

          <p className="order__fineprint">
            {botReady
              ? 'Регистрация, оплата и выдача доступа — в боте. На сайте ничего вводить не нужно.'
              : 'Регистрация, оплата и выдача доступа будут в Telegram-боте. Он готовится к запуску, на сайте вводить ничего не нужно.'}
          </p>
        </div>
      </div>
    </aside>
  );
}

/** Нижняя полоса для телефона. Та же логика, другая раскладка. */
export function OrderBar() {
  const catalog = getCatalog();
  const { selection, total, ready, botReady, botHref, paymentId, choosePayment } = useOrder();
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

        {ready && botReady ? (
          <a className="bar__cta" href={botHref} target="_blank" rel="noopener noreferrer">
            В бот
          </a>
        ) : (
          <button type="button" className="bar__cta bar__cta--off" disabled>
            {ready && !botReady ? 'Скоро' : 'В бот'}
          </button>
        )}
      </div>
    </div>
  );
}
