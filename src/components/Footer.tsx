'use client';

import type { Review } from '@/lib/catalog';
import { getCatalog } from '@/lib/catalog';
import { useMergedRefs, useParallax, useReveal } from '@/lib/motion';
import { getProdavec, zhivyeDokumenty } from '@/lib/prodavec';

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

/**
 * Низ подвала: кто продаёт и как с ним связаться.
 *
 * Три группы, и порядок в них не случайный: сначала чьё это,
 * потом кто отвечает по закону, потом куда писать. Человек, дошедший
 * до подвала перед оплатой, ищет именно третье, поэтому контакты
 * стоят последними — ближе всего к тому месту, докуда он долистал.
 *
 * ССЫЛКИ НА ДОКУМЕНТЫ ПОКАЗЫВАЮТСЯ, ТОЛЬКО ЕСЛИ СТРАНИЦА ЕСТЬ.
 * Ссылка из подвала на несуществующую оферту — это 404 на месте
 * договора, ровно перед тем, как человек отдаст деньги; отсутствующая
 * ссылка честнее битой. Какие документы живы, решает `prodavec.ts`.
 */
function FooterBottom() {
  const p = getProdavec();
  const dokumenty = zhivyeDokumenty();

  return (
    <div className="footer__bottom">
      <div className="footer__col">
        <p className="footer__brand">Нейролавка</p>
        <p className="footer__legal">
          Заказ, выдача доступа и поддержка — в Telegram-боте; про оплату там
          напишет администратор.
        </p>
      </div>

      <div className="footer__col">
        <p className="footer__seller">{p.imya}</p>
        {/* Список определений, а не абзац: «ИНН» — это подпись
            к числу, и связь между ними должна быть видна не только
            глазом, но и скринридеру. */}
        <dl className="footer__req">
          <div className="footer__req-row">
            <dt>ИНН</dt>
            <dd className="tnum">{p.inn}</dd>
          </div>
          <div className="footer__req-row">
            <dt>ОГРНИП</dt>
            <dd className="tnum">{p.ogrnip}</dd>
          </div>
        </dl>
      </div>

      <div className="footer__col">
        <ul className="footer__contacts">
          <li>
            {/* Номер для набора считается из видимого и содержит
                только плюс и цифры: часть набиралок спотыкается
                на пробелах и дефисах. */}
            <a className="footer__link tnum" href={`tel:${p.telefon.dlyaNabora}`}>
              {p.telefon.vidimyy}
            </a>
          </li>
          <li>
            <a className="footer__link" href={`mailto:${p.pochta}`}>
              {p.pochta}
            </a>
          </li>
        </ul>

        {dokumenty.length > 0 && (
          <ul className="footer__contacts footer__contacts--docs">
            {dokumenty.map((d) => (
              <li key={d.put}>
                <a className="footer__link" href={d.put}>
                  {d.nazvanie}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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

        <FooterBottom />
      </div>
    </footer>
  );
}
