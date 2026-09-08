'use client';

import { useCallback } from 'react';
import { getCatalog } from '@/lib/catalog';
import { useOrder } from '@/lib/order';
import { useCountUp, useExpand } from '@/lib/motion';

const formatRub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;

/**
 * Панель заказа — она же чек.
 *
 * Сайт ничего не обрабатывает: он собирает чек и уводит в бот.
 * Ни полей ввода, ни персональных данных.
 *
 * Выбранный тариф пока НЕ уезжает в бот параметром ссылки: бот эту
 * строку не читает. Машинка для неё лежит в `useOrder` за флагом
 * `botStartPayload` — см. пояснение у флага в catalog.ts.
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
  const { selection, payment, paymentId, total, priceKnown, ready, botReady, botHref, choosePayment } = useOrder();
  const totalRef = useCountUp(total, useCallback(formatRub, []));
  const restRef = useExpand<HTMLDivElement>(Boolean(selection));

  // Строки «Доступ до <дата>» здесь больше нет, и это не потеря.
  // Она считалась из срока тарифа, а тарифом теперь называется
  // УРОВЕНЬ подписки, не срок. Срок владелец не объявлял, и вывести
  // дату не из чего — выдуманная дата в чеке хуже отсутствующей.

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
                  <span className="order__item-name">
                    {selection.plan ? selection.plan.title : selection.product.name}
                  </span>
                  <span className="order__leader" aria-hidden="true" />
                  <span className={`order__item-price${priceKnown ? ' tnum' : ' order__item-price--soon'}`}>
                    {priceKnown ? formatRub(total) : 'уточняется'}
                  </span>
                </p>
                <p className="order__item-note">
                  {selection.plan?.note ?? selection.product.tagline}
                </p>
              </div>
            ) : (
              <p className="order__empty">
                Пока пусто. Выберите нейросеть и уровень подписки — они появятся здесь.
              </p>
            )}
          </div>

          {/* Способ оплаты разворачивается, когда товар выбран. */}
          <div className="order__rest" ref={restRef} inert={!selection}>
            <div>
              <div className="order__block" data-expand-item>
                <p className="order__label" id="sposob-oplaty">
                  Способ оплаты
                </p>
                {/* Способы в строку вместо строки на каждый:
                    так блок занимает втрое меньше высоты, а подпись
                    показывается только у выбранного. Сколько их —
                    решает каталог, ряд делится поровну между теми,
                    что пришли. */}
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
                  {payment ? payment.caption : 'Выберите, чем привычнее заплатить'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="order__foot">
          {selection && (
            <div className="order__total">
              <span className="order__total-label">Итого</span>
              {/* Ноль вместо неизвестной цены — это не «пока пусто»,
                  а «бесплатно». Пока прайса нет, в итоге стоит слово,
                  а не число, и добегающий счётчик к нему не цепляется. */}
              {priceKnown ? (
                <span ref={totalRef} className="order__total-value tnum">
                  {formatRub(total)}
                </span>
              ) : (
                <span className="order__total-value order__total-value--soon">уточняется</span>
              )}
            </div>
          )}

          {/* Пока бот не заведён, кнопка остаётся кнопкой, но никуда
              не ведёт и прямо говорит почему: ссылка в никуда хуже,
              чем честная надпись. Сейчас бот работает, и эта ветка
              остаётся на случай, если адрес когда-нибудь снова
              опустеет. */}
          {ready && botReady ? (
            <a className="order__cta" href={botHref} target="_blank" rel="noopener noreferrer">
              Перейти в бот
            </a>
          ) : (
            <button type="button" className="order__cta order__cta--off" disabled>
              {!selection ? 'Выберите подписку' : !ready ? 'Выберите способ оплаты' : 'Бот скоро откроется'}
            </button>
          )}

          <p className="order__fineprint">
            {/* Про оплату сказано ровно то, что есть. В боте она пока
                не автоматическая: заказ записывается, а как заплатить —
                администратор пишет в тот же чат. Обещать здесь кнопку
                оплаты значит обещать то, чего в боте нет. */}
            {botReady
              ? 'Оплачиваете выбранный тариф на сайте. Логин и пароль приходят в Telegram. В рабочее время (8:00–22:00 МСК) это занимает 5–30 минут. Если заказываете ночью — с утра обработаем первым делом. Если что-то не работает — пишите в чат поддержки в Telegram, решим проблему или вернём деньги.'
              : 'Регистрация, заказ и выдача доступа будут в Telegram-боте. Он готовится к запуску, на сайте вводить ничего не нужно.'}
          </p>
        </div>
      </div>
    </aside>
  );
}

/** Нижняя полоса для телефона. Та же логика, другая раскладка. */
export function OrderBar() {
  const catalog = getCatalog();
  const { selection, total, priceKnown, ready, botReady, botHref, paymentId, choosePayment } = useOrder();
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
              <p className="bar__name">
                {selection.plan ? selection.plan.title : selection.product.name}
              </p>
              {priceKnown ? (
                <p ref={totalRef} className="bar__total tnum">
                  {formatRub(total)}
                </p>
              ) : (
                <p className="bar__total bar__total--soon">Цена уточняется</p>
              )}
            </>
          ) : (
            <p className="bar__empty">Выберите нейросеть и уровень</p>
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
