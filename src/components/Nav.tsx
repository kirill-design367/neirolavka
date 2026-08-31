'use client';

import { useEffect, useRef } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';

const LINKS = [
  { href: '#magazin', label: 'Магазин' },
  { href: '#otzyvy', label: 'Отзывы' },
  { href: '#referalka', label: 'Реферальная программа' },
];

const formatCount = (n: number) => n.toLocaleString('ru-RU');

export function Nav({ subscribers }: { subscribers: number }) {
  // Счётчик стоит числом и никуда не добегает. Разбег от заниженного
  // значения изображал рост прямо сейчас: вместе с маячком это была
  // не подпись, а подгонялка. Факт остаётся, спектакль вокруг — нет.

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
        {/* Маячка рядом со счётчиком нет намеренно: пульсирующая точка
            изображает происходящее прямо сейчас движение и работает как
            подгонялка. Число само по себе — факт, мигание — давление. */}
        <p className="nav__counter">
          <span className="nav__counter-text">
            Уже{' '}
            <span className="tnum nav__counter-number">{formatCount(subscribers)}</span>{' '}
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
