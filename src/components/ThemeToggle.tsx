'use client';

import { useCallback, useEffect, useState } from 'react';
import { THEME_BAR, THEME_STORAGE_KEY, THEME_TRANSITION_MS, type Theme } from '@/lib/theme';

/**
 * Переключатель темы.
 *
 * Состояние читается из атрибута, который уже проставил блокирующий скрипт,
 * поэтому первый кадр совпадает с тем, что нарисовал браузер, и переключатель
 * не «прыгает» после гидратации.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    const root = document.documentElement;

    // На время смены темы включаем переход по переменным. Класс снимается,
    // иначе каждый ховер тоже начал бы плавно перекрашиваться.
    root.classList.add('theme-transition');
    root.dataset.theme = next;
    root.style.colorScheme = next;
    // Строка браузера идёт за темой сайта, а не за системной.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BAR[next]);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // приватный режим — просто не запоминаем
    }
    setTheme(next);
    window.setTimeout(() => root.classList.remove('theme-transition'), THEME_TRANSITION_MS + 60);
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
        <span className="theme-toggle__thumb">
          {/* Обе иконки лежат друг на друге и меняются проявлением
              с поворотом. Подмены картинки нет: оба узла в разметке
              всегда, меняются только opacity и transform. */}
          <svg className="theme-toggle__icon theme-toggle__icon--sun" viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.4v2.3M12 19.3v2.3M2.4 12h2.3M19.3 12h2.3M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
          </svg>
          <svg className="theme-toggle__icon theme-toggle__icon--moon" viewBox="0 0 24 24" focusable="false">
            <path d="M20.1 14.8A8.4 8.4 0 0 1 9.2 3.9a8.6 8.6 0 1 0 10.9 10.9Z" />
          </svg>
        </span>
      </span>
      {/* Оба слова всегда в разметке и лежат в одной ячейке сетки:
          ширина подписи определяется самым длинным из них и при
          переключении не меняется. Прежде подпись меняла ширину,
          и вся шапка ехала. Скрытое слово держит место через
          visibility, а не display. */}
      <span className="theme-toggle__label" aria-hidden="true">
        <span className="theme-toggle__word" data-word="light">
          Светлая
        </span>
        <span className="theme-toggle__word" data-word="dark">
          Тёмная
        </span>
      </span>
    </button>
  );
}
