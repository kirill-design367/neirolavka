'use client';

import { getCatalog } from '@/lib/catalog';
import { useMergedRefs, useParallax, useReveal } from '@/lib/motion';

export function Referral() {
  const { botUrl, referralReady } = getCatalog();
  const gotova = referralReady && botUrl.length > 0;
  const ref = useMergedRefs(useReveal<HTMLElement>({ stagger: 0.07 }), useParallax<HTMLElement>());

  return (
    <section className="referral" id="referalka" ref={ref}>
      <span className="referral__plate" data-reveal-plate aria-hidden="true" />
      {/* Свет из-за плашки — отдельным слоем: он не должен
          вращаться вместе с пятнами перелива. */}
      <span className="referral__glow" aria-hidden="true" />

      <div className="referral__content" data-parallax="0.7">
        <h2 className="referral__title" data-reveal>
          Приводите своих
        </h2>
        {/* Программы в боте пока нет вовсе, и текст об этом говорит
            прямо. Написать «у каждого покупателя есть личная ссылка»
            в настоящем времени значило бы пообещать то, чего нет. */}
        <p className="referral__text" data-reveal>
          {gotova
            ? 'У каждого покупателя в боте есть личная ссылка. Друг покупает по ней — вам возвращается часть его оплаты, ему достаётся скидка на первый заказ. Начисления и вывод живут в боте, здесь ничего заводить не нужно.'
            : 'Задумано так: у каждого покупателя появится в боте личная ссылка. Друг покупает по ней — вам возвращается часть его оплаты, ему достаётся скидка на первый заказ. В боте этой программы пока нет, и обещать её сроком мы не будем.'}
        </p>

        <dl className="referral__facts" data-parallax="1.4">
          <div className="fact" data-reveal>
            <dt className="fact__label">Кому ссылка</dt>
            <dd className="fact__value">Всем, кто уже покупал</dd>
          </div>
          <div className="fact" data-reveal>
            <dt className="fact__label">Когда начисляется</dt>
            <dd className="fact__value">После оплаты друга</dd>
          </div>
          <div className="fact" data-reveal>
            <dt className="fact__label">Где смотреть</dt>
            <dd className="fact__value">В том же чате</dd>
          </div>
        </dl>

        {/* Звать «забрать ссылку» некуда, пока реферальной программы
            в боте нет: это была бы не заглушка, а обещание. Сам бот
            при этом работает — про него сказано в чеке и в шагах. */}
        {gotova ? (
          <a className="referral__link" href={botUrl} target="_blank" rel="noopener noreferrer" data-reveal>
            Забрать свою ссылку
          </a>
        ) : (
          <p className="referral__soon" data-reveal>
            Бот уже работает — заказ можно оформить прямо сейчас.
            Реферальные ссылки в нём ещё готовятся.
          </p>
        )}
      </div>
    </section>
  );
}
