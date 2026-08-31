/**
 * Пузыри первого экрана на WebGL.
 *
 * Модуль грузится ОТДЕЛЬНЫМ КУСКОМ и только тогда, когда пузыри
 * действительно будут показаны: Three.js весит, и на критическом пути
 * ему не место. Точка входа — `mount`, её зовёт `Bubbles.tsx` после
 * загрузки страницы, в простое главного потока.
 *
 * Почему WebGL, а не канва со спрайтами. Прежняя версия копировала
 * точки готовой картинкой 32×32 через drawImage: край получался
 * растровый, при малом размере точка превращалась в квадратик, а сам
 * пузырь оставался плоским кольцом. Здесь точка — это шейдер: край
 * считается на пиксель, а не берётся из картинки, и остаётся мягким
 * при любом размере. Пузырь — оболочка сферы: ближние точки крупнее
 * и плотнее, дальние мельче и глуше, оболочка медленно поворачивается,
 * и по перекличке размеров видно, что это шар, а не круг.
 *
 * Правила проекта, которые здесь соблюдаются:
 *   — такт берётся у общего тикера GSAP, своего requestAnimationFrame нет;
 *   — слой мышь не ловит, попадание считается по координатам;
 *   — цвета берутся из токенов палитры и едут вместе со сменой темы;
 *   — при prefers-reduced-motion модуль вообще не загружается.
 */
