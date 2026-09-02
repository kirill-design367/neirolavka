'use client';

import { useEffect, useRef } from 'react';

/**
 * Оболочка над отрисовкой: холст, отложенный запуск, уборка.
 *
 * Сам модуль грузится ОТДЕЛЬНЫМ КУСКОМ — в нём Three.js, и на
 * критическом пути ему не место. Запуск идёт в кадре после первой
 * отрисовки: первый экран не должен стоять пустым.
 *
 * При prefers-reduced-motion модуль не загружается вовсе — пузырей
 * нет. Холст закреплён внутри секции и вне потока, поэтому
 * в композиции от его отсутствия ничего не сдвигается.
 */
export function Bubbles() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let dispose: (() => void) | null = null;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      import('@/lib/bubbles').then(({ mount }) => {
        if (cancelled) return;
        dispose = mount(host);
      }).catch(() => { /* нет WebGL — тихий отказ */ });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
      dispose?.();
    };
  }, []);

  return <div ref={ref} hidden />;
}
