'use client';

import { useCallback, useId, useState } from 'react';
import { getCatalog } from '@/lib/catalog';
import { useOrder } from '@/lib/order';
import { PREDEL_KODA } from '@/lib/promokod';
import { useCountUp, useExpand } from '@/lib/motion';

/* Копейки печатаются, только если они есть, — теми же правилами,
   что у `rubli` в боте. Десять процентов от 1 399 ₽ это 139,90,
   и «139,9 ₽» в чеке читается опечаткой. */
const formatRub = (n: number) =>
  `${n.toLocaleString('ru-RU', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;

/**
 * Поле промокода — В ОДНОМ РЯДУ С ЧИПАМИ ОПЛАТЫ.
 *
 * Раньше оно стояло отдельной строкой под подписью способа оплаты,
 * то есть в самом низу прокручиваемой части чека, — а цена и строка
 * скидки живут наверху, в блоке «Товар». Получалось, что человек
 * листает вниз, чтобы набрать код, и обратно вверх, чтобы увидеть,
 * что скидка засчиталась. Владелец на это и пожаловался.
 *
 * Теперь это третий предмет того же ряда: «Карта РФ», «СБП»,
 * промокод. Ряд и без того был вдвое шире, чем нужно двум чипам
 * (`flex: 1 1 0` делит его поровну, а слов в чипах на две трети
 * меньше), так что место взято из запаса, а не отнято у высоты.
 * Строка под чеком стала на один ряд короче — и ввод, цена, скидка
 * и итог помещаются в кадр одновременно.
 *
 * Три состояния, и все три — ОДИН предмет ряда, а не разная высота:
 *   • свёрнутое: чип «+ Промокод». Плюс, а не просто слово, чтобы
 *     чип не читался третьим способом оплаты;
 *   • открытое: поле ввода и квадратная кнопка со стрелкой. Кнопка
 *     квадратная не из любви к иконкам: «Применить» словом отнимает
 *     у чипов оплаты семьдесят пикселей, и «Карта РФ» перестаёт
 *     помещаться в свой чип;
 *   • применённое: чип с кодом, размером скидки и крестиком.
 *
 * Проверяется код ПО КНОПКЕ (или по Enter), а не на каждую букву:
 * у проверки предел частоты в nginx, и «не подошёл» на середине
 * набора читается отказом, хотя человек ещё печатает.
 */
function PromoPole({ compact = false }: { compact?: boolean }) {
  const { promo, primenitPromo, ubratPromo } = useOrder();
  const [otkryto, setOtkryto] = useState(false);
  const [vvod, setVvod] = useState('');
  const id = useId();

  const klass = `promo${compact ? ' promo--bar' : ''}`;

  if (promo.vid === 'godit') {
    return (
      <div className={`${klass} promo--est`}>
        <span className="promo__kod">{promo.kod}</span>
        <span className="promo__skidka tnum">−{promo.skidkaProc}&nbsp;%</span>
        <button
          type="button"
          className="promo__ubrat"
          aria-label={`Убрать промокод ${promo.kod}`}
          title="Убрать промокод"
          onClick={() => {
            setVvod('');
            setOtkryto(false);
            ubratPromo();
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    );
  }

  if (!otkryto) {
    return (
      <div className={klass}>
        <button type="button" className="promo__zvat" onClick={() => setOtkryto(true)}>
          <span className="promo__plus" aria-hidden="true">
            +
          </span>
          Промокод
        </button>
      </div>
    );
  }

  return (
    <div className={`${klass} promo--vvod`}>
      <input
        id={id}
        className="promo__vvod"
        type="text"
        aria-label="Промокод"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={PREDEL_KODA}
        value={vvod}
        placeholder="LETO25"
        autoFocus
        onChange={(e) => setVvod(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            primenitPromo(vvod);
          }
        }}
      />
      <button
        type="button"
        className="promo__knopka"
        aria-label="Применить промокод"
        title="Применить промокод"
        onClick={() => primenitPromo(vvod)}
        disabled={promo.vid === 'proveryaem' || vvod.trim().length === 0}
      >
        <span aria-hidden="true">{promo.vid === 'proveryaem' ? '…' : '→'}</span>
      </button>
    </div>
  );
}

/**
 * Ответ на введённый код — ОТДЕЛЬНОЙ строкой под рядом.
 *
 * Внутри самого поля ему места нет: поле теперь предмет ряда,
 * а не блок, и абзац внутри него разорвал бы ряд надвое. Строка
 * появляется только тогда, когда есть что сказать, поэтому в обычном
 * случае она ничего не занимает.
 *
 * Отказ объясняется СЛОВАМИ: «не подошёл» без причины заставляет
 * набрать код ещё раз, чтобы получить тот же ответ.
 */
function PromoOtvet() {
  const { promo, skidka, priceKnown } = useOrder();

  if (promo.vid === 'ne_podoshel') return <p className="promo__otvet">{promo.soobshchenie}</p>;
  if (promo.vid === 'ne_proverili') {
    return (
      <p className="promo__otvet promo__otvet--tiho">
        Не удалось проверить код прямо сейчас — он поедет в бот, и скидку посчитает он.
      </p>
    );
  }
  /* Цены нет — и скидку считать не от чего. Молча показать ноль
     значило бы выдать «мы не знаем» за «выгоды нет». */
  if (promo.vid === 'godit' && !priceKnown) {
    return (
      <p className="promo__otvet promo__otvet--tiho">
        Цена этого уровня ещё не объявлена — скидка посчитается, когда она появится.
      </p>
    );
  }
  if (promo.vid === 'godit' && skidka <= 0) {
    return <p className="promo__otvet promo__otvet--tiho">Скидка появится вместе с ценой.</p>;
  }
  return null;
}

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
  const { selection, payment, paymentId, total, priceKnown, ready, botReady, botHref, choosePayment,
          promo, skidka, kOplate } = useOrder();
  const totalRef = useCountUp(kOplate, useCallback(formatRub, []));
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
                {/* СТРОКА СКИДКИ ОТДЕЛЬНАЯ, а не подменяет цену.
                    Один итог не отличается от «цена такая и была»:
                    человек должен увидеть, что промокод сработал
                    и на сколько. */}
                {promo.vid === 'godit' && skidka > 0 && (
                  <p className="order__item-row order__item-row--skidka">
                    <span className="order__item-name">Промокод {promo.kod}</span>
                    <span className="order__leader" aria-hidden="true" />
                    <span className="order__item-price tnum">−{formatRub(skidka)}</span>
                  </p>
                )}
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
                    что пришли.

                    ПРОМОКОД СТОИТ В ТОМ ЖЕ РЯДУ, но СНАРУЖИ группы
                    способов оплаты: внутри `role="group"` с подписью
                    «Способ оплаты» он назывался бы скринридеру третьим
                    способом заплатить. Ряд общий, группа прежняя. */}
                <div className="payrow">
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
                  <PromoPole />
                </div>
                <p className="order__pay-caption">
                  {payment ? payment.caption : 'Выберите, чем привычнее заплатить'}
                </p>
                {/* Ответ про код — ПОСЛЕ подписи способа оплаты, а не
                    между нею и чипами. Подпись объясняет выбранный
                    способ («Любой российский банк»), и вклиненная
                    между ними строка про промокод разрывала эту пару,
                    а сама начинала читаться примечанием ко всему ряду
                    сразу. До переезда поля порядок был ровно такой же:
                    чипы, подпись, промокод. */}
                <PromoOtvet />
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
                  {formatRub(kOplate)}
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
  const { selection, total, priceKnown, ready, botReady, botHref, paymentId, choosePayment,
          promo, skidka, kOplate } = useOrder();
  const totalRef = useCountUp<HTMLSpanElement>(kOplate, useCallback(formatRub, []));

  return (
    <div className="bar" aria-label="Заказ">
      {/* Поле промокода есть и на телефоне: панель чека там
          не показывается вовсе, и без него половина покупателей
          не смогла бы применить код. Стоит в ТОМ ЖЕ ряду, что
          и чипы оплаты, — полоса и так занимает низ экрана,
          и третий ряд отнимал бы у страницы ещё одну строку. */}
      {selection && (
        <div className="payrow payrow--bar">
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
          <PromoPole compact />
        </div>
      )}
      {selection && <PromoOtvet />}

      <div className="bar__row">
        <div className="bar__info">
          {selection ? (
            <>
              <p className="bar__name">
                {selection.plan ? selection.plan.title : selection.product.name}
              </p>
              {priceKnown ? (
                /* ЗАЧЁРКНУТАЯ ЦЕНА — СОСЕД СЧЁТЧИКА, А НЕ ЕГО РЕБЁНОК.
                   `useCountUp` пишет в узел `textContent`, то есть
                   сносит всех его детей разом; React о сносе не знает
                   и при следующей отрисовке падает на removeChild —
                   а вместе с ним пропадает весь чек. Это уже случилось
                   ровно здесь. */
                <p className="bar__total">
                  <span ref={totalRef} className="bar__summa tnum">
                    {formatRub(kOplate)}
                  </span>
                  {promo.vid === 'godit' && skidka > 0 && (
                    <span className="bar__bylo tnum">{formatRub(total)}</span>
                  )}
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
