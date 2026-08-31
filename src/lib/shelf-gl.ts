/**
 * Витрина продуктов: три карточки по дуге в настоящем трёхмерном
 * пространстве.
 *
 * ─── Почему сцена и слой HTML, а не одно из двух ───────────────────
 *
 * Текст обязан оставаться текстом: названия, сроки, цены и кнопки
 * должны выделяться, читаться скринридером и попадать в поиск.
 * Текстура внутри WebGL этого не умеет. Но и объём CSS-трансформациями
 * не изобразить — нужна общая камера, общая перспектива и тени,
 * которые считаются от положения предмета.
 *
 * Поэтому здесь ОДНА сцена Three.js и ДВА способа её показать:
 *
 *   1. Тени рисует WebGLRenderer — мягкие пятна под карточками,
 *      которые растут и уходят вместе с ними.
 *   2. Сами карточки — обычные узлы HTML, которым каждый кадр
 *      выставляется `matrix3d`, посчитанная из ТОЙ ЖЕ камеры и ТОГО ЖЕ
 *      графа сцены. Это то, что делает CSS3DRenderer из примеров
 *      Three.js, но здесь оно написано на месте: CSS3DRenderer
 *      переносит узлы в свой контейнер, а узлы принадлежат React,
 *      и отнимать их у него — верный способ получить рассинхрон
 *      при первом же обновлении состояния.
 *
 * Рассинхрона на кадр не бывает по построению: и тени, и матрицы
 * считаются в ОДНОМ вызове тикера из одних и тех же матриц. Браузер
 * применяет `transform` и показывает кадр холста в одной композиции.
 *
 * Такт — общий тикер GSAP. Своего requestAnimationFrame здесь нет,
 * как и второго экземпляра Three.js: библиотека уже загружена ради
 * пузырей и лежит в общем куске сборки.
 */
import {
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import gsap from 'gsap';

const FOV = 26;

/** Мягкое пятно тени: прямоугольник со скруглением и размытым краем. */
const SHADOW_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  uniform vec2  uHalf;    // полуразмер пятна в единицах мира
  uniform float uRadius;  // скругление угла
  uniform float uSoft;    // ширина размытия
  uniform vec3  uColor;
  uniform float uAlpha;

  float roundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0 * uHalf;
    float d = roundedBox(p, max(uHalf - uSoft, vec2(1.0)), uRadius);
    float a = 1.0 - smoothstep(-uSoft, uSoft, d);
    // Квадрат — чтобы у пятна был плотный центр и длинный мягкий хвост,
    // как у настоящей тени, а не ровная заливка с каймой.
    gl_FragColor = vec4(uColor, a * a * uAlpha);
  }
