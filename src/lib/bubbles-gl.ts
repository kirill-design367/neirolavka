/**
 * Пузыри первого экрана на WebGL.
 *
 * Модуль грузится ОТДЕЛЬНЫМ КУСКОМ и только по первому действию
 * человека: Three.js весит 521 КБ разбора, и на критическом пути ему
 * не место. Точка входа — `mount`, её зовёт `Bubbles.tsx`.
 *
 * Почему WebGL, а не канва со спрайтами. Прежняя версия копировала
 * точки готовой картинкой 32×32 через drawImage: край получался
 * растровый, при малом размере точка превращалась в квадратик, а сам
 * пузырь оставался плоским кольцом. Здесь точка — это шейдер: край
 * считается на пиксель и остаётся мягким при любом размере.
 *
 * ВСЕ ПУЗЫРИ — ОДИН объект и один вызов отрисовки. Раньше каждый был
 * своим Points со своим материалом, и на одиннадцати пузырях набегало
 * одиннадцать пересчётов матриц и больше сотни загрузок uniform'ов за
 * кадр: доля кадров дольше 17 мс скакала до 7 %. Теперь геометрия
 * статична (точки лежат на ЕДИНИЧНОЙ сфере), а всё, что меняется, —
 * два массива uniform'ов по числу пузырей: положение с радиусом
 * и поворот с долей разлёта. Понижение плотности пикселей до 1.5
 * пробовалось и не дало ничего — дело было не в заливке.
 *
 * Правила проекта, которые здесь соблюдаются:
 *   — такт берётся у общего тикера GSAP, своего requestAnimationFrame нет;
 *   — слой мышь не ловит, попадание считается по координатам;
 *   — цвета берутся из токенов палитры и едут вместе со сменой темы;
 *   — при prefers-reduced-motion модуль вообще не загружается.
 */
import { makeGL, makeProgram, perspective, staticAttrib, viewAt } from './mini-gl';
import gsap from 'gsap';

/** Точка на плоскости. Три числа и два действия — больше не нужно. */
type Vec = { x: number; y: number; z: number };
const vec = (x = 0, y = 0, z = 0): Vec => ({ x, y, z });

/** Угол обзора. От него зависит, на каком расстоянии единица мира равна пикселю. */
const FOV = 45;
/** Насколько радиусов пузырь держится от кромки холста.
 *
 *  Единица — это «оболочка касается края». Здесь заметно больше:
 *  оболочка ещё и отжимается курсором наружу примерно на 0,4 радиуса,
 *  и при запасе 1,4 краска доходила до самой кромки — на замере
 *  0 px слева и справа. Пузырь должен разворачиваться ЗАДОЛГО до
 *  края, иначе под блоками условий видна прямая линия, на которой
 *  он срезается. Граница обязана не читаться вовсе. */
const EDGE = 1.8;
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

