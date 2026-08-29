'use client';

import { useReveal } from '@/lib/motion';

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
  const ref = useReveal<HTMLElement>({ stagger: 0.08 });

  return (
    <section className="steps" ref={ref}>
      <h2 className="steps__title" data-reveal>
        Как это устроено
      </h2>

      {/* Не три одинаковые карточки, а одна нить: шаги нанизаны на линию,
          и видно, что это последовательность, а не список свойств. */}
      <ol className="steps__thread">
        {STEPS.map((step) => (
          <li className="step" key={step.n}>
            <span className="step__node" aria-hidden="true">
              <span className="step__num tnum">{step.n}</span>
            </span>
            <div className="step__body" data-reveal>
              <h3 className="step__title">{step.title}</h3>
              <p className="step__text">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="steps__note" data-reveal>
        Сайт не хранит и не запрашивает ваши данные: здесь только витрина и калькулятор.
      </p>
    </section>
  );
}
