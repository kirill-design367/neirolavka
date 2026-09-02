/**
 * Пузыри первого экрана: облака точек на поверхности сферы.
 *
 * Собрано на Three.js заново. Единственное требование к качеству —
 * ТОЧКА ДОЛЖНА БЫТЬ КРУГЛОЙ И ГЛАДКОЙ на любом экране, и ради этого
 * здесь тратится всё, что можно потратить.
 *
 * Как это достигается — три вещи вместе, и ни одна поодиночке
 * не хватает:
 *
 *   1. НАДВЫБОРКА. Холст рисуется вдвое плотнее экрана и уменьшается
 *      браузером при показе. На каждый пиксель экрана приходится
 *      четыре выборки — это и есть настоящее сглаживание, а не
 *      подкрашивание кромки. Замер прошлого захода показал, что
 *      у точки в три пикселя круга не бывает ни при каком способе
 *      отрисовки: столько пикселей нечем занять. Надвыборка эту
 *      границу отодвигает вчетверо.
 *   2. МЯГКИЙ ПРОФИЛЬ. Точка — не диск с обрезкой по краю, а пятно
 *      с плотным ядром и спадом до нуля. У такого пятна кромки нет
 *      вовсе, а значит нечему и лесенкой пойти.
 *   3. НИЖНИЙ РАЗМЕР. Точка тоньше двух с половиной отсчётов буфера
 *      поднимается до порога с ослаблением краски на квадрат подъёма:
 *      чернил столько же, а форма снова считается по пикселям.
 *
 * Всё остальное — устройство поля. Пузырей десять на десктопе и шесть
 * на телефоне, они живут только в первом экране, лежат ПОД всем
 * содержимым и мышь не ловят: попадание ищется по координатам.
 */
import * as THREE from 'three';
import gsap from 'gsap';

/** Угол обзора. От него зависит, на каком расстоянии единица мира
 *  равна css-пикселю. */
const FOV = 45;
/** Насколько радиусов пузырь держится от кромки холста. Пузырь должен
 *  разворачиваться ЗАДОЛГО до края, иначе видна прямая, на которой
 *  он срезается. */
const EDGE = 1.6;
/** Сколько живёт разлёт после нажатия и через сколько приходит новый. */
const POP_MS = 760;
const RESPAWN_MIN = 700;
const RESPAWN_MAX = 1300;
const TOKENS = ['--c-brand', '--c-accent', '--c-line-strong'] as const;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Цвет из токена в тройку 0..1. Разбираем сами: Three переводит цвет
 *  в линейное пространство, а шейдер пишет его как есть. */
const readRgb = (css: string): [number, number, number] => {
  const m = css.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return [0.5, 0.5, 0.5];
  return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
};

