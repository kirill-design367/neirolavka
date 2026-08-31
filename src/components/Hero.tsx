'use client';

import { Bubbles } from '@/components/Bubbles';
import { useMergedRefs, useParallax, useReveal } from '@/lib/motion';

const CHIPS = [
  { href: '#magazin', label: 'Магазин' },
  { href: '#otzyvy', label: 'Отзывы' },
  { href: '#referalka', label: 'Рефералка' },
];

export function Hero() {
  const revealRef = useReveal<HTMLElement>({ stagger: 0.06 });
  const parallaxRef = useParallax<HTMLElement>();
  const ref = useMergedRefs(revealRef, parallaxRef);

  return (
    <section className="hero" ref={ref}>
      {/* Пузыри лежат под содержимым первого экрана и мышь не ловят:
          попадание по ним ищется по координатам в самом компоненте. */}
      <Bubbles />

      <p className="hero__eyebrow" data-reveal>
        Лавка доступа к нейросетям
      </p>

      <h1 className="hero__title" data-reveal data-parallax="0.6">
        Нейролавка
      </h1>

      <p className="hero__lead" data-reveal>
        Доступ к Claude и ChatGPT без иностранной карты и без возни с зарубежной
        регистрацией. Выбираете тариф здесь, платите привычным способом, доступ
        приходит в Telegram.
      </p>

      {/* Условия лавки: три равные карточки под подзаголовком.
          Внутри каждой медленно ходит цветовая подложка, у каждой
          своя фаза — иначе три соседки пульсировали бы в такт. */}
      <dl className="terms" data-parallax="1.4">
        <div className="term" data-reveal>
          <span className="term__lava" aria-hidden="true" />
          <dt className="term__title">Цена видна сразу</dt>
          <dd className="term__text">Никаких «напишите в личку». Сколько показано, столько и платите.</dd>
        </div>
        <div className="term" data-reveal>
          <span className="term__lava" aria-hidden="true" />
          <dt className="term__title">Оплата привычная</dt>
          <dd className="term__text">Карта российского банка, СБП или USDT — на выбор.</dd>
        </div>
        <div className="term" data-reveal>
          <span className="term__lava" aria-hidden="true" />
          <dt className="term__title">Доступ в переписке</dt>
          <dd className="term__text">Аккаунт или ключ приходят в чат, и чат остаётся у вас.</dd>
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
