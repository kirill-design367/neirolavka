'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * Пузыри из точек на фоне названия.
 *
 * Всё рисуется на одном canvas. В DOM это класть нельзя: даже
 * восемь пузырей — это две с лишним сотни узлов, и каждый кадр
 * браузер пересчитывал бы им стиль и раскладку.
 *
 * Слой лежит ПОД содержимым и не ловит мышь (pointer-events: none),
 * поэтому кнопки, ссылки и панель заказа работают как работали.
 * Попадание по пузырю ищется вручную по координатам: слушатель висит
 * на самой секции первого экрана, а клики по интерактивным узлам
 * отсеиваются по closest.
 *
 * Такт берётся у общего тикера GSAP, своего requestAnimationFrame
 * компонент не заводит: в проекте один такт на всё движение.
 */

type Dot = {
  /** угол и доля радиуса — точка живёт в полярных координатах пузыря */
  a: number;
  d: number;
  /** размер в css-пикселях и номер цвета */
  size: number;
  ci: number;
  /** своя фаза и период колыхания, чтобы облачко дышало неровно */
  wob: number;
  wsp: number;
  /** скорость разлёта при лопании */
  vx: number;
  vy: number;
};

type Bubble = {
  x: number;
  y: number;
  r: number;
  /** направление хода и его медленные качания */
  dir: number;
  speed: number;
  swayA: number;
  swayB: number;
  pa: number;
  pb: number;
  dots: Dot[];
  /** время лопания, ноль — целый */
  popped: number;
};

