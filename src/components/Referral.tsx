'use client';

import { getCatalog } from '@/lib/catalog';
import { useMergedRefs, useParallax, useReveal } from '@/lib/motion';

export function Referral() {
  const { botUrl } = getCatalog();
  const botReady = botUrl.length > 0;
  const ref = useMergedRefs(useReveal<HTMLElement>({ stagger: 0.07 }), useParallax<HTMLElement>());

  return (
    <section className="referral" id="referalka" ref={ref}>
      <span className="referral__plate" data-reveal-plate aria-hidden="true" />

      <div className="referral__content" data-parallax="0.7">
        <h2 className="referral__title" data-reveal>
          Приводите своих
        </h2>
        <p className="referral__text" data-reveal>
          У каждого покупателя в боте есть личная ссылка. Друг покупает по ней — вам
          возвращается часть его оплаты, ему достаётся скидка на первый заказ.
          Начисления и вывод живут в боте, здесь ничего заводить не нужно.
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

        {/* Пока бота нет, звать «забрать ссылку» некуда. */}
        {botReady ? (
          <a className="referral__link" href={botUrl} target="_blank" rel="noopener noreferrer" data-reveal>
            Забрать свою ссылку
          </a>
        ) : (
          <p className="referral__soon" data-reveal>
            Ссылки раздаст бот — он готовится к запуску.
          </p>
        )}
      </div>
    </section>
  );
}
