'use client';

import { useMergedRefs, useParallax, useReveal, useStepTrack } from '@/lib/motion';

/** Покупка действительно идёт по шагам, поэтому нумерация здесь несёт смысл. */
const STEPS = [
  {
    n: '1',
    title: 'Выбираете здесь',
    text: 'Нейросеть, срок или пакет токенов, способ оплаты. Цена видна сразу и на последнем шаге не меняется.',
  },
  {
    n: '2',
    title: 'Платите в боте',
    text: 'Кнопка открывает Telegram с уже собранным заказом. Регистрация по номеру, оплата картой, через СБП или USDT.',
  },
  {
    n: '3',
    title: 'Получаете доступ',
    text: 'Данные аккаунта или ключ приходят в тот же чат. Если что-то не сходится — пишете туда же, переписка сохраняется.',
  },
];

export function Steps() {
  const ref = useMergedRefs(useReveal<HTMLElement>({ stagger: 0.08 }), useParallax<HTMLElement>());
  const trackRef = useStepTrack<HTMLOListElement>();

  return (
    <section className="steps" ref={ref}>
      <h2 className="steps__title" data-reveal>
        Как это устроено
      </h2>

      {/* Не три одинаковые карточки, а одна нить: шаги нанизаны на линию,
          и видно, что это последовательность, а не список свойств. */}
      <ol className="steps__thread" data-parallax="0.8" ref={trackRef}>
        {/* Дорожка и бегущая по ней точка. Разметка одна на весь блок:
            подсвеченный участок должен быть непрерывным, а не собранным
            из отрезков между соседними шагами. */}
        <span className="steps__track" aria-hidden="true">
          <span className="steps__track-fill" />
          {/* Две доли капли. Каждая — круг с обрезкой, внутри которого
              медленно ползает крупный яркий градиент: это и есть
              перелив сердцевины. Доли крутятся с разными периодами,
              поэтому их общий силуэт всё время меняется. */}
          <span className="steps__led">
            <span className="steps__led-lobe" />
            <span className="steps__led-lobe steps__led-lobe--b" />
          </span>
        </span>
        {STEPS.map((step) => (
          <li className="step" key={step.n}>
            <span className="step__node" aria-hidden="true">
              {/* Свечение — отдельный слой без текста: увеличивается
                  и гаснет оно. Сам узел загорается целиком — заливка,
                  обводка и цифра, — но не масштабируется: масштаб на
                  узле с текстом растянул бы готовый растр. */}
              <span className="step__halo" />
              <span className="step__num tnum">{step.n}</span>
            </span>
            <div className="step__body" data-reveal>
              <h3 className="step__title">{step.title}</h3>
              <p className="step__text">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="steps__note" data-reveal data-parallax="1.4">
        Сайт не хранит и не запрашивает ваши данные: здесь только витрина и калькулятор.
      </p>
    </section>
  );
}
