'use client';

import { useCallback, useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useCountUp } from '@/lib/motion';

const LINKS = [
  { href: '#magazin', label: 'Магазин' },
  { href: '#otzyvy', label: 'Отзывы' },
  { href: '#referalka', label: 'Реферальная программа' },
];

const formatCount = (n: number) => n.toLocaleString('ru-RU');

export function Nav({ subscribers }: { subscribers: number }) {
  // Счётчик добегает от заниженного значения — видно, что число живое,
  // но прыжка вёрстки нет: цифры табличные и ширина зарезервирована.
  const countRef = useCountUp(subscribers, useCallback(formatCount, []));

  // Тень под шапкой появляется, только когда под неё что-то заехало:
  // у самого верха страницы отделять нечего. Слушатель пассивный
  // и меняет класс лишь на переходе через порог, а не каждый кадр.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    let last = false;
    const onScroll = () => {
      const next = window.scrollY > 8;
      if (next !== last) {
        last = next;
        setStuck(next);
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`nav${stuck ? ' nav--stuck' : ''}`}>
      <div className="nav__inner page">
        <p className="nav__counter">
          <span className="nav__pulse" aria-hidden="true" />
          <span className="nav__counter-text">
            Уже{' '}
            <span ref={countRef} className="tnum nav__counter-number">
              {formatCount(subscribers)}
            </span>{' '}
            <span className="nav__counter-tail">пользователей оформили подписки</span>
            <span className="nav__counter-short">подписок оформлено</span>
          </span>
        </p>

        <nav className="nav__links" aria-label="Разделы страницы">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className="nav__link">
              {link.label}
            </a>
          ))}
        </nav>

        <ThemeToggle />
      </div>
    </header>
  );
}
