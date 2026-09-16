'use client';

import { useEffect, useRef } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useCountUp } from '@/lib/motion';
import { NACHALO_RAZBEGA, useSchetchik } from '@/lib/schetchik';

const LINKS = [
  { href: '#magazin', label: 'Магазин' },
  { href: '#otzyvy', label: 'Отзывы' },
];

const formatCount = (n: number) => n.toLocaleString('ru-RU');

export function Nav({ subscribers }: { subscribers: number }) {
  // Число живое: засев из сборки плюс выданные заказы, которые сайт
  // спрашивает у бота одним запросом. Не ответил — остаётся засев,
  // и человек не видит ни пустоты, ни нуля. Подробности и оба
  // отвергнутых способа счёта — в lib/schetchik.ts.
  const vsego = useSchetchik(subscribers);

  // РАЗБЕГ ПРИ ЗАГРУЗКЕ — решение владельца, отменяющее прежний
  // запрет. Прежде число стояло засевом и ПЕРЕСКАКИВАЛО на настоящее,
  // когда отвечал бот: владелец прочитал этот скачок как подмену.
  // Теперь оно растёт снизу и приходит туда же — а если бот молчит,
  // приходит на засев, и это выглядит обычной работой.
  //
  // Маячка рядом по-прежнему нет, и это не отменено: пульсирующая
  // точка изображает происходящее ПРЯМО СЕЙЧАС, а разбег — это способ
  // показать одно число, а не рассказ о чужих покупках в эту минуту.
  //
  // Узел разбега ПУСТ в разметке: в него пишет GSAP. Реактовских детей
  // ему давать нельзя — `useCountUp` пишет `textContent` и снесёт их.
  const begRef = useCountUp<HTMLSpanElement>(vsego, formatCount, NACHALO_RAZBEGA);

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
            <span className="tnum nav__counter-number">
              {/* РАСПОРКА: то же число, но самыми широкими цифрами.
                  Она одна лежит в потоке и держит ширину коробки —
                  оба настоящих числа рисуются поверх неё. Почему
                  нельзя мерить коробку самими числами, написано
                  в nav.css. */}
              <span className="nav__counter-mera" aria-hidden="true">
                {formatCount(vsego).replace(/\d/g, '0')}
              </span>
              {/* Бегущее число. Пока пусто — виден сосед. */}
              <span className="nav__counter-run" ref={begRef} />
              {/* Настоящее число: оно в разметке, значит есть и без
                  скриптов, и при выключенном движении, и в дереве
                  доступности. */}
              <span className="nav__counter-true">{formatCount(vsego)}</span>
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