const vert = (count: number) => /* glsl */ `
  #define N ${count}

  // Матрицы и позицию точки библиотека прежде объявляла сама.
  uniform mat4 projectionMatrix;
  uniform mat4 viewMatrix;
  attribute vec3 position;

  uniform float uSizeScale;   // множитель gl_PointSize: dpr * расстояние камеры
  uniform float uCamZ;        // расстояние камеры, оно же глубина плоскости z = 0
  uniform vec3  uPointer;     // курсор в координатах мира
  uniform float uPress;       // сила реакции на курсор, 0..1, едет с инерцией
  uniform float uTime;
  uniform float uInk;         // плотность краски: в тёмной теме токены уходят в фон
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform vec3  uColorC;
  /** xyz — центр пузыря, w — его радиус в пикселях. */
  uniform vec4  uPos[N];
  /** x, y — углы поворота оболочки; z — доля разлёта 0..1. */
  uniform vec4  uRot[N];

  attribute float aBubble;    // к какому пузырю принадлежит точка
  attribute float aSize;
  attribute float aTint;
  attribute float aPhase;
  attribute vec3  aVel;       // направление разлёта, в долях радиуса

  varying vec3  vColor;
  varying float vAlpha;

  vec3 spin(vec3 p, float ax, float ay) {
    float s = sin(ax), c = cos(ax);
    p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
    float s2 = sin(ay), c2 = cos(ay);
    return vec3(p.x * c2 + p.z * s2, p.y, -p.x * s2 + p.z * c2);
  }

  void main() {
    int i = int(aBubble + 0.5);
    vec4 P = uPos[i];
    vec4 R = uRot[i];
    float radius = P.w;
    float pop = R.z;

    // Оболочка чуть дышит — это плёнка, а не жёсткий каркас.
    vec3 unit = spin(position, R.y, R.x) * (1.0 + 0.03 * sin(uTime * 0.7 + aPhase));
    vec3 world = P.xyz + unit * radius;

    // ─── Реакция на курсор ─────────────────────────────────────
    //
    // Здесь ДВЕ разные силы, и разделены они намеренно.
    //
    // Первая — вмятина под самим курсором: точки рядом с ним
    // расходятся прочь. Это то, что видно, когда курсор идёт
    // по кромке оболочки, и то, что остаётся, когда он оказывается
    // ровно в середине пузыря: там оболочку раздаёт во все стороны.
    //
    // Вторая — сжатие ВСЕЙ оболочки вдоль оси «курсор → центр»:
    // ближняя сторона уходит внутрь, дальняя выпирает, поперёк шар
    // раздаётся. У неё длинный хвост по расстоянию, поэтому далёкий
    // пузырь тоже отзывается. Прежде здесь стоял один колокол
    // exp(-d*d), он падает в ноль уже на паре радиусов — и это
    // читалось как «часть пузырей не реагирует совсем».
    //
    // Обе силы идут за курсором БЕЗ инерции. Инерция оставлена
    // только сдвигу пузыря целиком, и живёт она в JS.
    float rr   = max(radius, 1.0);
    vec3  toP  = world - uPointer;
    float dp   = length(toP) / rr;
    float dent = exp(-dp * dp * 0.6);

    vec3  cToC = P.xyz - uPointer;
    float lenC = length(cToC);
    float dc   = lenC / rr;
    // Хвост, а не колокол: 1 в середине пузыря, 0.6 на трёх радиусах,
    // 0.14 на десяти. Мёртвых зон по расстоянию нет вовсе.
    float reach = 1.0 / (1.0 + dc * dc * 0.045);
    // При курсоре ровно в центре ось вырождается — и это не ошибка,
    // а нужный случай: axis становится нулевым, side нулевым, и всё
    // сжатие превращается в равномерную раздачу оболочки наружу.
    vec3  axis = cToC / max(lenC, 0.001 * rr);
    float side = dot(unit, axis);
    // Внутри пузыря сжатие гасится: там ось «курсор → центр» почти
    // вырождена, а главное — сжатие тянуло бы ближнюю сторону внутрь
    // ровно там, где вмятина раздаёт её наружу, и две силы гасили бы
    // друг друга. Замер это и показал: отклик в середине просел
    // с 24 % до 10 %.
    // 0.14, а не 0.38. Сжатие вдоль оси — это ровно то, что делает
    // из шара эллипсоид, и при 0.38 пузыри читались эллипсами всё
    // время, пока курсор на первом экране: хвост reach длинный,
    // и сжатие доставало до всех разом.
    //
    // Сила отклика перенесена в ВМЯТИНУ. Она радиальная: когда курсор
    // внутри пузыря, оболочка раздаётся во все стороны одинаково
    // и остаётся шаром, а когда снаружи — проминается с одной стороны.
    // Так отклик заметен, а форма не врёт.
    float k    = reach * uPress * 0.14 * smoothstep(0.15, 1.0, dc);
    vec3  perp = unit - axis * side;
    world += axis * (-side * k * rr) + perp * (k * 0.5 * rr);
    world += normalize(toP + vec3(1e-4)) * dent * uPress * rr * 0.6;

    // Разлёт при лопании: у каждой точки своё направление и своя длина,
    // в том числе по глубине.
    world += spin(aVel, R.y, R.x) * radius * pop;

    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = max(-mv.z, 1.0);

    // Глубина. Перспектива на таком масштабе даёт разницу размера
    // в проценты, этого мало: шар остаётся плоским кольцом. Поэтому
    // ближние точки ЯВНО крупнее и плотнее, дальние мельче и глуше —
    // и по тому, как это переливается при повороте оболочки, видно,
    // что перед тобой шар.
    float near = clamp((uCamZ + radius - depth) / (2.0 * radius), 0.0, 1.0);
    float fade = 1.0 - pop;

    gl_PointSize = aSize * (0.5 + 0.85 * near) * uSizeScale / depth;

    vColor = aTint < 0.5 ? uColorA : (aTint < 1.5 ? uColorB : uColorC);
    vAlpha = (0.14 + 0.42 * near) * uInk * fade * fade;
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
    if (a <= 0.012) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

type Bubble = {
  /** Радиус закреплён за местом в пуле: геометрия статична, и число
   *  точек у места посчитано под этот радиус раз и навсегда. */
  r: number;
  x: number;
  y: number;
  z: number;
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
  rx: number;
  ry: number;
  wx: number;
  wy: number;
  /** время лопания, ноль — цел */
  popped: number;
  pop: number;
  /** место свободно и ждёт возвращения */
  gone: boolean;
};

/** Запретный прямоугольник в мировых координатах: строки
 *  подзаголовка. Точки поверх текста читаются мусором.
 *
 *  Именно ПРЯМОУГОЛЬНИК, а не полоса во всю ширину холста. Полоса
 *  разрезала зону плавания надвое и загоняла пузыри в верхнюю треть,
 *  где они наползали друг на друга. Строки подзаголовка занимают
 *  сильно не всю ширину колонки — слева и справа от них запрещать
 *  нечего, и от этой поправки простора стало заметно больше. */
type Rect = { top: number; bottom: number; left: number; right: number };

export function mount(canvas: HTMLCanvasElement, host: HTMLElement): (() => void) | null {
  const gl = makeGL(canvas);
  if (!gl) return null; // WebGL нет — просто ничего не показываем

  const phone = window.matchMedia('(max-width: 640px)').matches;
  const COUNT = phone ? 10 : 15;

  const tanHalf = Math.tan((FOV / 2) * (Math.PI / 180));
  let proj = perspective(FOV, 1, 1, 4000);
  let view = viewAt(1);

  let w = 1;
  let h = 1;
  let dpr = 1;
  let camZ = 1;
  let rects: Rect[] = [];
  /** Видимая часть холста в мировых координатах. Холст выходит левее
   *  кромки окна, и без этих границ пятая часть пузырей плавала бы
   *  в отрезанной области: на экране их было бы меньше, чем в коде. */
  let vis = { xmin: 0, xmax: 0, ymin: 0, ymax: 0 };

  // ─── Пул пузырей ────────────────────────────────────────────
  const bubbles: Bubble[] = [];
  const queue: number[] = []; // время возвращения освободившегося места

  const spin = (b: Bubble) => {
    const dir = Math.random() * Math.PI * 2;
    b.vx = Math.cos(dir) * 5;
    b.vy = Math.sin(dir) * 5;
    b.dir = dir;
    b.speed = rnd(3.5, 7);
    b.pa = rnd(14, 22);
    b.pb = rnd(25, 37);
    b.swayA = rnd(0.22, 0.5);
    b.swayB = rnd(0.1, 0.28);
    b.wx = rnd(-0.16, 0.16);
    b.wy = rnd(0.12, 0.3) * (Math.random() < 0.5 ? -1 : 1);
    b.rx = Math.random() * 6.28;
    b.ry = Math.random() * 6.28;
    b.popped = 0;
    b.pop = 0;
    b.gone = false;
  };

  for (let i = 0; i < COUNT; i++) {
    const b: Bubble = {
      r: rnd(17, 34) * (phone ? 0.82 : 1),
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, dir: 0, speed: 0, pa: 1, pb: 1, swayA: 0, swayB: 0,
      rx: 0, ry: 0, wx: 0, wy: 0, popped: 0, pop: 0, gone: false,
    };
    spin(b);
    bubbles.push(b);
  }

  // ─── Геометрия: один объект на все пузыри, единичные сферы ───
  const counts = bubbles.map((b) => Math.round(b.r * 6));
  const total = counts.reduce((a, n) => a + n, 0);
  const pos = new Float32Array(total * 3);
  const vel = new Float32Array(total * 3);
  const size = new Float32Array(total);
  const tint = new Float32Array(total);
  const phase = new Float32Array(total);
  const who = new Float32Array(total);

  let k = 0;
  bubbles.forEach((b, bi) => {
    const n = counts[bi];
    for (let i = 0; i < n; i++) {
      // Точки садятся на оболочку по спирали Фибоначчи, а не случайно:
      // случайные сбиваются в комки, и шар перестаёт читаться шаром.
      const y = 1 - (2 * i + 1) / n;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * 2.399963229728653; // золотой угол
      const jit = 1 + rnd(-0.035, 0.035); // иначе спираль видна узором
      const x = Math.cos(th) * rad;
      const z = Math.sin(th) * rad;
      pos[k * 3] = x * jit;
      pos[k * 3 + 1] = y * jit;
      pos[k * 3 + 2] = z * jit;

      const s = rnd(0.8, 1.9); // длина разлёта в долях радиуса
      vel[k * 3] = x * s;
      vel[k * 3 + 1] = y * s + rnd(0.06, 0.4);
      vel[k * 3 + 2] = z * s;

      size[k] = rnd(1.2, 2.6);
      tint[k] = (Math.random() * 3) | 0;
      phase[k] = Math.random() * Math.PI * 2;
      who[k] = bi;
      k++;
    }
  });

  const program = makeProgram(gl, vert(COUNT), FRAG);
  if (!program) return null;
  gl.useProgram(program);

  const buffers = [
    staticAttrib(gl, program, 'position', pos, 3),
    staticAttrib(gl, program, 'aVel', vel, 3),
    staticAttrib(gl, program, 'aSize', size, 1),
    staticAttrib(gl, program, 'aTint', tint, 1),
    staticAttrib(gl, program, 'aPhase', phase, 1),
    staticAttrib(gl, program, 'aBubble', who, 1),
  ];

  const U = (name: string) => gl.getUniformLocation(program, name);
  const uSizeScale = U('uSizeScale');
  const uCamZ = U('uCamZ');
  const uPointerU = U('uPointer');
  const uPress = U('uPress');
  const uTime = U('uTime');
  const uInk = U('uInk');
  const uColorA = U('uColorA');
  const uColorB = U('uColorB');
  const uColorC = U('uColorC');
  const uPosU = U('uPos[0]');
  const uRotU = U('uRot[0]');
  const uProj = U('projectionMatrix');
  const uView = U('viewMatrix');

  // Точки полупрозрачны и лежат друг за другом: глубина не нужна,
  // смешивание — обычное «поверх».
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const posArr = new Float32Array(COUNT * 4);
  const rotArr = new Float32Array(COUNT * 4);

  // ─── Цвета из токенов ───────────────────────────────────────
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    gl.useProgram(program);
    gl.uniform1f(uInk, parseFloat(cs.getPropertyValue('--bubbles-ink')) || 1);
    const c = TOKENS.map((t) => readRgb(cs.getPropertyValue(t)));
    gl.uniform3fv(uColorA, c[0]);
    gl.uniform3fv(uColorB, c[1]);
    gl.uniform3fv(uColorC, c[2]);
  };

  /** Число целых пузырей — единственная наружная примета состояния:
   *  проверке иначе не за что зацепиться, а пиксели считать ненадёжно. */
  const publish = () => {
    const n = String(bubbles.filter((b) => !b.gone && !b.popped).length);
    if (canvas.dataset.bubbles !== n) canvas.dataset.bubbles = n;
  };

  // ─── Размеры и запретные прямоугольники ─────────────────────
  const measureBand = () => {
    // Отсчёт от ХОЛСТА: начало мировых координат лежит в его центре.
    const cb = canvas.getBoundingClientRect();
    const pad = 10;
    const put = (el: Element | null): Rect | null => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return null;
      return {
        top: h / 2 - (b.top - cb.top) + pad,
        bottom: h / 2 - (b.bottom - cb.top) - pad,
        left: b.left - cb.left - w / 2 - pad,
        right: b.right - cb.left - w / 2 + pad,
      };
    };
    rects = [put(host.querySelector('.hero__lead'))].filter(Boolean) as Rect[];
  };

  /** Накрывает ли пузырь какой-нибудь запретный прямоугольник. */
  const inBand = (x: number, y: number, r: number) => {
    const keep = r * 1.7;
    for (const q of rects) {
      if (x > q.left - keep && x < q.right + keep && y - keep < q.top && y + keep > q.bottom) return true;
    }
    return false;
  };

  /** Ставит пузырь в свободное место: не над строками подзаголовка,
   *  не вплотную к соседям и не туда, где только что лопнул
   *  предыдущий. */
  const place = (b: Bubble, avoid?: { x: number; y: number }) => {
    for (let i = 0; i < 24; i++) {
      const x = rnd(vis.xmin + b.r * EDGE, vis.xmax - b.r * EDGE);
      const y = rnd(vis.ymin + b.r * EDGE, vis.ymax - b.r * EDGE);
      if (inBand(x, y, b.r)) continue;
      if (avoid && Math.hypot(x - avoid.x, y - avoid.y) < 140) continue;
      // Не вплотную к уже стоящим: иначе десяток шаров ставится
      // в кучу и первые секунды они разбираются друг с другом.
      let near = false;
      for (const o of bubbles) {
        if (o === b || o.gone) continue;
        if (Math.hypot(x - o.x, y - o.y) < (b.r + o.r) * 1.25) { near = true; break; }
      }
      if (near && i < 18) continue;
      b.x = x;
      b.y = y;
      b.z = rnd(-b.r * 0.5, b.r * 0.5);
      return;
    }
    b.x = rnd(vis.xmin + b.r * EDGE, vis.xmax - b.r * EDGE);
    b.y = vis.ymax - b.r;
    b.z = 0;
  };

  const resize = () => {
    // Геометрия считается от СЕКЦИИ и записывается холсту. Обратной
    // связи нет: холст ничего не решает сам, он получает готовые
    // числа. Левый край уходит ровно до кромки окна — ни пикселем
    // дальше, иначе слой вылезает за экран и это ловит проверка
    // разрешений.
    const hb = host.getBoundingClientRect();
    w = Math.max(1, Math.round(hb.left + hb.width));
    h = Math.max(1, Math.round(hb.height));
    canvas.style.left = `${-Math.round(hb.left)}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    // Геометрия задана — можно показывать. До этого момента холст
    // скрыт, иначе его переезд из 300×150 в углу засчитывается
    // сдвигом вёрстки.
    canvas.style.visibility = 'visible';
    dpr = Math.min(1, window.devicePixelRatio || 1); // ПРОБА dpr 1
    // Камера отодвинута так, что на плоскости z = 0 единица мира —
    // ровно один css-пиксель. Тогда радиусы и размеры точек задаются
    // в пикселях и не зависят от размера окна.
    camZ = h / 2 / tanHalf;
    proj = perspective(FOV, w / h, 1, 4000);
    view = viewAt(camZ);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniformMatrix4fv(uView, false, view);
    measureBand();
    // Видимая часть холста в мировых координатах. По ширине он теперь
    // ровно от кромки окна до правого края колонки, а вот по высоте
    // может уходить ниже экрана — там пузырям делать нечего.
    const vh = window.innerHeight;
    vis = {
      xmin: -w / 2,
      xmax: w / 2,
      ymin: h / 2 - Math.min(h, vh - hb.top),
      ymax: h / 2 - Math.max(0, -hb.top),
    };
    gl.uniform1f(uSizeScale, dpr * camZ);
    gl.uniform1f(uCamZ, camZ);
    for (const b of bubbles) {
      b.x = Math.max(vis.xmin + b.r * EDGE, Math.min(vis.xmax - b.r * EDGE, b.x));
      b.y = Math.max(vis.ymin + b.r * EDGE, Math.min(vis.ymax - b.r * EDGE, b.y));
    }
  };

  resize();
  readColors();
  for (const b of bubbles) place(b);
  publish();

  // ─── Курсор ─────────────────────────────────────────────────
  // Слой мышь не ловит (pointer-events: none), поэтому положение
  // курсора слушается НА ОКНЕ и переводится в координаты сцены,
  // а попадание по пузырю считается вручную.
  //
  // Слушать окно, а не секцию, обязательно. Холст выходит из колонки
  // ВЛЕВО до кромки окна, и та его часть лежит уже не над секцией:
  // события туда не доходили вовсе, и примерно пятая часть поля была
  // мёртвой — пузыри там не отзывались ни на что. Замер по сетке
  // точек показывал 84 мёртвые пробы из 468. С окном мёртвых зон
  // не бывает по построению: нет элемента, чьи границы могли бы
  // не совпасть с границами поля.
  //
  // Курсоров ДВА, и это не дублирование.
  //
  // `pointer` — сырой, без сглаживания вовсе: он уходит в шейдер,
  // и оболочка обязана идти прямо за курсором. Прежде сюда шла
  // сглаженная позиция с постоянной около 150 мс, и отклик заметно
  // отставал от руки.
  //
  // `pointerSoft` — сглаженный, и только для сдвига пузыря ЦЕЛИКОМ.
  // Эту силу дёргать нельзя: пузырь, скачками уезжающий от курсора,
  // невозможно поймать.
  const pointer = vec(1e5, 1e5, 0);
  const pointerSoft = vec(1e5, 1e5, 0);
  let press = 0;
  let pressTo = 0;
  /** Экспоненциальное приближение с постоянной времени в секундах. */
  const toward = (cur: number, aim: number, tau: number, dt: number) =>
    cur + (aim - cur) * (1 - Math.exp(-dt / tau));

  const toWorld = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left - w / 2, y: h / 2 - (e.clientY - rect.top) };
  };

  /** Курсор над самим полем — независимо от того, что лежит сверху. */
  const inField = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right
        && e.clientY >= r.top && e.clientY <= r.bottom;
  };

  const INTERACTIVE = 'a, button, input, label, summary, [role="button"], [data-lenis-scrollable]';

  const hitTest = (x: number, y: number) => {
    let best: Bubble | null = null;
    let bd = Infinity;
    for (const b of bubbles) {
      if (b.gone || b.popped) continue;
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < b.r * 1.05 && d < bd) { bd = d; best = b; }
    }
    return best;
  };

  const onMove = (e: PointerEvent) => {
    if (!inField(e)) { onLeave(); return; }
    const { x, y } = toWorld(e);
    pointer.x = x; pointer.y = y;
    if (pointerSoft.x > 5e4) { pointerSoft.x = pointer.x; pointerSoft.y = pointer.y; }
    pressTo = 1;
    // Курсор меняем только над собственным фоном секции: над текстом
    // и ссылками свой курсор, и подменять его нечем и незачем.
    if (e.target === host) host.style.cursor = hitTest(x, y) ? 'pointer' : '';
  };

  const onLeave = () => {
    // Позицию НЕ уводим в бесконечность сразу: оболочка должна
    // разгладиться плавно, а не отпустить скачком. Курсор паркуется
    // сам, когда нажим доедет до нуля.
    pressTo = 0;
    host.style.cursor = '';
  };

  const onDown = (e: PointerEvent) => {
    if (!inField(e)) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest(INTERACTIVE)) return;
    const { x, y } = toWorld(e);
    // На касании курсора нет, поэтому реакцию оболочки запускает само
    // касание: палец ведут — пузыри проминаются, как под мышью.
    pointer.x = x; pointer.y = y;
    if (pointerSoft.x > 5e4) { pointerSoft.x = pointer.x; pointerSoft.y = pointer.y; }
    pressTo = 1;
    const hit = hitTest(x, y);
    if (!hit) return;
    hit.popped = gsap.ticker.time * 1000;
    host.style.cursor = '';
    publish();
  };

  // Палец, в отличие от курсора, уходит со стекла совсем: без этого
  // нажим, поднятый касанием, остался бы поднятым навсегда.
  const onUp = (e: PointerEvent) => { if (e.pointerType !== 'mouse') onLeave(); };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  window.addEventListener('pointercancel', onUp, { passive: true });
  // Курсор ушёл из окна совсем — оболочка разглаживается.
  document.addEventListener('pointerleave', onLeave, { passive: true });

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

    // Нажим набирается почти мгновенно (35 мс) и отпускает медленно
    // (220 мс): пока курсор рядом, оболочка держится промятой, ушёл —
    // плавно возвращается. Раньше обе стороны шли по 250 мс, и вход
    // в реакцию отставал от руки ровно настолько, чтобы это читалось
    // запаздыванием.
    press = toward(press, pressTo, pressTo > press ? 0.035 : 0.22, dt);
    // Сглаженный курсор — только для сдвига пузыря целиком.
    if (pressTo > 0) {
      pointerSoft.x = toward(pointerSoft.x, pointer.x, 0.12, dt);
      pointerSoft.y = toward(pointerSoft.y, pointer.y, 0.12, dt);
    }
    // Отпустили и разгладилось — курсор уходит с поля.
    if (pressTo === 0 && press < 0.002) {
      pointer.x = 1e5; pointer.y = 1e5;
      pointerSoft.x = 1e5; pointerSoft.y = 1e5;
    }
    gl.useProgram(program);
    gl.uniform1f(uTime, t / 1000);
    gl.uniform3f(uPointerU, pointer.x, pointer.y, pointer.z);
    gl.uniform1f(uPress, press);

    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];

      if (b.popped) {
        b.pop = Math.min(1, (t - b.popped) / POP_MS);
        if (b.pop >= 1) {
          b.gone = true;
          b.popped = 0;
          queue.push(t + rnd(RESPAWN_MIN, RESPAWN_MAX));
        }
      }

      if (!b.gone && !b.popped) {
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
        const dx = b.x - pointerSoft.x;
        const dy = b.y - pointerSoft.y;
        const dd = Math.hypot(dx, dy);
        if (dd < b.r * 3.2 && dd > 0.001) {
          const kk = Math.sin(Math.PI * (dd / (b.r * 3.2))) * press * 16;
          b.vx += ((dx / dd) * kk - 0) * Math.min(1, dt * 1.6);
          b.vy += ((dy / dd) * kk - 0) * Math.min(1, dt * 1.6);
        }

        // Инерция: скорость догоняет цель, а не подменяется ею.
        b.vx += (tx - b.vx) * Math.min(1, dt * 1.6);
        b.vy += (ty - b.vy) * Math.min(1, dt * 1.6);

        // Расталкивание соседей. Пузырей стало вдвое больше, и без
        // него они слипаются в комки: два наложившихся шара читаются
        // одним мятым пятном, а не двумя объёмами. Сила слабая
        // и работает только вплотную — это не бильярд, а взаимное
        // уважение. Каждая пара считается один раз.
        for (let j = i + 1; j < bubbles.length; j++) {
          const o = bubbles[j];
          if (o.gone || o.popped) continue;
          const ox = b.x - o.x;
          const oy = b.y - o.y;
          const od = Math.hypot(ox, oy);
          const want = (b.r + o.r) * 1.4;
          if (od > want || od < 0.001) continue;
          const push = (1 - od / want) * 42 * dt;
          b.vx += (ox / od) * push;
          b.vy += (oy / od) * push;
          o.vx -= (ox / od) * push;
          o.vy -= (oy / od) * push;
        }

        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.ry += b.wy * dt;
        b.rx += b.wx * dt;

        // Мягкий отскок от кромок кадра.
        // Разворот происходит НА РАССТОЯНИИ от края, а не у самого
        // края. Запас — радиус плюс то, на что оболочку отжимает
        // курсор: иначе под блоками условий видна прямая линия,
        // на которой пузыри срезаются кромкой холста. Кромка должна
        // не читаться вовсе, а для этого до неё нельзя доходить.
        const k6 = b.r * EDGE;
        if (b.x < vis.xmin + k6) { b.x = vis.xmin + k6; b.dir = Math.PI - b.dir; b.vx = Math.abs(b.vx); }
        if (b.x > vis.xmax - k6) { b.x = vis.xmax - k6; b.dir = Math.PI - b.dir; b.vx = -Math.abs(b.vx); }
        if (b.y < vis.ymin + k6) { b.y = vis.ymin + k6; b.dir = -b.dir; b.vy = Math.abs(b.vy); }
        if (b.y > vis.ymax - k6) { b.y = vis.ymax - k6; b.dir = -b.dir; b.vy = -Math.abs(b.vy); }

        // Запретный прямоугольник: строки подзаголовка.
        for (const q of rects) {
          const keep = b.r * 1.7;
          const top = q.top + keep;
          const bot = q.bottom - keep;
          if (b.x < q.left - keep || b.x > q.right + keep) continue;
          if (b.y >= top || b.y <= bot) continue;
          // Выталкиваем к ближайшей стороне, в том числе вбок:
          // прямоугольник узкий, и выход через бок часто ближе.
          const dTop = top - b.y;
          const dBot = b.y - bot;
          const dLeft = b.x - (q.left - keep);
          const dRight = q.right + keep - b.x;
          const m = Math.min(dTop, dBot, dLeft, dRight);
          if (m === dTop) { b.y = top; b.vy = Math.abs(b.vy); b.dir = -b.dir; }
          else if (m === dBot) { b.y = bot; b.vy = -Math.abs(b.vy); b.dir = -b.dir; }
          else if (m === dLeft) { b.x = q.left - keep; b.vx = -Math.abs(b.vx); b.dir = Math.PI - b.dir; }
          else { b.x = q.right + keep; b.vx = Math.abs(b.vx); b.dir = Math.PI - b.dir; }
        }
      }

      const o4 = i * 4;
      posArr[o4] = b.x;
      posArr[o4 + 1] = b.y;
      posArr[o4 + 2] = b.z;
      // Пустое место прячем нулевым радиусом: точки схлопываются
      // в центр и гаснут прозрачностью через pop = 1.
      posArr[o4 + 3] = b.gone ? 0.0001 : b.r;
      rotArr[o4] = b.rx;
      rotArr[o4 + 1] = b.ry;
      rotArr[o4 + 2] = b.gone ? 1 : b.pop;
      rotArr[o4 + 3] = 0;
    }

    // Освободившиеся места возвращаются через паузу: число держится.
    for (let i = queue.length - 1; i >= 0; i--) {
      if (t < queue[i]) continue;
      queue.splice(i, 1);
      const free = bubbles.find((b) => b.gone);
      if (!free) continue;
      spin(free);
      place(free, { x: pointerSoft.x, y: pointerSoft.y });
    }
    publish();

    gl.uniform4fv(uPosU, posArr);
    gl.uniform4fv(uRotU, rotArr);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, total);
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
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('webglcontextlost', onLost);
    ro.disconnect();
    io.disconnect();
    mo.disconnect();
    host.style.cursor = '';
    for (const b of buffers) if (b) gl.deleteBuffer(b);
    gl.deleteProgram(program);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  };
}
