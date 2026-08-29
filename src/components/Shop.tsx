'use client';

import { getCatalog, formatPrice, type Product } from '@/lib/catalog';
import { useOrder } from '@/lib/order';
import { useExpand, useReveal } from '@/lib/motion';

function Shelf({ product }: { product: Product }) {
  const { openProductId, planId, toggleProduct, choosePlan } = useOrder();
  const soon = product.status === 'soon';
  const open = openProductId === product.id;
  const bodyRef = useExpand<HTMLDivElement>(open);
  const panelId = `polka-${product.id}`;

  return (
    <article className={`shelf${open ? ' shelf--open' : ''}${soon ? ' shelf--soon' : ''}`}>
      <span className="shelf__plate" data-reveal-plate aria-hidden="true" />

      <h3 className="shelf__heading">
        <button
          type="button"
          className="shelf__trigger"
          onClick={() => !soon && toggleProduct(product.id)}
          aria-expanded={open}
          aria-controls={panelId}
          disabled={soon}
          data-reveal
        >
          <span className="shelf__name">{product.name}</span>
          <span className="shelf__tagline">{product.tagline}</span>
          <span className="shelf__meta">
            {soon ? (
              <span className="shelf__soon">скоро</span>
            ) : (
              <>
                <span className="shelf__plan">{product.plan}</span>
                <span className="shelf__sign" aria-hidden="true" />
              </>
            )}
          </span>
        </button>
      </h3>

      {soon && <p className="shelf__soon-note">{product.soonNote}</p>}

      {/* Тарифы разворачиваются прямо из заголовка: высота едет с easing,
          содержимое проявляется следом. */}
      {/* inert на свёрнутой полке: высота ноль и прозрачность ноль прячут
          её от глаз, но не от клавиатуры — без этого человек уходил
          табуляцией в невидимые кнопки тарифов. */}
      <div
        className="shelf__body"
        id={panelId}
        ref={bodyRef}
        role="region"
        aria-label={`Тарифы ${product.name}`}
        inert={!open}
      >
        <div className="shelf__body-inner">
          {product.groups.map((group) => (
            <div className="group" key={group.id} data-expand-item>
              <div className="group__head">
                <h4 className="group__title">{group.title}</h4>
                <p className="group__caption">{group.caption}</p>
              </div>

              <ul className="group__list">
                {group.plans.map((plan) => {
                  const active = planId === plan.id;
                  return (
                    <li key={plan.id}>
                      <button
                        type="button"
                        className={`tariff${active ? ' tariff--active' : ''}`}
                        onClick={() => choosePlan(plan.id)}
                        aria-pressed={active}
                      >
                        <span className="tariff__short">{plan.short}</span>
                        <span className="tariff__note">{plan.note}</span>
                        <span className="tariff__price tnum">{formatPrice(plan.priceRub)}</span>
                        {plan.badge && <span className="tariff__badge">{plan.badge}</span>}
                        <span className="tariff__mark" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export function Shop() {
  const catalog = getCatalog();
  const ref = useReveal<HTMLElement>({ stagger: 0.08 });

  return (
    <section className="shop" id="magazin" ref={ref}>
      <div className="shop__head">
        <h2 className="shop__title" data-reveal>
          Что берём
        </h2>
        <p className="shop__hint" data-reveal>
          Тарифы раскрыты сразу: цену видно без лишних нажатий. Нажатие на нейросеть сворачивает её и разворачивает соседнюю.
        </p>
      </div>

      <div className="shop__shelves">
        {catalog.products.map((product) => (
          <Shelf key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
