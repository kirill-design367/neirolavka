'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPrice, getCatalog, type Product } from '@/lib/catalog';
import { useOrder } from '@/lib/order';
import { prefersReducedMotion, useReveal } from '@/lib/motion';
import type { Shelf } from '@/lib/shelf-gl';

/**
 * Витрина: три карточки продуктов.
 *
 * Разметка здесь ПЛОСКАЯ и рабочая сама по себе — обычные карточки
 * с тарифами и кнопками. Объём добавляется поверх: когда блок
 * подъезжает к экрану, подключается `@/lib/shelf-gl`, ставит на
 * контейнер `data-3d` и начинает каждый кадр выдавать карточкам
 * матрицу из общей с тенями камеры.
 *
 * Порядок именно такой, а не наоборот. Без WebGL, при выключенном
 * движении или если сцена не поднялась — остаётся плоская витрина,
 * на которой можно выбрать тариф. Возможность купить важнее эффекта.
 */

function Card({
  product,
  index,
  active,
  onSelect,
  onHover,
  cardRef,
}: {
  product: Product;
  index: number;
  active: boolean;
  onSelect: () => void;
  onHover: (i: number) => void;
  cardRef: (el: HTMLElement | null) => void;
}) {
  const { planId, choosePlan } = useOrder();
  const from = product.plans.reduce((a, p) => Math.min(a, p.priceRub), Infinity);

  return (
    <article
      className={`pcard${active ? ' pcard--active' : ''}`}
      ref={cardRef}
      onPointerEnter={() => onHover(index)}
      onPointerLeave={() => onHover(-1)}
      onFocusCapture={() => onHover(index)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) onHover(-1);
      }}
    >
      <button
        type="button"
        className="pcard__face"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={`Выбрать ${product.name}`}
      >
        <span className="pcard__name">{product.name}</span>
        <span className="pcard__tag">{product.tagline}</span>
        <span className="pcard__note">{product.note}</span>
        {!active && (
          <span className="pcard__from">
            от <span className="tnum">{formatPrice(from)}</span>
          </span>
        )}
      </button>

      {/* Тарифы раскрыты только у выбранной карточки. У свёрнутых они
          не просто спрятаны, а изъяты из обхода: иначе табуляция
          уходила бы в невидимые кнопки. */}
      <div className="pcard__plans" hidden={!active}>
        {product.plans.map((plan) => (
          <button
            key={plan.id}
            type="button"
            className={`tariff${planId === plan.id ? ' tariff--active' : ''}`}
            onClick={() => choosePlan(plan.id)}
            aria-pressed={planId === plan.id}
          >
            <span className="tariff__short">{plan.short}</span>
            <span className="tariff__note">{plan.note}</span>
            <span className="tariff__price tnum">{formatPrice(plan.priceRub)}</span>
            <span className="tariff__mark" aria-hidden="true" />
          </button>
        ))}
        {product.plans.length === 1 && (
          <p className="pcard__single">Годового тарифа у этого продукта нет.</p>
        )}
      </div>
    </article>
  );
}

