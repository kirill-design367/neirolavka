'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

/** На сервере useLayoutEffect шумит в консоль — там берём useEffect. */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Инерционная прокрутка. Поднимается в layout-эффекте, а не по window.load:
 * к моменту первого кадра Lenis уже управляет прокруткой, и страница
 * не успевает проскроллиться «рывком» нативно.
 *
 * Один такт: GSAP-тикер крутит Lenis, ScrollTrigger обновляется на событии
 * прокрутки Lenis. Отдельного requestAnimationFrame нет — два независимых
 * цикла и есть причина дрожания и отставания триггеров.
 */
export function SmoothScroll() {
  useIsomorphicLayoutEffect(() => {
    if (prefersReducedMotion()) return;

    const lenis = new Lenis({
      duration: 1.05,
      smoothWheel: true,
      // Тач оставляем нативным: на телефоне сглаживание только мешает
      // и стоит кадров.
      syncTouch: false,
touchMultiplier: 1.6,
    });

    const raf = (time: number) => lenis.raf(time * 1000); // тикер даёт секунды, Lenis ждёт миллисекунды
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    // Якорные ссылки должны ехать через Lenis, иначе нативный прыжок
    // по хешу конфликтует со сглаживанием.
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest?.('a[href^="#"]');
      if (!(link instanceof HTMLAnchorElement)) return;
      const id = link.getAttribute('href');
      if (!id || id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      lenis.scrollTo(target as HTMLElement, { offset: -88 });
    };
    document.addEventListener('click', onClick);

    return () => {
      document.removeEventListener('click', onClick);
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, []);

  return null;
}

type RevealOptions = {
  /** Задержка между соседними элементами внутри одного блока. */
  stagger?: number;
  /** Сдвиг снизу в пикселях. */
  y?: number;
  start?: string;
};

/**
 * Появление по прокрутке.
 *
 * Важное правило проекта: текст никогда не масштабируется — браузер тянет
 * уже отрисованный растр и буквы плывут. Поэтому масштаб получает только
 * подложка блока (элемент с data-reveal-plate, внутри которого нет текста),
 * а текстовые слои едут по y и проявляются.
 */
export function useReveal<T extends HTMLElement>(options: RevealOptions = {}) {
  const ref = useRef<T | null>(null);
  const { stagger = 0.07, y = 22, start = 'top 88%' } = options;

  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const plates = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal-plate]'));
    if (!items.length && !plates.length) return;

    if (prefersReducedMotion()) {
      // Движение выключено — просто ставим конечное состояние.
      gsap.set([...items, ...plates], { opacity: 1, y: 0, scale: 1, clearProps: 'transform' });
      return;
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: { trigger: root, start, once: true },
        defaults: { ease: 'power2.out' },
      });

      if (plates.length) {
        tl.fromTo(
          plates,
          { opacity: 0, scale: 0.965 },
          { opacity: 1, scale: 1, duration: 0.9, stagger },
          0,
        );
      }
      if (items.length) {
        tl.fromTo(
          items,
          { opacity: 0, y },
          { opacity: 1, y: 0, duration: 0.85, stagger },
          plates.length ? 0.08 : 0,
        );
      }
    }, root);

    return () => ctx.revert();
  }, [stagger, y, start]);

  return ref;
}

/**
 * Число, которое плавно добегает до нового значения.
 * Цифры табличные, поэтому ширина не гуляет и соседей не дёргает.
 */
export function useCountUp<T extends HTMLElement = HTMLSpanElement>(
  value: number,
  format: (n: number) => string,
) {
  const ref = useRef<T | null>(null);
  const shown = useRef(value);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (prefersReducedMotion() || shown.current === value) {
      node.textContent = format(value);
      shown.current = value;
      return;
    }

    const proxy = { n: shown.current };
    const tween = gsap.to(proxy, {
      n: value,
      duration: 0.55,
      ease: 'power2.out',
      onUpdate: () => {
        node.textContent = format(Math.round(proxy.n));
      },
      onComplete: () => {
        shown.current = value;
      },
    });
    return () => {
      tween.kill();
    };
  }, [value, format]);

  return ref;
}

/**
 * Разворачивание блока по высоте.
 *
 * Анимируется height от 0 до фактической высоты содержимого, затем высота
 * снимается в auto — иначе блок перестал бы реагировать на изменение
 * содержимого и на смену ширины окна.
 */
export function useExpand<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T | null>(null);
  const first = useRef(true);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const inner = node.firstElementChild as HTMLElement | null;
    if (!inner) return;

    // Первый проход: ставим состояние без анимации.
    if (first.current) {
      first.current = false;
      gsap.set(node, { height: open ? 'auto' : 0, opacity: open ? 1 : 0 });
      node.style.overflow = open ? 'visible' : 'hidden';
      return;
    }

    if (prefersReducedMotion()) {
      gsap.set(node, { height: open ? 'auto' : 0, opacity: open ? 1 : 0 });
      node.style.overflow = open ? 'visible' : 'hidden';
      ScrollTrigger.refresh();
      return;
    }

    gsap.killTweensOf(node);
    node.style.overflow = 'hidden';

    const target = open ? inner.offsetHeight : 0;
    const tl = gsap.timeline({
      onComplete: () => {
        if (open) {
          node.style.height = 'auto';
          node.style.overflow = 'visible';
        }
        // Высота страницы изменилась — пересчитываем триггеры,
        // иначе появления ниже сработают не там.
        ScrollTrigger.refresh();
      },
    });

    tl.to(node, {
      height: target,
      duration: open ? 0.52 : 0.42,
      ease: open ? 'power3.out' : 'power2.inOut',
    });
    tl.to(node, { opacity: open ? 1 : 0, duration: open ? 0.3 : 0.22 }, open ? 0.1 : 0);

    // Содержимое проявляется следом за раскрытием, а не одновременно с ним.
    if (open) {
      const rows = Array.from(inner.querySelectorAll<HTMLElement>('[data-expand-item]'));
      if (rows.length) {
        tl.fromTo(
          rows,
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.045 },
          0.14,
        );
      }
    }

    return () => {
      tl.kill();
    };
  }, [open]);

  return ref;
}