import {
  BufferAttribute,
  BufferGeometry,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import gsap from 'gsap';

/** Угол обзора. От него зависит, на каком расстоянии единица мира равна пикселю. */
const FOV = 45;
const POP_MS = 760;
const RESPAWN_MIN = 700;
const RESPAWN_MAX = 1300;
const TOKENS = ['--c-brand', '--c-accent', '--c-line-strong'] as const;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Цвет из токена — в sRGB-тройку 0..1.
 *
 *  Разбираем сами, а не через THREE.Color: библиотека переводит цвет
 *  в линейное пространство, а ShaderMaterial пишет gl_FragColor как
 *  есть, без обратного перевода. Тогда пузыри вышли бы темнее токена. */
const readRgb = (css: string): [number, number, number] => {
  const m = css.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return [0.5, 0.5, 0.5];
  return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
};

const VERT = /* glsl */ `
  uniform float uSizeScale;   // множитель gl_PointSize: dpr * расстояние камеры
  uniform float uCamZ;        // расстояние камеры, оно же глубина плоскости z = 0
  uniform float uRadius;      // радиус пузыря в пикселях
  uniform vec3  uPointer;     // курсор в координатах мира
  uniform float uPress;       // сила реакции на курсор, 0..1, едет с инерцией
  uniform float uPop;         // 0 — цел, 1 — разлетелся
  uniform float uTime;
  uniform float uInk;         // плотность краски: в тёмной теме токены уходят в фон
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform vec3  uColorC;

  attribute float aSize;
  attribute float aTint;
  attribute float aPhase;
  attribute vec3  aVel;

  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    // Оболочка чуть дышит — это плёнка, а не жёсткий каркас.
    vec3 p = position * (1.0 + 0.03 * sin(uTime * 0.7 + aPhase));

    vec4 world = modelMatrix * vec4(p, 1.0);

    // Реакция на курсор: точки рядом с ним отжимаются прочь по колоколу.
    // Ближняя к курсору сторона проминается, дальняя выпирает — оболочку
    // как будто продавливают пальцем.
    vec3  away = world.xyz - uPointer;
    float d    = length(away) / max(uRadius, 1.0);
    float bell = exp(-d * d * 0.55);
    world.xyz += normalize(away + vec3(1e-4)) * bell * uPress * uRadius * 0.6;

    // Разлёт при лопании: у каждой точки своя скорость, в том числе по глубине.
    world.xyz += aVel * uPop;

    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;

    float depth = max(-mv.z, 1.0);

    // Глубина. Перспектива на таком масштабе даёт разницу размера
    // в проценты, этого мало: шар остаётся плоским кольцом. Поэтому
    // ближние точки ЯВНО крупнее и плотнее, дальние мельче и глуше —
    // и по тому, как это переливается при повороте оболочки, видно,
    // что перед тобой шар.
    float near = clamp((uCamZ + uRadius - depth) / (2.0 * uRadius), 0.0, 1.0);
    float fade = 1.0 - uPop;

    gl_PointSize = aSize * (0.5 + 0.85 * near) * uSizeScale / depth;

    vColor = aTint < 0.5 ? uColorA : (aTint < 1.5 ? uColorB : uColorC);
    vAlpha = (0.06 + 0.32 * near) * uInk * fade * fade;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    // Край считается на пиксель, а не берётся из картинки: ступеньки
    // не бывает ни при каком размере точки.
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vAlpha;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

type Bubble = {
  obj: Points;
  mat: ShaderMaterial;
  r: number;
  /** ход и его медленные качания */
  vx: number;
  vy: number;
  dir: number;
  speed: number;
  pa: number;
  pb: number;
  swayA: number;
  swayB: number;
  /** собственное вращение оболочки */
  wx: number;
  wy: number;
  phase: number;
  popped: number;
};

/** Запретная полоса: строки подзаголовка. Пузыри её огибают. */
type Band = { top: number; bottom: number } | null;

export function mount(canvas: HTMLCanvasElement, host: HTMLElement): (() => void) | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
    });
  } catch {
    return null; // WebGL нет — просто ничего не показываем
  }
  if (!renderer.getContext()) return null;

  const phone = window.matchMedia('(max-width: 640px)').matches;
  const COUNT = phone ? 5 : 8;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 1, 4000);
  const tanHalf = Math.tan((FOV / 2) * (Math.PI / 180));

  let w = 1;
  let h = 1;
  let dpr = 1;
  let camZ = 1;
  let band: Band = null;

  // ─── Цвета из токенов ───────────────────────────────────────
  let colors: [number, number, number][] = [
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5],
  ];
  let ink = 1;
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    ink = parseFloat(cs.getPropertyValue('--bubbles-ink')) || 1;
    colors = TOKENS.map((t) => readRgb(cs.getPropertyValue(t))) as typeof colors;
    for (const b of bubbles) applyColors(b.mat);
  };
  const applyColors = (mat: ShaderMaterial) => {
    mat.uniforms.uColorA.value.set(...colors[0]);
    mat.uniforms.uColorB.value.set(...colors[1]);
    mat.uniforms.uColorC.value.set(...colors[2]);
    mat.uniforms.uInk.value = ink;
  };

  // ─── Один пузырь: оболочка сферы из точек ───────────────────
  const makeBubble = (avoid?: { x: number; y: number }): Bubble => {
    const r = rnd(17, 34) * (phone ? 0.82 : 1);
    const n = Math.round(r * 6);

    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const tint = new Float32Array(n);
    const phase = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      // Точки садятся на оболочку по спирали Фибоначчи, а не случайно:
      // случайные сбиваются в комки, и шар перестаёт читаться шаром.
      const y = 1 - (2 * i + 1) / n;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * 2.399963229728653; // золотой угол
      // лёгкий разброс, иначе спираль видна узором
      const jit = 1 + rnd(-0.035, 0.035);
      const x = Math.cos(th) * rad;
      const z = Math.sin(th) * rad;
      pos[i * 3] = x * r * jit;
      pos[i * 3 + 1] = y * r * jit;
      pos[i * 3 + 2] = z * r * jit;

      const s = rnd(26, 64);
      vel[i * 3] = x * s;
      vel[i * 3 + 1] = y * s + rnd(2, 14);
      vel[i * 3 + 2] = z * s;

      size[i] = rnd(1.1, 2.3);
      tint[i] = (Math.random() * 3) | 0;
      phase[i] = Math.random() * Math.PI * 2;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aVel', new BufferAttribute(vel, 3));
    geo.setAttribute('aSize', new BufferAttribute(size, 1));
    geo.setAttribute('aTint', new BufferAttribute(tint, 1));
    geo.setAttribute('aPhase', new BufferAttribute(phase, 1));

    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSizeScale: { value: 1 },
        uCamZ: { value: 1 },
        uRadius: { value: r },
        uPointer: { value: new Vector3(1e5, 1e5, 0) },
        uPress: { value: 0 },
        uPop: { value: 0 },
        uTime: { value: 0 },
        uInk: { value: 1 },
        uColorA: { value: new Vector3() },
        uColorB: { value: new Vector3() },
        uColorC: { value: new Vector3() },
      },
    });
    applyColors(mat);

    const obj = new Points(geo, mat);
    place(obj, r, avoid);
    obj.rotation.set(Math.random() * 6.28, Math.random() * 6.28, 0);
    scene.add(obj);

    const dir = Math.random() * Math.PI * 2;
    return {
      obj,
      mat,
      r,
      vx: Math.cos(dir) * 5,
      vy: Math.sin(dir) * 5,
      dir,
      speed: rnd(3.5, 7),
      pa: rnd(14, 22),
      pb: rnd(25, 37),
      swayA: rnd(0.22, 0.5),
      swayB: rnd(0.1, 0.28),
      wx: rnd(-0.16, 0.16),
      wy: rnd(0.12, 0.3) * (Math.random() < 0.5 ? -1 : 1),
      phase: Math.random() * 100,
      popped: 0,
    };
  };

  /** Ставит пузырь в свободное место: не в запретной полосе и не там,
   *  где только что лопнул предыдущий. */
  function place(obj: Points, r: number, avoid?: { x: number; y: number }) {
    for (let i = 0; i < 24; i++) {
      const x = rnd(-w / 2 + r, w / 2 - r);
      const y = rnd(-h / 2 + r, h / 2 - r);
      if (band && y - r < band.top && y + r > band.bottom) continue;
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < 140) continue;
      obj.position.set(x, y, rnd(-r * 0.5, r * 0.5));
      return;
    }
    obj.position.set(rnd(-w / 2 + r, w / 2 - r), h / 2 - r, 0);
  }

  const bubbles: Bubble[] = [];
  const queue: number[] = [];

  /** Число целых пузырей — единственная наружная примета состояния:
   *  проверке иначе не за что зацепиться, а пиксели считать ненадёжно. */
  const publish = () => {
    const n = String(bubbles.filter((b) => !b.popped).length);
    if (canvas.dataset.bubbles !== n) canvas.dataset.bubbles = n;
  };

  // ─── Размеры ────────────────────────────────────────────────
  const measureBand = () => {
    const lead = host.querySelector('.hero__lead');
    if (!lead) {
      band = null;
      return;
    }
    const hb = host.getBoundingClientRect();
    const lb = lead.getBoundingClientRect();
    // В мир: начало координат в центре холста, ось Y вверх.
    const pad = 10;
    band = {
      top: h / 2 - (lb.top - hb.top) + pad,
      bottom: h / 2 - (lb.bottom - hb.top) - pad,
    };
  };

  const resize = () => {
    const rect = host.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width));
    h = Math.max(1, Math.round(rect.height));
    // Плотность пикселей ограничена двумя: выше нет смысла, точки
    // мягкие. Понижение до полутора пробовалось ради кадров и ничего
    // не дало — 15.0–15.6 % просевших кадров против 13.7–14.1 %, то
    // есть в пределах разброса замера. Значит, дело не в заливке.
    dpr = Math.min(2, window.devicePixelRatio || 1);
    // Камера отодвинута так, что на плоскости z = 0 единица мира —
    // ровно один css-пиксель. Тогда радиусы и размеры точек задаются
    // в пикселях и не зависят от размера окна.
    camZ = h / 2 / tanHalf;
    camera.aspect = w / h;
    camera.position.z = camZ;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    measureBand();

    const sizeScale = dpr * camZ;
    for (const b of bubbles) {
      b.mat.uniforms.uSizeScale.value = sizeScale;
      b.mat.uniforms.uCamZ.value = camZ;
      b.obj.position.x = Math.max(-w / 2 + b.r, Math.min(w / 2 - b.r, b.obj.position.x));
      b.obj.position.y = Math.max(-h / 2 + b.r, Math.min(h / 2 - b.r, b.obj.position.y));
    }
  };

  resize();
  readColors();
  for (let i = 0; i < COUNT; i++) bubbles.push(makeBubble());
  resize();
  publish();

  // ─── Курсор ─────────────────────────────────────────────────
  // Слой мышь не ловит (pointer-events: none), поэтому позиция курсора
  // берётся со слушателя на самой секции, а попадание считается сами.
  const pointer = new Vector3(1e5, 1e5, 0);
  const pointerTo = new Vector3(1e5, 1e5, 0);
  let press = 0;
  let pressTo = 0;

  const toWorld = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left - w / 2, y: h / 2 - (e.clientY - rect.top) };
  };

  const INTERACTIVE = 'a, button, input, label, summary, [role="button"], [data-lenis-scrollable]';

  const hitTest = (x: number, y: number) => {
    let best: Bubble | null = null;
    let bd = Infinity;
    for (const b of bubbles) {
      if (b.popped) continue;
      const d = Math.hypot(x - b.obj.position.x, y - b.obj.position.y);
      if (d < b.r * 1.05 && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  };

  const onMove = (e: PointerEvent) => {
    const { x, y } = toWorld(e);
    pointerTo.set(x, y, 0);
    pressTo = 1;
    // Курсор меняем только над собственным фоном секции: над текстом
    // и ссылками свой курсор, и подменять его нечем и незачем.
    if (e.target === host) host.style.cursor = hitTest(x, y) ? 'pointer' : '';
  };

  const onLeave = () => {
    pressTo = 0;
    pointerTo.set(1e5, 1e5, 0);
    host.style.cursor = '';
  };

  const onDown = (e: PointerEvent) => {
    const el = e.target as HTMLElement | null;
    if (el?.closest(INTERACTIVE)) return;
    const { x, y } = toWorld(e);
    // На касании курсора нет, поэтому реакцию оболочки запускает само
    // касание: палец ведут — пузыри проминаются, как под мышью.
    pointerTo.set(x, y, 0);
    pressTo = 1;
    const hit = hitTest(x, y);
    if (!hit) return;
    hit.popped = gsap.ticker.time * 1000;
    host.style.cursor = '';
    publish();
  };

  // Палец, в отличие от курсора, уходит со стекла совсем: без этого
  // нажим, поднятый касанием, остался бы поднятым навсегда, и пузырь
  // рядом с местом касания так и висел бы продавленным.
  const onUp = (e: PointerEvent) => { if (e.pointerType !== 'mouse') onLeave(); };

  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerdown', onDown, { passive: true });
  host.addEventListener('pointerleave', onLeave, { passive: true });
  host.addEventListener('pointerup', onUp, { passive: true });
  host.addEventListener('pointercancel', onUp, { passive: true });

  // ─── Такт ───────────────────────────────────────────────────
  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '80px' });
  io.observe(host);

  // Цвета читаются не каждый кадр: чтение переменной с корня — это
  // пересчёт стиля. В покое не читаем вовсе, а на смену темы открываем
  // короткое окно и в нём перечитываем часто, чтобы пузыри доехали
  // до нового цвета вместе со страницей.
  let colorWindow = 0;
  const mo = new MutationObserver(() => { colorWindow = gsap.ticker.time * 1000 + 700; });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let prev = 0;
  let frames = 0;
  const step = (time: number) => {
    const t = time * 1000;
    const dt = prev ? Math.min(0.05, (t - prev) / 1000) : 0;
    prev = t;
    if (!visible) return;

    if (t < colorWindow && (frames & 3) === 0) readColors();
    frames++;

    // Курсор и сила реакции едут с инерцией: мгновенная реакция
    // читается щелчком, а не живым откликом.
    pointer.lerp(pointerTo, 1 - Math.pow(0.001, dt));
    press += (pressTo - press) * (1 - Math.pow(0.02, dt));

    for (const b of bubbles) {
      const u = b.mat.uniforms;
      u.uTime.value = t / 1000 + b.phase;
      u.uPointer.value.copy(pointer);
      u.uPress.value = press;

      if (b.popped) {
        u.uPop.value = Math.min(1, (t - b.popped) / POP_MS);
        continue;
      }

      // Ход: направление качается двумя синусами с некратными
      // периодами. Случайность в направлении читалась бы дрожью.
      const ang = b.dir + Math.sin(t / 1000 / b.pa) * b.swayA + Math.sin(t / 1000 / b.pb) * b.swayB;
      const tx = Math.cos(ang) * b.speed;
      const ty = Math.sin(ang) * b.speed;

      // Отталкивание от курсора — у всего пузыря, но слабое и КОЛЬЦОМ:
      // ноль в самом центре, наибольшее примерно в полутора радиусах,
      // снова ноль дальше. Так курсор, проходящий рядом, подталкивает
      // пузырь, а курсор, наведённый прямо на него, не выталкивает
      // его из-под себя — иначе по пузырю невозможно попасть, и вся
      // затея с «увидел отклик — щёлкнул» рассыпается.
      const dx = b.obj.position.x - pointer.x;
      const dy = b.obj.position.y - pointer.y;
      const dd = Math.hypot(dx, dy);
      let px = 0;
      let py = 0;
      if (dd < b.r * 3.2 && dd > 0.001) {
        const k = Math.sin(Math.PI * (dd / (b.r * 3.2))) * press * 16;
        px = (dx / dd) * k;
        py = (dy / dd) * k;
      }

      // Инерция: скорость догоняет цель, а не подменяется ею.
      b.vx += (tx + px - b.vx) * Math.min(1, dt * 1.6);
      b.vy += (ty + py - b.vy) * Math.min(1, dt * 1.6);
      b.obj.position.x += b.vx * dt;
      b.obj.position.y += b.vy * dt;

      b.obj.rotation.y += b.wy * dt;
      b.obj.rotation.x += b.wx * dt;

      // Мягкий отскок от кромок кадра.
      const mx = w / 2 - b.r * 0.6;
      const my = h / 2 - b.r * 0.6;
      if (b.obj.position.x < -mx) { b.obj.position.x = -mx; b.dir = Math.PI - b.dir; b.vx = Math.abs(b.vx); }
      if (b.obj.position.x > mx) { b.obj.position.x = mx; b.dir = Math.PI - b.dir; b.vx = -Math.abs(b.vx); }
      if (b.obj.position.y < -my) { b.obj.position.y = -my; b.dir = -b.dir; b.vy = Math.abs(b.vy); }
      if (b.obj.position.y > my) { b.obj.position.y = my; b.dir = -b.dir; b.vy = -Math.abs(b.vy); }

      // Запретная полоса подзаголовка: пузырь её огибает сверху или
      // снизу, смотря куда ближе. Точки поверх строк — мусор на тексте.
      //
      // Запас берётся не в радиус, а в полтора: оболочка дышит, а под
      // курсором отжимается наружу почти на две трети радиуса, и без
      // запаса краска долетала до строк.
      if (band) {
        const keep = b.r * 1.7;
        const top = band.top + keep;
        const bot = band.bottom - keep;
        if (b.obj.position.y < top && b.obj.position.y > bot) {
          if (b.obj.position.y - bot < top - b.obj.position.y) {
            b.obj.position.y = bot;
            b.vy = -Math.abs(b.vy);
            b.dir = -b.dir;
          } else {
            b.obj.position.y = top;
            b.vy = Math.abs(b.vy);
            b.dir = -b.dir;
          }
        }
      }
    }

    // Догоревшие убираем, вместо них через паузу приходят новые:
    // общее число держится.
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.popped && t - b.popped > POP_MS) {
        scene.remove(b.obj);
        b.obj.geometry.dispose();
        b.mat.dispose();
        bubbles.splice(i, 1);
        queue.push(t + rnd(RESPAWN_MIN, RESPAWN_MAX));
      }
    }
    for (let i = queue.length - 1; i >= 0; i--) {
      if (t >= queue[i]) {
        queue.splice(i, 1);
        const nb = makeBubble({ x: pointer.x, y: pointer.y });
        nb.mat.uniforms.uSizeScale.value = dpr * camZ;
        nb.mat.uniforms.uCamZ.value = camZ;
        bubbles.push(nb);
      }
    }
    publish();

    renderer.render(scene, camera);
  };

  gsap.ticker.add(step);

  const ro = new ResizeObserver(resize);
  ro.observe(host);

  const onLost = (e: Event) => {
    e.preventDefault();
    gsap.ticker.remove(step);
    canvas.remove();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  return () => {
    gsap.ticker.remove(step);
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerdown', onDown);
    host.removeEventListener('pointerleave', onLeave);
    host.removeEventListener('pointerup', onUp);
    host.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('webglcontextlost', onLost);
    ro.disconnect();
    io.disconnect();
    mo.disconnect();
    host.style.cursor = '';
    for (const b of bubbles) {
      b.obj.geometry.dispose();
      b.mat.dispose();
    }
    scene.clear();
    renderer.dispose();
  };
}
