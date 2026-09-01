'use client';

import type { Review } from '@/lib/catalog';
import { getCatalog } from '@/lib/catalog';
import { useMergedRefs, useParallax, useReveal } from '@/lib/motion';

/** Одна карточка ленты.
 *
 *  `dubl` — вторая копия ленты. У неё нет ни разметки появления,
 *  ни голоса для скринридера: это тот же самый отзыв, показанный
 *  второй раз ради бесшовного стыка, а не ещё один отзыв. */
function ReviewCard({ review, dubl }: { review: Review; dubl?: boolean }) {
  return (
    <li className="review" aria-hidden={dubl || undefined}>
      <span className="review__plate" data-reveal-plate={dubl ? undefined : ''} aria-hidden="true" />
      <blockquote className="review__text" data-reveal={dubl ? undefined : ''}>
        {review.text}
      </blockquote>
      <p className="review__author" data-reveal={dubl ? undefined : ''}>
        <span className="review__name">{review.author}</span>
        <span className="review__bought">{review.bought}</span>
      </p>
    </li>
  );
}

export function Footer() {
  const { reviews } = getCatalog();
  const ref = useMergedRefs(useReveal<HTMLElement>({ stagger: 0.06 }), useParallax<HTMLElement>());

  return (
    <footer className="footer" id="otzyvy" ref={ref}>
      <div className="page">
        <div className="footer__head" data-parallax="1.2">
          <h2 className="footer__title" data-reveal>
            Что пишут
          </h2>
        </div>

        {/* Окно ленты. Отзывы идут бегущей строкой, и лента набрана
            ДВАЖДЫ: пока первая копия уезжает влево, вторая занимает
            её место, и в тот миг, когда сдвиг доходит ровно до половины
            дорожки, картинка совпадает сама с собой. Стык поэтому
            не виден вовсе — его негде увидеть.

            data-lenis-scrollable, а не data-lenis-prevent: при
            выключенном движении лента становится обычной
            прокручиваемой полосой, и колесо над ней должно доставаться
            ей, а не странице. Атрибут prevent учитывался бы всегда,
            в том числе когда прокручивать нечего. */}
        <div className="reviews" data-lenis-scrollable>
          <ul className="reviews__track">
            {reviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
            {reviews.map((review) => (
              <ReviewCard key={`${review.id}-2`} review={review} dubl />
            ))}
          </ul>
        </div>

        <div className="footer__bottom">
          <p className="footer__brand">Нейролавка</p>
          <p className="footer__legal">
            Заказ, выдача доступа и поддержка — в Telegram-боте; про оплату там
            напишет администратор.
          </p>
        </div>
      </div>
    </footer>
  );
}
