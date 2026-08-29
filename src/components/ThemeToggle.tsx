'use client';

import { useCallback, useEffect, useState } from 'react';
import { THEME_STORAGE_KEY, type Theme } from '@/lib/theme';

/**
 * Переключатель темы.
 *
 * Состояние читается из атрибута, который уже проставил блокирующий скрипт,
 * поэтому первый кадр совпадает с тем, что нарисовал браузер, и переключатель
 * не «прыгает» после гидратации.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === 'dark' ? 'dark' : 'light');
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;

    // На время смены темы включаем переход по цвету. Класс снимается,
    // иначе каждый ховер тоже начал бы плавно перекрашиваться.
    root.classList.add('theme-transition');
    root.dataset.theme = next;
    root.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // приватный режим — просто не запоминаем
    }
    setTheme(next);
    window.setTimeout(() => root.classList.remove('theme-transition'), 320);
  }, []);

  const dark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      className="theme-toggle"
      aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      aria-pressed={dark}
      // До монтирования разметка совпадает с серверной: подпись нейтральная
      suppressHydrationWarning
    >
      <span className="theme-toggle__track" aria-hidden="true">
        <span className="theme-toggle__thumb" />
      </span>
      <span className="theme-toggle__label" suppressHydrationWarning>
        {mounted ? (dark ? 'Тёмная' : 'Светлая') : 'Светлая'}
      </span>
    </button>
  );
}
