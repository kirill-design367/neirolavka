'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

/**
 * Один узел нужен сразу двум хукам: и появлению, и параллаксу.
 * Колбэк-ссылка раздаёт его обоим.
 */
export function useMergedRefs<T>(...refs: React.MutableRefObject<T | null>[]) {
  return useCallback(
    (node: T | null) => {
      for (const r of refs) r.current = node;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    refs,
  );
}

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
      // Режим lerp, а не duration. При duration каждое событие колеса
      // заново запускает твин фиксированной длительности с нулевой
      // начальной скоростью: между щелчками мыши страница почти
      // останавливается, и движение читается как ступенчатое.
      // Замер на восьми щелчках показывал девять провалов скорости.
      // lerp сглаживает непрерывно и скорость не обнуляет.
      lerp: 0.09,
      smoothWheel: true,
      wheelMultiplier: 1,
      // Тач оставляем нативным: своя инерция у системы лучше, а
      // сглаживание на телефоне только отнимает кадры.
      syncTouch: false,
      touchMultiplier: 1.6,
      // Вложенную прокрутку перехватываем ТОЛЬКО у элементов, которые
      // в этот момент действительно прокручиваются. Голый атрибут
      // data-lenis-prevent Lenis учитывает безусловно, поэтому панель
      // заказа глушила колесо над собой даже тогда, когда её
      // содержимое помещалось целиком и прокручивать было нечего.
      prevent: (node) =>
        node.hasAttribute?.('data-lenis-scrollable') &&
        node.scrollHeight > node.clientHeight + 1,
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
 * Лёгкий параллакс внутри блока.
 *
 * Элементы едут по вертикали с разной скоростью, поэтому внутри блока
 * появляется небольшая глубина. Полный размах — 10–16 px за весь проход
 * блока через экран, то есть движение замечаешь, только если приглядеться.
 *
 * Сдвиг пишется в переменную --par, а CSS применяет её через translate.
 * Это важно: появление блоков уже занимает transform, а translate —
 * отдельное свойство, и они складываются, не затирая друг друга.
 */
export function useParallax<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root || prefersReducedMotion()) return;

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-parallax]'));
    if (!items.length) return;

    const ctx = gsap.context(() => {
      // Один триггер на блок, а не на каждый элемент. Все сдвиги
      // складываются в одну ленту: восемь отдельных прокруточных
      // триггеров стоили заметной части работы главного потока
      // при загрузке, четыре обходятся дешевле при том же движении.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root,
          start: 'top bottom',
          end: 'bottom top',
          // Небольшое сглаживание: сдвиг догоняет прокрутку,
          // а не дёргается за каждым её пикселем.
          scrub: 0.6,
        },
      });

      for (const el of items) {
        const depth = Number(el.dataset.parallax) || 1;
        const shift = 5 * depth; // размах 10–14 px
        tl.fromTo(
          el,
          { '--par': `${shift}px` },
          { '--par': `${-shift}px`, ease: 'none', duration: 1 },
          0,
        );
      }
    }, root);

    return () => ctx.revert();
  }, []);

  return ref;
}

/**
 * Геометрия дорожки шагов.
 *
 * Дорожка идёт от центра первого кружка до центра последнего, а на
 * десктопе и на телефоне она разная: там горизонталь, тут вертикаль.
 * Считать это в CSS пришлось бы формулами по числу колонок и величине
 * промежутка — они разъедутся при первой же правке раскладки. Поэтому
 * положение снимается с настоящих кружков и раздаётся переменными,
 * а CSS только рисует.
 *
 * Каждому шагу достаётся --at: доля пути, на которой он стоит.
 * От неё зависит момент, когда его подсветит пробегающая точка.
 */
export function useStepTrack<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const measure = () => {
      const nodes = Array.from(root.querySelectorAll<HTMLElement>('.step__node'));
      if (nodes.length < 2) return;
      const base = root.getBoundingClientRect();
      const centre = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 };
      };
      const first = centre(nodes[0]);
      const last = centre(nodes[nodes.length - 1]);
      const dx = last.x - first.x;
      const dy = last.y - first.y;
      const vertical = Math.abs(dy) > Math.abs(dx);
      const len = vertical ? dy : dx;

      root.style.setProperty('--track-x', `${first.x}px`);
      root.style.setProperty('--track-y', `${first.y}px`);
      root.style.setProperty('--track-len', `${Math.abs(len)}px`);
      root.dataset.trackDir = vertical ? 'vertical' : 'horizontal';

      nodes.forEach((node) => {
        const c = centre(node);
        const at = len === 0 ? 0 : ((vertical ? c.y - first.y : c.x - first.x) / len);
        (node.closest('.step') as HTMLElement | null)?.style.setProperty('--at', at.toFixed(4));
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

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
