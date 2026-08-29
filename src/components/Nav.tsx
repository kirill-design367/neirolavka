'use client';

import { useCallback, useEffect, useRef } from 'react';
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

  // Капсула проявляется по ходу прокрутки, а не по порогу.
  // Пишем одну переменную на самой шапке: пересчёт стиля задевает
  // только её поддерево, а не всю страницу. Запись через кадр,
  // чтобы на один кадр приходилась одна запись, а не одна на событие.
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let queued = false;
    const apply = () => {
      queued = false;
      const p = Math.min(1, Math.max(0, window.scrollY / 120));
      navRef.current?.style.setProperty('--nav-p', p.toFixed(3));
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="nav" ref={navRef}>
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