const TAU = Math.PI * 2;
const POP_MS = 420;
const RESPAWN_MIN = 600;
const RESPAWN_MAX = 1100;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function Bubbles() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const still = prefersReducedMotion();
    const phone = window.matchMedia('(max-width: 640px)').matches;
    const COUNT = phone ? 5 : 8;

    let w = 0;
    let h = 0;
    let dpr = 1;

    // ─── Цвета берутся из токенов, поэтому пузыри живут в палитре
    //     и переезжают вместе со сменой темы. Спрайты пересобираются
    //     только когда строка цвета действительно изменилась.
    const TOKENS = ['--c-brand', '--c-accent', '--c-line-strong'];
    let colors: string[] = [];
    let sprites: HTMLCanvasElement[] = [];
    // Множитель плотности: на сумеречной земле те же цвета уходят
    // в фон, и без него пузыри в тёмной теме почти не читаются.
    let ink = 1;

    const makeSprite = (color: string) => {
      const s = document.createElement('canvas');
      const S = 32;
      s.width = S;
      s.height = S;
      const c = s.getContext('2d');
      if (c) {
        const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        g.addColorStop(0, color);
        g.addColorStop(0.55, color);
        g.addColorStop(1, 'transparent');
        c.fillStyle = g;
        c.beginPath();
        c.arc(S / 2, S / 2, S / 2, 0, TAU);
        c.fill();
      }
      return s;
    };

    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      ink = parseFloat(cs.getPropertyValue('--bubbles-ink')) || 1;
      const next = TOKENS.map((t) => cs.getPropertyValue(t).trim() || '#888');
      if (next.length === colors.length && next.every((v, i) => v === colors[i])) return;
      colors = next;
      sprites = next.map(makeSprite);
    };

    // ─── Пузырь: облачко точек, разреженное и полупрозрачное.
    const makeDots = (r: number) => {
      const n = Math.round(r * 0.95);
      const dots: Dot[] = [];
      for (let i = 0; i < n; i++) {
        // Точки сидят ОБОЛОЧКОЙ, а не заполняют круг: при равномерной
        // заливке восемь пузырей сливаются в одно поле конфетти и по
        // отдельности не читаются. Полая середина держит форму.
        const d = Math.sqrt(rnd(0.52, 1)) * 0.98;
        const a = Math.random() * TAU;
        dots.push({
          a,
          d,
          size: rnd(0.9, 2.0),
          ci: (Math.random() * 3) | 0,
          wob: Math.random() * TAU,
          wsp: rnd(0.18, 0.42),
          vx: Math.cos(a) * d * rnd(24, 62),
          vy: Math.sin(a) * d * rnd(24, 62) - rnd(4, 16),
        });
      }
      return dots;
    };

    const spawn = (avoidX = -1e5, avoidY = -1e5): Bubble => {
      const r = rnd(30, 62) * (phone ? 0.8 : 1);
      let x = 0;
      let y = 0;
      for (let i = 0; i < 12; i++) {
        x = rnd(r, Math.max(r + 1, w - r));
        y = rnd(r, Math.max(r + 1, h - r));
        if (Math.hypot(x - avoidX, y - avoidY) > 120) break;
      }
      return {
        x,
        y,
        r,
        dir: Math.random() * TAU,
        speed: rnd(3, 7),
        swayA: rnd(0.25, 0.6),
        swayB: rnd(0.12, 0.32),
        pa: rnd(13, 21),
        pb: rnd(23, 34),
        dots: makeDots(r),
        popped: 0,
      };
    };

    let bubbles: Bubble[] = [];
    const queue: number[] = []; // время, когда вернуть лопнувший

    // Число целых пузырей выставляется атрибутом. Это единственная
    // наружная примета состояния: без неё проверке не за что зацепиться,
    // а холст пикселями считать ненадёжно.
    const publish = () => {
      const n = String(bubbles.filter((b) => !b.popped).length);
      if (canvas.dataset.bubbles !== n) canvas.dataset.bubbles = n;
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!bubbles.length) bubbles = Array.from({ length: COUNT }, () => spawn());
      else for (const b of bubbles) { b.x = Math.min(b.x, w - b.r); b.y = Math.min(b.y, h - b.r); }
      publish();
    };

    readColors();
    resize();

    // ─── Рисование одного кадра.
    const draw = (t: number, dt: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const b of bubbles) {
        const pop = b.popped ? Math.min(1, (t - b.popped) / POP_MS) : 0;
        // Плавное затухание лопнувшего: доля времени в квадрате
        // гасит быстрее к концу и не оставляет ступеньки.
        const fade = b.popped ? (1 - pop) * (1 - pop) : 1;
        for (const d of b.dots) {
          const wob = Math.sin(t * 0.001 * d.wsp + d.wob) * 0.05;
          let px = b.x + Math.cos(d.a) * b.r * (d.d + wob);
          let py = b.y + Math.sin(d.a) * b.r * (d.d + wob);
          if (b.popped) {
            px += d.vx * pop;
            py += d.vy * pop;
          }
          const s = sprites[d.ci] ?? sprites[0];
          if (!s) continue;
          const size = d.size * 2.6;
          ctx.globalAlpha = (0.13 + d.d * 0.17) * ink * fade;
          ctx.drawImage(s, px - size / 2, py - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
      void dt;
    };

    // ─── Движение выключено: один статичный кадр и никакого такта.
    if (still) {
      draw(0, 0);
      const ro = new ResizeObserver(() => { resize(); draw(0, 0); });
      ro.observe(host);
      return () => ro.disconnect();
    }

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '80px' });
    io.observe(host);

    let prev = 0;
    let frames = 0;
    const step = (time: number) => {
      const t = time * 1000;
      const dt = prev ? Math.min(0.05, (t - prev) / 1000) : 0;
      prev = t;
      if (!visible) return;

      // Цвета перечитываются редко: чтение переменной с корня — это
      // пересчёт стиля, каждый кадр он не нужен. Раз в восемь кадров
      // достаточно, чтобы пузыри доехали вместе с темой.
      if ((frames++ & 7) === 0) readColors();

      for (const b of bubbles) {
        if (b.popped) continue;
        // Направление качается двумя синусами с некратными периодами:
        // ход получается неровный, но без дёрганья — случайность
        // здесь была бы дрожью.
        const ang = b.dir + Math.sin(t / 1000 / b.pa) * b.swayA + Math.sin(t / 1000 / b.pb) * b.swayB;
        b.x += Math.cos(ang) * b.speed * dt;
        b.y += Math.sin(ang) * b.speed * dt;
        // Мягкий отскок от краёв: пузырь не должен уплывать за кадр.
        if (b.x < b.r * 0.5) { b.x = b.r * 0.5; b.dir = Math.PI - b.dir; }
        if (b.x > w - b.r * 0.5) { b.x = w - b.r * 0.5; b.dir = Math.PI - b.dir; }
        if (b.y < b.r * 0.5) { b.y = b.r * 0.5; b.dir = -b.dir; }
        if (b.y > h - b.r * 0.5) { b.y = h - b.r * 0.5; b.dir = -b.dir; }
      }

      // Догоревшие убираем, вместо них через паузу приходят новые —
      // общее число держится.
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        if (b.popped && t - b.popped > POP_MS) {
          bubbles.splice(i, 1);
          queue.push(t + rnd(RESPAWN_MIN, RESPAWN_MAX));
        }
      }
      for (let i = queue.length - 1; i >= 0; i--) {
        if (t >= queue[i]) { queue.splice(i, 1); bubbles.push(spawn()); }
      }
      publish();

      draw(t, dt);
    };

    gsap.ticker.add(step);

    // ─── Попадание ищем сами: слой мыши не ловит.
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('a, button, input, label, summary, [role="button"], [data-lenis-scrollable]')) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let hit: Bubble | null = null;
      let best = Infinity;
      for (const b of bubbles) {
        if (b.popped) continue;
        const dist = Math.hypot(x - b.x, y - b.y);
        if (dist < b.r * 0.95 && dist < best) { best = dist; hit = b; }
      }
      if (!hit) return;
      hit.popped = gsap.ticker.time * 1000;
      publish();
    };
    host.addEventListener('pointerdown', onDown);

    const ro = new ResizeObserver(resize);
    ro.observe(host);

    return () => {
      gsap.ticker.remove(step);
      host.removeEventListener('pointerdown', onDown);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas className="bubbles" ref={ref} aria-hidden="true" />;
}