const VERT = (count: number) => /* glsl */ `
  precision highp float;
  #define N ${count}

  uniform mat4 projectionMatrix;
  uniform mat4 modelViewMatrix;

  uniform float uScale;    // плотность холста × расстояние камеры
  uniform float uCamZ;
  uniform vec3  uPointer;  // курсор в координатах мира
  uniform float uPress;    // сила реакции, 0..1
  uniform float uTime;
  uniform float uInk;      // плотность краски: своя у каждой темы
  uniform vec3  uColorA;
  uniform vec3  uColorB;
  uniform vec3  uColorC;
  /** xyz — центр пузыря, w — радиус в пикселях. */
  uniform vec4  uPos[N];
  /** x, y — углы поворота оболочки; z — доля разлёта 0..1. */
  uniform vec4  uRot[N];

  attribute vec3  position;  // точка на ЕДИНИЧНОЙ сфере
  attribute float aBubble;
  attribute float aSize;
  attribute float aTint;
  attribute float aPhase;
  attribute vec3  aVel;      // направление разлёта, в долях радиуса

  varying vec3  vColor;
  varying float vAlpha;

  vec3 spin(vec3 p, float ax, float ay) {
    float s = sin(ax), c = cos(ax);
    p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
    float s2 = sin(ay), c2 = cos(ay);
    return vec3(p.x * c2 + p.z * s2, p.y, -p.x * s2 + p.z * c2);
  }

  void main() {
    int bi = int(aBubble);
    vec4 P = uPos[bi];
    vec4 R = uRot[bi];
    float radius = P.w;
    float pop = R.z;

    // Оболочка медленно вращается, и по переливу размеров читается шар.
    // Лёгкое дыхание по фазе точки не даёт полю выглядеть застывшим.
    vec3 unit = spin(position, R.y, R.x) * (1.0 + 0.03 * sin(uTime * 0.7 + aPhase));
    vec3 world = P.xyz + unit * radius;

    // ─── Реакция на курсор ───────────────────────────────────
    //
    // Две разные силы, и путать их нельзя.
    //
    // ВМЯТИНА — местная: точки рядом с курсором расходятся прочь.
    // Когда курсор оказывается в самой середине пузыря, она же
    // раздаёт оболочку во все стороны, поэтому мёртвой зоны
    // в центре нет.
    vec3  toP  = world - uPointer;
    float dp   = length(toP) / radius;
    float dent = exp(-dp * dp * 1.6);

    // СЖАТИЕ вдоль оси «курсор → центр»: ближняя сторона внутрь,
    // дальняя наружу. Хвост 1/(1+d²), а НЕ колокол: колокол падает
    // в ноль уже на паре радиусов, и пузыри, мимо которых курсор
    // проходит в стороне, не шевелились бы вовсе.
    vec3  toC  = P.xyz - uPointer;
    float dc   = length(toC) / max(radius, 26.0);
    float reach = 1.0 / (1.0 + dc * dc * 0.045);
    vec3  axis = normalize(toC + vec3(1e-4));
    float side = dot(unit, axis);
    float rr   = radius;

    // Внутри пузыря сжатие гасится: там оно тянуло бы ближнюю сторону
    // ровно туда, откуда её выдавливает вмятина, и обе силы гасили бы
    // друг друга.
    float k = reach * uPress * 0.14 * smoothstep(0.15, 1.0, dc);
    vec3  perp = unit - axis * side;
    world += axis * (-side * k * rr) + perp * (k * 0.5 * rr);
    world += normalize(toP + vec3(1e-4)) * dent * uPress * rr * 0.6;

    // Разлёт при лопании: у каждой точки своё направление и своя длина,
    // в том числе по глубине.
    world += spin(aVel, R.y, R.x) * radius * pop;

    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = max(-mv.z, 1.0);

    // Глубина задана ЯВНО, а не перспективой: на таком масштабе
    // перспектива даёт разницу в проценты, и шар остался бы плоским
    // кольцом. Ближние точки крупнее и плотнее, дальние мельче и глуше.
    float near = clamp((uCamZ + radius - depth) / (2.0 * radius), 0.0, 1.0);
    float fade = 1.0 - pop;

    float px = aSize * (0.5 + 0.85 * near) * uScale / depth;

    // Нижний размер: точка тоньше двух с половиной отсчётов буфера
    // круглой быть не может — её поднимаем до порога и во столько же
    // раз ослабляем краску. Площадь растёт как квадрат размера,
    // поэтому делить надо на квадрат; чернил остаётся столько же.
    float up = max(1.0, 2.5 / max(px, 0.0001));
    gl_PointSize = px * up;

    vColor = aTint < 0.5 ? uColorA : (aTint < 1.5 ? uColorB : uColorC);
    vAlpha = (0.16 + 0.44 * near) * uInk * fade * fade / (up * up);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    // Точка — ПЯТНО, а не диск с обрезкой: плотное ядро и спад до нуля
    // к краю спрайта. У пятна нет кромки, значит нечему пойти лесенкой.
    // Вместе с надвыборкой холста это и даёт круглый мягкий край.
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.18, 1.0, r)) * vAlpha;
    if (a <= 0.004) discard;
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
  vx: number;
  vy: number;
  dir: number;
  rx: number;
  ry: number;
  spx: number;
  spy: number;
  /** 0 — цел, 1 — разлетелся полностью. */
  pop: number;
  gone: boolean;
};

/** Поднимает пузыри в переданном узле. Возвращает уборщика или null,
 *  если WebGL недоступен. */
export function mount(host: HTMLElement): (() => void) | null {
  const phone = window.matchMedia('(max-width: 640px)').matches;

  const canvas = document.createElement('canvas');
  canvas.className = 'bubbles';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,   // сглаживание даёт надвыборка, а не MSAA
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    });
  } catch {
    canvas.remove();
    return null;
  }

  const COUNT = phone ? 6 : 10;
  const R_MIN = phone ? 10 : 15;
  const R_MAX = phone ? 26 : 54;
  /** Точек на единицу ПЛОЩАДИ оболочки. По площади, а не по радиусу:
   *  иначе плотность краски падала бы обратно пропорционально радиусу
   *  и крупные пузыри выглядели бы недорисованными. */
  const NA_PLOSHAD = 0.15;

  /** Размер точки от РАДИУСА её пузыря. Связь через корень, а не
   *  прямая: радиусы идут по логарифмической лесенке, и при линейной
   *  связи вся прибавка досталась бы двум самым крупным шарам. */
  const tochka = (r: number) => {
    const d = Math.sqrt(Math.max(0, (r - R_MIN) / (R_MAX - R_MIN)));
    return (phone ? 2.6 : 3.4) + (phone ? 2.0 : 2.6) * d;
  };

  const tanHalf = Math.tan((FOV / 2) * (Math.PI / 180));
  let w = 1;
  let h = 1;
  let dpr = 1;
  let camZ = 1;
  let vis = { xmin: -1, xmax: 1, ymin: -1, ymax: 1 };
  /** Запретные прямоугольники в координатах мира: там пузырям
   *  не место. Подробности — у measureBands ниже. */
  let bands: { left: number; right: number; top: number; bottom: number; keep: number }[] = [];

  // ─── Пул пузырей ────────────────────────────────────────────
  //
  // Радиусы берутся с ЛЕСЕНКИ, а не случайно из отрезка: случайные
  // на каждой третьей загрузке выпадают из середины, и поле читается
  // россыпью одинаковых бусин. Лесенка логарифмическая — на глаз
  // важно ОТНОШЕНИЕ размеров.
  const stupen = Math.pow(R_MAX / R_MIN, 1 / COUNT);
  const bubbles: Bubble[] = Array.from({ length: COUNT }, (_, i) => ({
    r: R_MIN * Math.pow(stupen, i + Math.random()),
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0,
    dir: rnd(0, Math.PI * 2),
    rx: rnd(0, Math.PI * 2),
    ry: rnd(0, Math.PI * 2),
    spx: rnd(0.05, 0.13) * (Math.random() < 0.5 ? -1 : 1),
    spy: rnd(0.04, 0.11) * (Math.random() < 0.5 ? -1 : 1),
    pop: 0,
    gone: false,
  }));

  const counts = bubbles.map((b) => Math.max(28, Math.round(b.r * b.r * NA_PLOSHAD)));
  const total = counts.reduce((a, c) => a + c, 0);

  const pos = new Float32Array(total * 3);
  const vel = new Float32Array(total * 3);
  const size = new Float32Array(total);
  const tint = new Float32Array(total);
  const phase = new Float32Array(total);
  const who = new Float32Array(total);

  // Точки садятся по спирали Фибоначчи с лёгким разбросом: случайные
  // сбиваются в комки, и шар перестаёт читаться шаром.
  let k = 0;
  bubbles.forEach((b, bi) => {
    const n = counts[bi];
    const zolot = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * i + 1) / n;
      const rad = Math.sqrt(Math.max(0, 1 - y * y));
      const th = zolot * i + rnd(-0.18, 0.18);
      const o3 = k * 3;
      pos[o3] = Math.cos(th) * rad;
      pos[o3 + 1] = y + rnd(-0.02, 0.02);
      pos[o3 + 2] = Math.sin(th) * rad;
      const vl = rnd(0.6, 2.1);
      vel[o3] = Math.cos(th) * rad * vl;
      vel[o3 + 1] = y * vl;
      vel[o3 + 2] = Math.sin(th) * rad * vl;
      size[k] = tochka(b.r) * rnd(0.86, 1.14);
      tint[k] = Math.floor(rnd(0, 3));
      phase[k] = rnd(0, Math.PI * 2);
      who[k] = bi;
      k++;
    }
  });

  const posArr = new Float32Array(COUNT * 4);
  const rotArr = new Float32Array(COUNT * 4);

  const uniforms = {
    uScale: { value: 1 },
    uCamZ: { value: 1 },
    uPointer: { value: new THREE.Vector3(1e5, 1e5, 0) },
    uPress: { value: 0 },
    uInk: { value: 1 },
    uTime: { value: 0 },
    uColorA: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uColorB: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uColorC: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uPos: { value: posArr },
    uRot: { value: rotArr },
  };

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geom.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geom.setAttribute('aBubble', new THREE.BufferAttribute(who, 1));

  const material = new THREE.RawShaderMaterial({
    vertexShader: VERT(COUNT),
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(points);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 4000);
  renderer.setClearAlpha(0);

  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    uniforms.uInk.value = parseFloat(cs.getPropertyValue('--bubbles-ink')) || 1;
    const c = TOKENS.map((t) => readRgb(cs.getPropertyValue(t)));
    uniforms.uColorA.value.set(c[0][0], c[0][1], c[0][2]);
    uniforms.uColorB.value.set(c[1][0], c[1][1], c[1][2]);
    uniforms.uColorC.value.set(c[2][0], c[2][1], c[2][2]);
  };

  /** Число целых пузырей наружу: единственная примета состояния,
   *  за которую можно зацепиться снаружи. */
  const publish = () => {
    const n = String(bubbles.filter((b) => !b.gone).length);
    if (canvas.dataset.bubbles !== n) canvas.dataset.bubbles = n;
  };

  /** Свободно ли место: над точкой не должно быть ни одного
   *  непрозрачного слоя. Признак ОБЩИЙ, а не список селекторов —
   *  тот устарел бы на первой новой карточке. */
  const svobodno = (cx: number, cy: number) => {
    for (const el of document.elementsFromPoint(cx, cy)) {
      if (el === document.body || el === document.documentElement) break;
      if (el === canvas) continue;
      const cs = getComputedStyle(el);
      if (cs.backgroundImage !== 'none') return false;
      const bg = cs.backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(bg)) {
        const m = bg.match(/[\d.]+/g);
        if (!m || m.length < 4 || Number(m[3]) > 0.05) return false;
      }
    }
    return true;
  };

  // ─── Запретные прямоугольники ───────────────────────────────
  //
  // Пузыри лежат ПОД содержимым и на буквы не попадают — но для
  // текста, стоящего прямо на фоне страницы, пузырь СТАНОВИТСЯ
  // фоном, а вместе с ним и контрастом. В тёмной теме приглушённый
  // текст на самой плотной краске даёт 1.54:1 при пороге 4.5,
  // и плотностью краски это не лечится: в сумерках краска СВЕТЛЕЕ
  // фона и идёт навстречу светлому тексту.
  //
  // Блок условий в списке не ради текста — он непрозрачный и сам
  // всё закрывает, — а ради ЩЕЛЕЙ между карточками: пузыри,
  // плававшие за ним, высовывались в них рваными полосками.
  const measureBands = () => {
    const cb = canvas.getBoundingClientRect();
    const pad = 10;
    const put = (sel: string, keep: number) => {
      const el = host.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) return null;
      return {
        top: h / 2 - (b.top - cb.top) + pad,
        bottom: h / 2 - (b.bottom - cb.top) - pad,
        left: b.left - cb.left - w / 2 - pad,
        right: b.right - cb.left - w / 2 + pad,
        keep,
      };
    };
    bands = [put('.hero__lead', 1.95), put('.terms', 1.05)].filter(Boolean) as typeof bands;
  };

  /** Накрывает ли пузырь запретный прямоугольник. */
  const inBand = (x: number, y: number, r: number) => {
    for (const q of bands) {
      const k2 = r * q.keep;
      if (x > q.left - k2 && x < q.right + k2 && y - k2 < q.top && y + k2 > q.bottom) return true;
    }
    return false;
  };

  /** Выталкивает пузырь из запретного прямоугольника.
   *
   *  Сторона выбирается кратчайшая — но ТОЛЬКО из тех, после которых
   *  пузырь остаётся в поле. Без этой оговорки выход из-под
   *  подзаголовка влево уносил пузырь за кромку окна, и он
   *  срезался по ней ровной прямой: подзаголовок начинается
   *  у левого поля страницы, и «ближайший выход» ведёт наружу.
   *
   *  Проход повторяется трижды: прямоугольники стоят один под другим,
   *  и выход из нижнего заносит пузырь в верхний. */
  const pushOut = (b: Bubble) => {
    const keep = b.r * EDGE;
    const xlo = vis.xmin + keep;
    const xhi = vis.xmax - keep;
    const ylo = vis.ymin + keep;
    const yhi = vis.ymax - keep;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const q of bands) {
        const k2 = b.r * q.keep;
        if (!(b.x > q.left - k2 && b.x < q.right + k2 && b.y - k2 < q.top && b.y + k2 > q.bottom)) continue;
        // d — сколько идти до выхода, v — куда встать, znak — куда
        // после этого смотрит скорость.
        const vyhody = [
          { d: b.x - (q.left - k2), os: 0, v: q.left - k2, znak: -1 },
          { d: (q.right + k2) - b.x, os: 0, v: q.right + k2, znak: 1 },
          { d: (q.top + k2) - b.y, os: 1, v: q.top + k2, znak: 1 },
          { d: b.y - (q.bottom - k2), os: 1, v: q.bottom - k2, znak: -1 },
        ];
        const vpole = (e: (typeof vyhody)[number]) => (e.os === 0 ? e.v >= xlo && e.v <= xhi : e.v >= ylo && e.v <= yhi);
        const godnye = vyhody.filter(vpole);
        const e = (godnye.length ? godnye : vyhody).reduce((a, c) => (c.d < a.d ? c : a));
        if (e.os === 0) {
          b.x = Math.max(xlo, Math.min(xhi, e.v));
          b.vx = Math.abs(b.vx) * e.znak;
          b.dir = Math.PI - b.dir;
        } else {
          b.y = Math.max(ylo, Math.min(yhi, e.v));
          b.vy = Math.abs(b.vy) * e.znak;
          b.dir = -b.dir;
        }
        moved = true;
      }
      if (!moved) return;
    }
  };

  const place = (b: Bubble, near?: { x: number; y: number }) => {
    const keep = b.r * EDGE;
    for (let t = 0; t < 40; t++) {
      const x = rnd(vis.xmin + keep, vis.xmax - keep);
      const y = rnd(vis.ymin + keep, vis.ymax - keep);
      if (near && Math.hypot(x - near.x, y - near.y) < b.r * 4) continue;
      if (inBand(x, y, b.r)) continue;
      // Не вплотную к уже стоящим. Без этого два облака садятся
      // рядом и читаются одним — вдвое шире любого настоящего
      // пузыря, отчего кажется, что поле срезано кромкой окна.
      let ryadom = false;
      for (const o of bubbles) {
        if (o === b || o.gone) continue;
        if (Math.hypot(x - o.x, y - o.y) < (b.r + o.r) * 1.25) { ryadom = true; break; }
      }
      if (ryadom && t < 24) continue;
      b.x = x;
      b.y = y;
      b.z = rnd(-b.r, b.r) * 0.3;
      b.pop = 0;
      b.gone = false;
      return;
    }
    // Место не нашлось за сорок попыток. Ставим к верхней кромке
    // поля — там запретов нет по построению.
    b.x = rnd(vis.xmin + keep, vis.xmax - keep);
    b.y = vis.ymax - keep;
    b.pop = 0;
    b.gone = false;
  };

  const resize = () => {
    const hb = host.getBoundingClientRect();
    // Холст шире секции: секция — это колонка текста с полями
    // страницы по бокам, а пузырям место по ВСЕЙ ширине первого
    // экрана. По высоте остаёмся в границах секции.
    w = Math.max(1, Math.round(document.documentElement.clientWidth));
    h = Math.max(1, Math.round(hb.height));
    canvas.style.left = `${-Math.round(hb.left)}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    // Геометрия задана — можно показывать. До этого холст скрыт, иначе
    // его переезд из 300×150 в углу засчитывается сдвигом вёрстки.
    canvas.style.visibility = 'visible';

    // ПЛОТНОСТЬ БУФЕРА ЗАДАНА ОТСЧЁТАМИ НА CSS-ПИКСЕЛЬ, А НЕ
    // МНОЖИТЕЛЕМ К dpr. Два отсчёта на css-пиксель — это ровно то,
    // что нужно точке в три-пять пикселей, чтобы её край считался
    // по пикселям, а не по четвертинкам. Ниже двух опускаться нельзя
    // (край снова пойдёт лесенкой), ниже НАСТОЯЩЕЙ плотности экрана —
    // тоже: холст пришлось бы растягивать, и мы бы своими руками
    // вернули то, от чего уходим.
    //
    // Множитель к dpr здесь был и оказался неверной меркой: на экране
    // двойной плотности он давал буфер 4536×1512 и 100 % кадров дольше
    // 17 мс — то есть страницу, которая не едет вовсе, при том что
    // точка круглее не становилась (0.983 против 0.959). Цена слоя —
    // это его пиксели, и мерить их надо в пикселях.
    dpr = Math.max(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);

    // Камера отодвинута так, что на плоскости z = 0 единица мира —
    // ровно один css-пиксель. Тогда радиусы и размеры точек задаются
    // в пикселях и не зависят от размера окна.
    camZ = h / 2 / tanHalf;
    camera.fov = FOV;
    camera.aspect = w / h;
    camera.position.set(0, 0, camZ);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    uniforms.uScale.value = dpr * camZ;
    uniforms.uCamZ.value = camZ;

    vis = { xmin: -w / 2, xmax: w / 2, ymin: -h / 2, ymax: h / 2 };
    measureBands();
    for (const b of bubbles) {
      const keep = b.r * EDGE;
      b.x = Math.max(vis.xmin + keep, Math.min(vis.xmax - keep, b.x));
      b.y = Math.max(vis.ymin + keep, Math.min(vis.ymax - keep, b.y));
    }
  };

  resize();
  readColors();
  for (const b of bubbles) place(b);
  publish();

  // ─── Курсор ─────────────────────────────────────────────────
  //
  // Курсоров ДВА, и это не запас. В шейдер уходит СЫРАЯ позиция:
  // оболочка обязана идти прямо за рукой, без сглаживания. Сглаженный
  // курсор существует отдельно и только для слабого сдвига пузыря
  // целиком — эту силу дёргать нельзя.
  const pointer = { x: 1e5, y: 1e5, z: 0 };
  const soft = { x: 1e5, y: 1e5 };
  let press = 0;
  let pressTo = 0;
  let mouseOver = false;

  /** Экранная точка в координаты мира. Начало — середина ХОЛСТА,
   *  а он шире секции, поэтому по горизонтали считаем от кромки окна. */
  const toWorld = (e: PointerEvent) => ({
    x: e.clientX - w / 2,
    y: h / 2 - (e.clientY - host.getBoundingClientRect().top),
  });

  const onMove = (e: PointerEvent) => {
    const hb = host.getBoundingClientRect();
    const inside = e.clientY >= hb.top && e.clientY <= hb.bottom;
    if (!inside) { pressTo = 0; mouseOver = false; host.style.cursor = ''; return; }
    const p = toWorld(e);
    pointer.x = p.x;
    pointer.y = p.y;
    if (soft.x > 1e4) { soft.x = p.x; soft.y = p.y; }
    pressTo = 1;
    mouseOver = true;
    // Указатель — только над собственным фоном секции: над текстом
    // и ссылками курсор свой.
    const nad = e.target === host && bubbles.some((b) => !b.gone
      && Math.hypot(b.x - p.x, b.y - p.y) < b.r);
    host.style.cursor = nad ? 'pointer' : '';
  };
  const onLeave = () => { pressTo = 0; mouseOver = false; host.style.cursor = ''; };

  const onDown = (e: PointerEvent) => {
    // Приоритет у интерфейса: над кнопкой, ссылкой или карточкой
    // нажатие достаётся им.
    const t = e.target as Element | null;
    if (t?.closest('a, button, input, label, summary, [role="button"]')) return;
    if (!svobodno(e.clientX, e.clientY)) return;
    const p = toWorld(e);
    let hit: Bubble | null = null;
    let best = Infinity;
    for (const b of bubbles) {
      if (b.gone) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < b.r && d < best) { best = d; hit = b; }
    }
    if (!hit) return;
    const target = hit;
    gsap.to(target, {
      pop: 1,
      duration: POP_MS / 1000,
      ease: 'power2.out',
      onComplete: () => {
        target.gone = true;
        target.pop = 1;
        publish();
        gsap.delayedCall(rnd(RESPAWN_MIN, RESPAWN_MAX) / 1000, () => {
          spinFresh(target);
          place(target, { x: soft.x, y: soft.y });
          publish();
        });
      },
    });
  };

  const spinFresh = (b: Bubble) => {
    b.rx = rnd(0, Math.PI * 2);
    b.ry = rnd(0, Math.PI * 2);
    b.dir = rnd(0, Math.PI * 2);
    b.vx = 0;
    b.vy = 0;
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointerleave', onLeave);

  // Цвета читаются не каждый кадр: в покое не читаются вовсе,
  // а наблюдатель за data-theme открывает окно, в котором цвет
  // перечитывается — так пузыри доезжают до новой темы вместе
  // со страницей.
  let colorWindow = 0;
  const mo = new MutationObserver(() => { colorWindow = gsap.ticker.time * 1000 + 700; });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Пока первый экран уехал, рисовать нечего.
  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
  io.observe(host);

  let prev = 0;
  let frames = 0;
  const step = (time: number) => {
    const t = time * 1000;
    const dt = prev ? Math.min(0.05, (t - prev) / 1000) : 0;
    prev = t;
    if (!visible) return;

    if (t < colorWindow && (frames & 3) === 0) readColors();
    frames++;

    // Нажим набирается за 35 мс и отпускает за 220: пока курсор рядом,
    // оболочка держится промятой, ушёл — плавно разглаживается.
    const tau = pressTo > press ? 0.035 : 0.22;
    press += (pressTo - press) * Math.min(1, dt / tau);

    if (mouseOver) {
      soft.x += (pointer.x - soft.x) * Math.min(1, dt / 0.25);
      soft.y += (pointer.y - soft.y) * Math.min(1, dt / 0.25);
    }

    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];

      // Дрейф с инерцией: направление медленно виляет, скорость
      // догоняет цель. Рывков не бывает по построению.
      b.dir += Math.sin(t / 1000 * 0.11 + i * 1.7) * dt * 0.5;
      const speed = 6 + (i % 3) * 2;
      b.vx += (Math.cos(b.dir) * speed - b.vx) * Math.min(1, dt / 1.4);
      b.vy += (Math.sin(b.dir) * speed - b.vy) * Math.min(1, dt / 1.4);

      // Слабый КОЛЬЦЕВОЙ сдвиг от курсора: ноль в самой середине,
      // наибольшее примерно в полутора радиусах, снова ноль дальше.
      // Так пузырь не убегает из-под руки и по нему можно попасть.
      if (!b.gone && soft.x < 1e4) {
        const dx = b.x - soft.x;
        const dy = b.y - soft.y;
        const d = Math.hypot(dx, dy) || 1;
        const q = d / b.r;
        const f = press * 26 * Math.exp(-Math.pow(q - 1.5, 2) * 0.8);
        b.vx += (dx / d) * f * dt;
        b.vy += (dy / d) * f * dt;
      }

      // Слабое взаимное расталкивание: без него дрейф рано или поздно
      // сводит два облака в одно пятно.
      if (!b.gone) {
        for (let j = 0; j < bubbles.length; j++) {
          if (j === i) continue;
          const o = bubbles[j];
          if (o.gone) continue;
          const dx = b.x - o.x;
          const dy = b.y - o.y;
          const d = Math.hypot(dx, dy) || 1;
          const nado = (b.r + o.r) * 1.15;
          if (d >= nado) continue;
          const f = (1 - d / nado) * 34;
          b.vx += (dx / d) * f * dt;
          b.vy += (dy / d) * f * dt;
        }
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Отражение от кромки: пузырь разворачивается заранее.
      const keep = b.r * EDGE;
      if (b.x < vis.xmin + keep) { b.x = vis.xmin + keep; b.vx = Math.abs(b.vx); b.dir = Math.PI - b.dir; }
      if (b.x > vis.xmax - keep) { b.x = vis.xmax - keep; b.vx = -Math.abs(b.vx); b.dir = Math.PI - b.dir; }
      if (b.y < vis.ymin + keep) { b.y = vis.ymin + keep; b.vy = Math.abs(b.vy); b.dir = -b.dir; }
      if (b.y > vis.ymax - keep) { b.y = vis.ymax - keep; b.vy = -Math.abs(b.vy); b.dir = -b.dir; }

      pushOut(b);

      b.rx += b.spx * dt;
      b.ry += b.spy * dt;

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

    uniforms.uTime.value = t / 1000;
    uniforms.uPointer.value.set(pointer.x, pointer.y, pointer.z);
    uniforms.uPress.value = press;

    // Отпустили и разгладилось — курсор уходит с поля.
    if (pressTo === 0 && press < 0.002) {
      pointer.x = 1e5; pointer.y = 1e5;
      soft.x = 1e5; soft.y = 1e5;
    }

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
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('webglcontextlost', onLost);
    ro.disconnect();
    io.disconnect();
    mo.disconnect();
    host.style.cursor = '';
    geom.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
}
