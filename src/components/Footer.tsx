'use client';

import { getCatalog } from '@/lib/catalog';
import { useReveal } from '@/lib/motion';

export function Footer() {
  const { reviews, reviewsArePlaceholders } = getCatalog();
  const ref = useReveal<HTMLElement>({ stagger: 0.06 });

  return (
    <footer className="footer" id="otzyvy" ref={ref}>
      <div className="page">
        <div className="footer__head">
          <h2 className="footer__title" data-reveal>
            Что пишут
          </h2>
          {reviewsArePlaceholders && (
            <p className="footer__disclaimer" data-reveal>
              Примеры оформления блока.
            </p>
          )}
        </div>

        <ul className="reviews">
          {reviews.map((review) => (
            <li className="review" key={review.id}>
              <span className="review__plate" data-reveal-plate aria-hidden="true" />
              <blockquote className="review__text" data-reveal>
                {review.text}
              </blockquote>
              <p className="review__author" data-reveal>
                <span className="review__name">{review.author}</span>
                <span className="review__bought">{review.bought}</span>
              </p>
            </li>
          ))}
        </ul>

        <div className="footer__bottom">
          <p className="footer__brand">Нейролавка</p>
          <p className="footer__legal">
            Витрина и калькулятор. Оплата, выдача доступа и поддержка — в Telegram-боте.
          </p>
        </div>
      </div>
    </footer>
  );
}
