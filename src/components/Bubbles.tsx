'use client';

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * Пузыри на фоне названия.
 *
 * Здесь только оболочка: холст, отложенный запуск и уборка. Вся
 * отрисовка живёт в `@/lib/bubbles-gl` и загружается ОТДЕЛЬНЫМ КУСКОМ.
 * Так сделано ради веса: Three.js большой, и на критическом пути ему
 * не место. Кусок запрашивается только когда пузыри действительно
 * будут показаны — после загрузки страницы, в простое главного потока,
 * при живом движении и работающем WebGL.
 *
 * Три случая, когда модуль не загружается вовсе:
 *   — prefers-reduced-motion: движения не будет, значит и грузить нечего;
 *   — WebGL недоступен: холст убирается, композиция не меняется —
 *     он и так лежит вне потока и места не занимает;
 *   — первый экран уже уехал: смотреть на пузыри некому.
 */
export function Bubbles() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    // Движение выключено — не грузим ни байта. Холст убираем: пустой
    // прозрачный элемент вне потока ничего не занимает, но и смысла
    // в нём нет.
    if (prefersReducedMotion()) {
      canvas.remove();
      return;
    }

    let stop: (() => void) | null = null;
    let cancelled = false;
    let idleId = 0;

    const load = async () => {
      if (cancelled) return;
      try {
        const mod = await import('@/lib/bubbles-gl');
        if (cancelled) return;
        stop = mod.mount(canvas, host);
        if (!stop) canvas.remove(); // WebGL не поднялся
      } catch {
        canvas.remove();
      }
    };

    // Загрузка по ПЕРВОМУ ДЕЙСТВИЮ человека, а не по таймеру.
    //
    // Причина не в замерах, а в честной арифметике: Three.js — это
    // 520 КБ разбора на главном потоке ради украшения фона. Пока
    // человек не пошевелился, он этого украшения не увидит, а платить
    // за него временем до первой отрисовки и до отзывчивости будет.
    // Поэтому кусок запрашивается на первое движение мыши, касание,
    // колесо, клавишу или прокрутку — то есть ровно тогда, когда
    // выясняется, что перед экраном кто-то есть.
    //
    // Побочное следствие приятное: браузер перестаёт обновлять LCP
    // после первого действия пользователя, поэтому холст с пузырями
    // не может стать самым большим отрисованным элементом. С загрузкой
    // по таймеру он им становился, и LCP уезжал с 2.7 до 5.6 с.
    const EVENTS = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown', 'scroll'];
    const off = () => EVENTS.forEach((e) => window.removeEventListener(e, once));
    const once = () => {
      off();
      // Первый экран уже уехал — смотреть на пузыри некому.
      if (canvas.getBoundingClientRect().bottom <= 0) { canvas.remove(); return; }
      const ric = window.requestIdleCallback;
      idleId = ric ? ric(() => void load(), { timeout: 1200 }) : window.setTimeout(load, 200);
    };
    EVENTS.forEach((e) => window.addEventListener(e, once, { passive: true }));

    return () => {
      cancelled = true;
      off();
      if (idleId && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
      stop?.();
    };
  }, []);

  return <canvas className="bubbles" ref={ref} aria-hidden="true" />;
}
