'use client';

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * Пузыри на фоне названия.
 *
 * Здесь только оболочка: холст, запуск и уборка. Вся отрисовка живёт
 * в `@/lib/bubbles-gl` и загружается отдельным куском — но СРАЗУ,
 * в кадре после первой отрисовки, а не по действию человека. Кусок
 * маленький: библиотеки в нём нет, только свой слой над WebGL.
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

    // Загрузка СРАЗУ, а не по первому действию человека.
    //
    // Раньше кусок ждал движения мыши, касания или прокрутки — ради
    // балла: в нём лежал Three.js, полмегабайта разбора на главном
    // потоке ради украшения фона. Плата оказалась не та: первый экран
    // первые секунды стоял пустой и выглядел недогруженным.
    //
    // Теперь платить нечем. Пузыри больше не тянут библиотеку —
    // им хватает своего слоя над WebGL в несколько килобайт (см.
    // `@/lib/mini-gl`), и ждать нечего.
    //
    // Запрос идёт в кадре ПОСЛЕ первой отрисовки: эффект и так
    // выполняется после неё, а лишний rAF гарантирует, что разбор
    // куска не попадёт в тот же кадр, что и первая картина.
    let raf = requestAnimationFrame(() => {
      raf = 0;
      // Первый экран уже уехал — смотреть на пузыри некому.
      if (canvas.getBoundingClientRect().bottom <= 0) { canvas.remove(); return; }
      void load();
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stop?.();
    };
  }, []);

  return <canvas className="bubbles" ref={ref} aria-hidden="true" />;
}