`;

const SHADOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const readRgb = (css: string): [number, number, number] => {
  const m = css.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return [0, 0, 0];
  return [+m[0] / 255, +m[1] / 255, +m[2] / 255];
};

/** Состояние одной карточки: к чему она едет и где сейчас. */
/** Куда карточка едет: место в сцене, разворот, размер, плотность. */
type Target = { x: number; y: number; z: number; ry: number; s: number; o: number; lift: number };

type Slot = {
  /** Створки и их содержимое: по обёртке — текущая высота,
   *  по содержимому — натуральная. */
  plansEl: HTMLElement | null;
  foldEl: HTMLElement | null;
  plansIn: HTMLElement | null;
  foldIn: HTMLElement | null;
  /** Высота без створок: считается только в покое. */
  base: number;
  /** Куда высота приедет: со створкой тарифов и со створкой «от N ₽». */
  hOpen: number;
  hShut: number;
  el: HTMLElement;
  group: Group;
  shadow: Mesh;
  mat: ShaderMaterial;
  /** Живые значения — их двигает GSAP, а тикер только читает. */
  now: Target;
  w: number;
  h: number;
};

const eps = (v: number) => (Math.abs(v) < 1e-10 ? 0 : v);

/** Матрица камеры для CSS: та же, что у Three, с перевёрнутой осью Y. */
const cameraCss = (m: readonly number[]) =>
  `matrix3d(${[
    eps(m[0]), eps(-m[1]), eps(m[2]), eps(m[3]),
    eps(m[4]), eps(-m[5]), eps(m[6]), eps(m[7]),
    eps(m[8]), eps(-m[9]), eps(m[10]), eps(m[11]),
    eps(m[12]), eps(-m[13]), eps(m[14]), eps(m[15]),
  ].join(',')})`;

/** Матрица предмета для CSS. */
const objectCss = (m: readonly number[]) =>
  `matrix3d(${[
    eps(m[0]), eps(m[1]), eps(m[2]), eps(m[3]),
    eps(-m[4]), eps(-m[5]), eps(-m[6]), eps(-m[7]),
    eps(m[8]), eps(m[9]), eps(m[10]), eps(m[11]),
    eps(m[12]), eps(m[13]), eps(m[14]), eps(m[15]),
  ].join(',')})`;

export type Shelf = {
  /** Указатель над карточкой: −1, если ни над одной. */
  setHover: (i: number) => void;
  /** Выбранная карточка. */
  setActive: (i: number) => void;
  /** Пересчитать раскладку: размеры карточек изменились. */
  refresh: () => void;
  dispose: () => void;
};

export function mount(root: HTMLElement, canvas: HTMLCanvasElement, cards: HTMLElement[]): Shelf | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 10, 6000);
  const tanHalf = Math.tan((FOV / 2) * (Math.PI / 180));

  const cameraEl = root.querySelector<HTMLElement>('.shelf3d__camera');
  if (!cameraEl) return null;

  let w = 1;
  let h = 1;
  let camZ = 1;
  let phone = false;

  const shadowGeo = new PlaneGeometry(1, 1);
  const slots: Slot[] = cards.map((el) => {
    const group = new Group();
    const mat = new ShaderMaterial({
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uHalf: { value: [150, 190] },
        uRadius: { value: 28 },
        uSoft: { value: 46 },
        uColor: { value: new Vector3(0, 0, 0) },
        uAlpha: { value: 0.5 },
      },
    });
    const shadow = new Mesh(shadowGeo, mat);
    group.add(shadow);
    scene.add(group);
    return {
      el,
      group,
      shadow,
      mat,
      plansEl: el.querySelector('.pcard__plans'),
      foldEl: el.querySelector('.pcard__fold'),
      plansIn: el.querySelector('.pcard__plansin'),
      foldIn: el.querySelector('.pcard__foldin'),
      base: 0,
      hOpen: 0,
      hShut: 0,
      now: { x: 0, y: 0, z: 0, ry: 0, s: 1, o: 1, lift: 0 },
      w: 300,
      h: 380,
    };
  });

  // ─── Цвет тени из токенов ───────────────────────────────────
  // Своего токена у сцены нет и не нужно: тень витрины — это та же
  // тень, что у карточек страницы, `--c-shadow-3`. Берётся и цвет,
  // и прозрачность; множитель — потому что тень в перспективе
  // растянута на большую площадь и с плотностью для box-shadow
  // расплылась бы в ничто.
  const readColors = () => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--c-shadow-3');
    const c = readRgb(raw);
    const m = raw.match(/-?[\d.]+/g);
    const a = m && m.length > 3 ? parseFloat(m[3]) : 0.2;
    for (const s of slots) {
      s.mat.uniforms.uColor.value.set(...c);
      s.mat.uniforms.uAlpha.value = Math.min(0.6, a * 2);
    }
  };

  // ─── Раскладка ──────────────────────────────────────────────
  let hover = -1;
  let active = 0;

  /** Куда карточка должна ехать при текущем наведении и выборе. */
  const targetOf = (i: number) => {
    const n = slots.length;
    const mid = (n - 1) / 2;
    const k = i - mid; // −1, 0, +1
    const me = i === (hover >= 0 ? hover : active);

    if (phone) {
      // Телефон — вертикальная стопка. Выбрана не лента: лента прячет
      // два товара из трёх и заводит вторую ось прокрутки, которая
      // дерётся с прокруткой страницы — на телефоне это самый верный
      // способ поймать палец не туда. Стопка показывает все три сразу
      // и листается тем же движением, что и вся страница.
      //
      // Смещение считается по НАКОПЛЕННЫМ высотам, а не по своей:
      // раскрытая карточка выше свёрнутых, и от равного шага соседи
      // наезжали бы друг на друга.
      // Высоты берутся ЦЕЛЕВЫЕ, а не текущие: створки едут вместе
      // с карточками, и если считать стопку по едущим высотам, цель
      // твина смещается каждый кадр и он перестаёт сходиться.
      let above = 0;
      for (let j = 0; j < i; j++) above += targetH(j) + 26;
      let all = -26;
      for (let j = 0; j < slots.length; j++) all += targetH(j) + 26;
      const y = all / 2 - above - targetH(i) / 2;
      return {
        x: 0,
        y,
        z: me ? 44 : 0,
        ry: 0,
        s: me ? 1 : 0.975,
        // Приглушение только до 0.9. Ниже прозрачность начинает есть
        // контраст: замер по настоящим пикселям даёт 5.16:1 в светлой
        // и 4.96:1 в тёмной при 0.9, но уже 4.33:1 и 4.38:1 при 0.82 —
        // то есть ниже порога 4.5:1. Приглушение здесь упирается
        // не во вкус, а в читаемость.
        o: me ? 1 : 0.9,
        lift: me ? 1 : 0.3,
      };
    }

    // Десктоп — дуга из трёх карточек. ВЫБРАННАЯ становится средней
    // и ближней, остальные разъезжаются по бокам и уходят вглубь,
    // развёрнутые к зрителю. Раскладка «места закреплены за товаром»
    // не годится: раскрытая карточка вдвое выше свёрнутых, и крайняя
    // из них наполовину вылезала за колонку, а соседку закрывала
    // целиком. Здесь же выбранное всегда в середине и всегда целиком
    // в кадре, а соседи выглядывают из-за него ровно настолько,
    // чтобы прочесть название.
    //
    // Порядок кольцевой: сосед справа от выбранного уходит вправо,
    // следующий заворачивается влево. Так карточки не перепрыгивают
    // друг через друга при смене выбора.
    const n2 = slots.length;
    const p = ((i - active + 1 + n2) % n2) - 1; // −1 слева, 0 в центре, +1 справа
    // Разлёт подобран так, чтобы боковая карточка выходила из-за
    // передней целиком: имя товара, спрятанное за соседом, — это
    // витрина, на которой не видно товара.
    const spread = Math.max(170, Math.min(0.4 * w, 300));

    // Под курсором одна карточка выходит вперёд — значит остальные
    // должны уступить ей место, иначе «вперёд» читается только
    // по размеру. Соседи отходят в сторону ОТ неё, чуть глубже
    // и чуть тише. Приглушение мягкое: текст на отступившей карточке
    // всё равно надо читать, а не угадывать.
    const giveWay = (t: Target) => {
      if (hover < 0 || hover === i) return t;
      const hp = ((hover - active + 1 + n2) % n2) - 1;
      const away = Math.sign(p - hp) || -Math.sign(hp) || 1;
      // Множитель 0.96, а не «на глаз»: 0.9 × 0.96 = 0.864, и на этой
      // плотности приглушённый текст даёт 4.75:1 в светлой теме
      // и 4.68:1 в тёмной. Прежние 0.92 давали 0.79 и 4.0:1 — ниже
      // порога, и проверка контраста это поймала.
      return { ...t, x: t.x + away * 26, z: t.z - 28, s: t.s * 0.985, o: t.o * 0.96 };
    };

    if (p === 0) {
      return giveWay({ x: 0, y: -10, z: 90, ry: 0, s: 1, o: 1, lift: 1 });
    }

    const side = {
      x: p * spread,
      y: 0,
      z: -200,
      ry: -p * 0.4,
      s: 0.94,
      o: 0.9,
      lift: 0.3,
    };
    // Наведение на боковую не переставляет её, а подаёт вперёд
    // и доворачивает: перестановка под курсором превратила бы
    // витрину в мельницу.
    if (hover === i) return { ...side, z: side.z + 110, ry: side.ry * 0.55, s: 0.98, o: 1, lift: 0.55 };
    return giveWay(side);
  };

  /** Едет ли сейчас хоть одна карточка. */
  const moving = () => slots.some((s) => gsap.isTweening(s.now));

  const apply = (instant = false) => {
    // Мгновенная установка допустима ТОЛЬКО когда ничего не едет.
    //
    // Иначе выходит вот что: нажатие раскрывает тарифы, карточка
    // становится выше, ResizeObserver зовёт resize(), тот ставит
    // положения мгновенно — и переход, который в этот момент идёт,
    // обрывается на первом же кадре. Человек видит рывок в сторону
    // и застывшую витрину. Пока что-то едет, новая цель не ставится
    // скачком, а перенацеливает уже идущий твин.
    const jump = instant && !moving();
    slots.forEach((s, i) => {
      const t = targetOf(i);
      const to = { x: t.x, y: t.y, z: t.z, ry: t.ry, s: t.s, o: t.o, lift: t.lift };
      if (jump) {
        Object.assign(s.now, to);
        touch(200);
        return;
      }
      // Инерция и премиальное замедление: длинный выход, никакой
      // линейности. Задержка по расстоянию от ведущей — соседи
      // уступают место чуть позже, чем она выходит вперёд.
      touch();
      gsap.to(s.now, {
        ...to,
        duration: 0.95,
        // inOut, а не out. У «out» скорость максимальна в первый же
        // кадр, и если браузер этот кадр пропустил — а сразу после
        // нажатия он его пропускает, там перерисовка карточек, —
        // движение начинается сразу с середины разгона и читается
        // рывком. У inOut начальная скорость нулевая, и пропущенный
        // кадр стоит единиц пикселей. Тот же ход, что у створок,
        // поэтому высота и положение едут в одном характере.
        ease: 'power2.inOut',
        overwrite: 'auto',
        delay: i === (hover >= 0 ? hover : active) ? 0 : 0.03,
      });
    });
  };

  /** Высота контейнера по ТЕКУЩИМ высотам карточек. */
  const layoutHeight = () => {
    // Высоту сцены задаёт содержимое: карточки вынуты из потока,
    // и сам по себе контейнер схлопнулся бы в ноль. Пишем только
    // при заметном изменении — иначе ResizeObserver зациклится.
    const tall = Math.max(...slots.map((s) => s.h));
    // Вышедшая вперёд карточка увеличена перспективой примерно
    // на четверть — высота сцены считается по ней, иначе выбранная
    // карточка вылезает на соседний блок.
    const need = phone
      ? slots.reduce((a, s) => a + s.h + 26, 0) + 60
      : Math.round(tall * 1.16 + 70);
    if (Math.abs((parseFloat(root.style.height) || 0) - need) > 2) {
      root.style.height = `${need}px`;
    }
  };

  const measure = () => {
    for (const s of slots) {
      s.w = Math.max(80, s.el.offsetWidth);
      s.h = Math.max(80, s.el.offsetHeight);
      s.mat.uniforms.uRadius.value = Math.min(s.w, s.h) * 0.22;

      // Высоты створок берутся у их СОДЕРЖИМОГО через scrollHeight —
      // оно не зависит от того, свёрнута створка сейчас или нет.
      const plansH = s.plansIn?.scrollHeight ?? 0;
      const foldH = s.foldIn?.scrollHeight ?? 0;
      // Базовая высота — всё, кроме створок. Считается вычитанием
      // ТЕКУЩИХ, анимируемых высот створок, а не натуральных: так
      // формула верна в любой момент, в том числе посреди перехода.
      // Считать по натуральным можно было бы только в покое, а measure()
      // зовут как раз в момент смены выбора, когда створки уже поехали.
      const usedPlans = s.plansEl?.offsetHeight ?? 0;
      const usedFold = s.foldEl?.offsetHeight ?? 0;
      s.base = Math.max(40, s.h - usedPlans - usedFold);
      s.hOpen = s.base + plansH;
      s.hShut = s.base + foldH;
    }
    layoutHeight();
  };

  /** Высота, к которой карточка приедет при заданном выборе. */
  const targetH = (i: number) => (i === active ? slots[i].hOpen : slots[i].hShut);

  const resize = () => {
    const r = root.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    phone = window.matchMedia('(max-width: 767px)').matches;
    // Плотность 0.6, а не 1. Тень размыта по построению: лишние точки
    // ей ничего не добавляют, а стоят ровно квадрату плотности. После
    // того как сцена перестала засыпать посреди перехода, отрисовка
    // теней пошла каждый кадр анимации, и на программном растеризаторе
    // это давало 29–31 % кадров дольше 17 мс. Понижение плотности
    // до 0.6 — это втрое меньше смешиваемых точек; на глаз у мягкого
    // пятна разницы нет.
    const dpr = 0.6;
    camZ = h / 2 / tanHalf;
    camera.aspect = w / h;
    camera.position.set(0, 0, camZ);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    // Перспектива слоя HTML берётся из той же камеры: иначе объём
    // теней и объём карточек разошлись бы.
    const persp = 0.5 / tanHalf * h;
    root.style.perspective = `${persp}px`;
    // Сдвиг в середину сцены стоит ПЕРВЫМ, а не последним.
    //
    // В примере CSS3DRenderer он последний — но там держатель камеры
    // размером со сцену, и все преобразования считаются от его центра.
    // Здесь держатель нулевой (иначе его собственная коробка уезжает
    // за экран и появляется горизонтальная прокрутка), а у нулевой
    // коробки начало отсчёта — угол. Оставленный последним сдвиг
    // попадал под отражение оси Y внутри матрицы камеры и уезжал
    // ВВЕРХ на половину высоты: карточки уходили из своего блока
    // и ложились на первый экран. Снаружи матрицы отражать его нечему.
    cameraEl.style.transform =
      `translate(${w / 2}px, ${h / 2}px) translateZ(${persp}px)${cameraCss(camera.matrixWorldInverse.elements)}`;

    measure();
    apply(true);
  };

  // ─── Кадр ───────────────────────────────────────────────────
  // Витрина, в отличие от пузырей, БОЛЬШУЮ ЧАСТЬ ВРЕМЕНИ СТОИТ.
  // Считать и перерисовывать её каждый кадр незачем: холст со всеми
  // тремя тенями — это миллионы смешиваемых точек, и на замере это
  // давало 46–68 % кадров дольше 17 мс. Поэтому кадры рисуются только
  // пока что-то едет: после каждого изменения открывается окно чуть
  // длиннее самой анимации, и по его истечении сцена замирает.
  let dirtyUntil = 0;
  // Окно ПРОДЛЕВАЕТСЯ, а не переписывается. Прежде здесь стояло
  // присваивание, и короткий touch(200) от ResizeObserver обрубал
  // окно, открытое на всю длину перехода: сцена засыпала посреди
  // анимации, карточки застывали на полпути, а следующее действие
  // одним кадром доставляло их в конечное положение.
  const touch = (ms = 1300) => {
    dirtyUntil = Math.max(dirtyUntil, gsap.ticker.time * 1000 + ms);
  };

  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { rootMargin: '120px' });
  io.observe(root);

  let colorWindow = 0;
  const mo = new MutationObserver(() => { colorWindow = gsap.ticker.time * 1000 + 700; touch(900); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let frames = 0;
  const step = (time: number) => {
    if (!visible) return;
    const t = time * 1000;
    if (t < colorWindow) {
      if ((frames & 3) === 0) readColors();
      touch(200);
    }
    frames++;
    // Спим только когда движения нет ВОВСЕ. Наличие движения берётся
    // у самого GSAP, а не у таймера: окно фиксированной длины уже
    // однажды закрылось раньше, чем доиграла анимация.
    const busy = moving();
    if (busy) touch(120);
    if (t > dirtyUntil) return;

    // Створки карточек едут своим ходом — их анимирует CSS. Сцена
    // не задаёт им высоту и не пересчитывает от неё раскладку: она
    // просто СЧИТЫВАЕТ высоту каждый кадр, пока что-то едет. Тень
    // и высота контейнера следуют за карточкой точно, а твин никто
    // не перенацеливает — именно из-за перенацеливания в прошлый раз
    // от анимации высоты пришлось отказаться.
    //
    // Чтение идёт ДО записи трансформаций: иначе браузер считает
    // раскладку дважды за кадр.
    if (busy) {
      for (const s of slots) s.h = Math.max(80, s.el.offsetHeight);
      layoutHeight();
    }

    for (const s of slots) {
      const n = s.now;
      // Карточка и её тень — один и тот же граф сцены. Матрица для CSS
      // и матрица для теней считаются из него в этом же кадре.
      s.group.position.set(n.x, n.y, n.z);
      s.group.rotation.set(0, n.ry, 0);
      s.group.scale.setScalar(n.s);
      s.group.updateMatrixWorld(true);

      s.el.style.transform = `translate(-50%,-50%)${objectCss(s.group.matrixWorld.elements)}`;
      s.el.style.opacity = String(n.o);
      s.el.style.zIndex = String(1000 + Math.round(n.z));

      // Тень уходит вниз и назад тем сильнее, чем выше поднята карточка,
      // и вместе с этим расплывается. Размер пятна вдвое меньше
      // карточки: тень от предмета, стоящего под углом, — это не его
      // силуэт, а мягкое пятно под ним.
      s.shadow.position.set(0, -s.h * 0.46 - n.lift * 30, -60 - n.lift * 50);
      // Пятно чуть шире карточки, но не вдвое: каждый лишний процент
      // площади — это смешиваемые точки на каждом кадре анимации.
      const sw = s.w * (1.12 + n.lift * 0.34);
      const sh = s.h * (0.7 + n.lift * 0.34);
      s.shadow.scale.set(sw, sh, 1);
      s.mat.uniforms.uHalf.value = [sw / 2, sh / 2];
      s.mat.uniforms.uSoft.value = Math.min(sw, sh) * (0.3 + n.lift * 0.14);
      s.mat.uniforms.uRadius.value = Math.min(sw, sh) * 0.24;
    }

    // Карточки получают матрицу КАЖДЫЙ кадр — за ними следит глаз.
    // Тени во время движения обновляются через кадр: это мягкие пятна
    // под предметом, и половинная частота на них не читается, а стоят
    // они дороже всего остального вместе взятого. Как только движение
    // кончилось, последний кадр теней рисуется обязательно, иначе
    // пятно осталось бы на полпути.
    if (!busy || (frames & 1) === 0) renderer.render(scene, camera);
  };

  readColors();
  resize();
  gsap.ticker.add(step);

  // Наблюдатель следит только за КОНТЕЙНЕРОМ и только за шириной.
  // За карточками он больше не следит: их высота меняется по нашему же
  // сценарию, и пересчёт сцены на каждый кадр створки — ровно то,
  // что разваливало твин.
  const ro = new ResizeObserver(() => {
    const rw = Math.round(root.getBoundingClientRect().width);
    if (rw === w && moving()) return;
    resize();
  });
  ro.observe(root);

  const onLost = (e: Event) => {
    e.preventDefault();
    gsap.ticker.remove(step);
    root.removeAttribute('data-3d');
  };
  canvas.addEventListener('webglcontextlost', onLost);

  return {
    setHover: (i) => { if (i !== hover) { hover = i; apply(); } },
    setActive: (i) => { if (i !== active) { active = i; apply(); } },
    refresh: () => { measure(); apply(); },
    dispose: () => {
      gsap.ticker.remove(step);
      canvas.removeEventListener('webglcontextlost', onLost);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      for (const s of slots) {
        gsap.killTweensOf(s.now);
        s.mat.dispose();
        s.el.style.transform = '';
        s.el.style.opacity = '';
        s.el.style.zIndex = '';
      }
      shadowGeo.dispose();
      scene.clear();
      renderer.dispose();
      root.style.perspective = '';
      cameraEl.style.transform = '';
    },
  };
}