export function Shop() {
  const catalog = getCatalog();
  const { openProductId, chooseProduct, planId } = useOrder();
  const headRef = useReveal<HTMLDivElement>({ stagger: 0.08 });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cardEls = useRef<(HTMLElement | null)[]>([]);
  const shelfRef = useRef<Shelf | null>(null);
  const [hover, setHover] = useState(-1);

  const activeIndex = Math.max(0, catalog.products.findIndex((p) => p.id === openProductId));

  // Выбранная карточка живёт в ref, а не только в замыкании эффекта.
  //
  // Это не удобство, а условие: сцену поднимает эффект, и всё, что
  // попадёт в его список зависимостей, будет РАЗБИРАТЬ И СОБИРАТЬ ЕЁ
  // ЗАНОВО при каждом изменении. Пока в списке стоял activeIndex,
  // нажатие по карточке снимало data-3d, показывало плоскую вёрстку
  // всеми тремя карточками в ряд и поднимало сцену заново с нуля.
  const activeRef = useRef(activeIndex);
  activeRef.current = activeIndex;

  const setCard = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      cardEls.current[i] = el;
    },
    [],
  );

  // ─── Объём поверх плоской витрины ─────────────────────────────
  useEffect(() => {
    const root: HTMLDivElement | null = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas || prefersReducedMotion()) return;
    const box = root;

    let cancelled = false;
    let io: IntersectionObserver | null = null;

    const start = async () => {
      if (cancelled) return;
      try {
        const mod = await import('@/lib/shelf-gl');
        if (cancelled) return;
        const cards = cardEls.current.filter(Boolean) as HTMLElement[];
        if (cards.length !== catalog.products.length) return;
        const shelf = mod.mount(root, canvas, cards);
        if (!shelf) return; // WebGL не поднялся — остаётся плоская витрина
        shelfRef.current = shelf;
        root.setAttribute('data-3d', '');
        shelf.setActive(activeRef.current);
      } catch {
        /* остаётся плоская витрина */
      }
    };

    // Два условия, и оба обязательны.
    //
    // Первое — человек что-то сделал. Three.js весит 522 КБ разбора,
    // и грузить его в тишине значит платить отзывчивостью за то, чего
    // никто не смотрит. Это та же схема, что у пузырей, и кусок у них
    // общий: к моменту, когда витрина понадобится, он обычно уже здесь.
    //
    // Второе — блок подъехал к экрану. Витрина лежит ниже сгиба,
    // и поднимать сцену, пока до неё не долистали, незачем.
    const EVENTS = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown', 'scroll'];
    const off = () => EVENTS.forEach((e) => window.removeEventListener(e, armed));
    function armed() {
      off();
      if (cancelled) return;
      io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          io = null;
          void start();
        },
        { rootMargin: '300px' },
      );
      io.observe(box);
    }
    EVENTS.forEach((e) => window.addEventListener(e, armed, { passive: true }));

    return () => {
      cancelled = true;
      off();
      io?.disconnect();
      shelfRef.current?.dispose();
      shelfRef.current = null;
      root.removeAttribute('data-3d');
    };
    // Список зависимостей здесь — часть устройства, а не формальность.
    // Сцена поднимается ОДИН раз на жизнь компонента; всё, что меняется
    // от нажатий (выбор продукта, наведение, раскрытые тарифы),
    // доезжает до неё отдельными эффектами ниже, через ref на живой
    // объект. Добавить сюда любое меняющееся значение — значит вернуть
    // разбор и сборку сцены на каждое нажатие.
  }, [catalog.products.length]);

  useEffect(() => { shelfRef.current?.setActive(activeIndex); }, [activeIndex]);
  useEffect(() => { shelfRef.current?.setHover(hover); }, [hover]);
  // Раскрытые тарифы меняют высоту карточки — сцене нужно пересчитать
  // и тени, и раскладку.
  useEffect(() => { shelfRef.current?.refresh(); }, [activeIndex, planId]);

  return (
    <section className="shop" id="magazin">
      <div className="shop__head" ref={headRef}>
        <h2 className="shop__title" data-reveal>
          Что берём
        </h2>
        <p className="shop__hint" data-reveal>
          Три продукта на полке. Нажатие разворачивает карточку и показывает сроки
          с ценами — цена видна до перехода в бот, а не после.
        </p>
      </div>

      <div className="shelf3d" ref={rootRef}>
        {/* Тени сцены. Слой лежит под карточками и мышь не ловит. */}
        <canvas className="shelf3d__gl" ref={canvasRef} aria-hidden="true" />
        <div className="shelf3d__camera">
          {catalog.products.map((product, i) => (
            <Card
              key={product.id}
              product={product}
              index={i}
              active={i === activeIndex}
              onSelect={() => chooseProduct(product.id)}
              onHover={setHover}
              cardRef={setCard(i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
