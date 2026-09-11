'use client';

import { useMergedRefs, useParallax, useReveal } from '@/lib/motion';

const CHIPS = [
  { href: '#magazin', label: 'Магазин' },
  { href: '#otzyvy', label: 'Отзывы' },
];

export function Hero() {
  const revealRef = useReveal<HTMLElement>({ stagger: 0.06 });
  const parallaxRef = useParallax<HTMLElement>();
  const ref = useMergedRefs(revealRef, parallaxRef);

  return (
    <section className="hero" ref={ref}>
      <p className="hero__eyebrow" data-reveal>
        Лавка доступа к нейросетям
      </p>

      <h1 className="hero__title" data-reveal data-parallax="0.6">
        Нейролавка
      </h1>

      <p className="hero__lead" data-reveal>
        Доступ к нейросетям без иностранной карты. Платите рублями и получайте
        доступ. Безопасная оплата и гарантия возврата денег при потере аккаунта.
      </p>

      {/* Условия лавки: три равные карточки под подзаголовком.
          Стоят на тёмной зелени --c-deep, подвижной подложки внутри
          нет намеренно: цвет, который всё время едет, не бывает
          «тем же самым». Тексты утверждает владелец — здесь они
          стоят слово в слово так, как он их прислал. */}
      <dl className="terms" data-parallax="1.4">
        <div className="term" data-reveal>
          <dt className="term__title">Цена видна сразу</dt>
          <dd className="term__text">
            Сколько показано на сайте, столько и платите. Никаких «напишите в личку»
            и доплат в последний момент.
          </dd>
        </div>
        <div className="term" data-reveal>
          <dt className="term__title">Оплата как в обычном магазине</dt>
          <dd className="term__text">
            Карта российского банка или СБП — прямо на сайте, через защищённый
            платёжный шлюз. Данные карт не сохраняем.
          </dd>
        </div>
        <div className="term" data-reveal>
          <dt className="term__title">Гарантия, а не обещания</dt>
          <dd className="term__text">
            Подписка не активировалась или что-то пошло не так — вернём деньги.
            Вся история заказа и поддержка — в чате в Telegram.
          </dd>
        </div>
      </dl>

      {/* На телефоне разделы вынесены сюда: в липкой шапке им не хватает места,
          а прятать их за бургер ради трёх ссылок — лишний шаг. */}
      <nav className="hero__chips" aria-label="Разделы страницы">
        {CHIPS.map((chip) => (
          <a key={chip.href} href={chip.href} className="hero__chip">
            {chip.label}
          </a>
        ))}
      </nav>
    </section>
  );
}
