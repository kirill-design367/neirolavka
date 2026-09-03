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
/** Три цвета точек. СВОИ токены, а не заимствованные: раньше здесь
 *  стояли --c-brand, --c-accent и --c-line-strong, то есть цвета
 *  кромок, кнопок и текста, и насытить их ради пузырей было нельзя —
 *  они держат обводки карточек, шапку, светодиод шагов и подписи. */
const TOKENS = ['--c-bubble-1', '--c-bubble-2', '--c-bubble-3'] as const;

/** Цвет блика — тоже токен: это ЦВЕТ ЛАМПЫ, и в двух темах она разная.
 *  Днём светит белый день, вечером — тёплый огонёк лавки. */
const TOKEN_BLIK = '--c-bubble-blik';

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

  uniform vec2  uHolst;       // размер буфера в пикселях
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
  varying float vSize;
  varying vec2  vSeredina;

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
    // Дальность считается по расстоянию в РАДИУСАХ, но у радиуса есть
    // нижняя граница. Разброс размеров стал четырёхкратным, и чистое
    // деление на радиус сделало мелкие пузыри глухими: у пузыря
    // в 15 px курсор в двухстах пикселях — это тринадцать радиусов,
    // отклик 0.11, то есть та самая мёртвая зона по расстоянию,
    // от которой уходили. Граница в 26 px выравнивает поле: мелкий
    // отзывается слабее крупного, но отзывается.
    float dc   = lenC / max(radius, 26.0);
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
    vec4 clip = projectionMatrix * mv;
    gl_Position = clip;

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
    // Размер уходит во фрагментный: по нему считается ширина мягкой
    // кромки, чтобы она была одинаковой в ЭКРАННЫХ пикселях и у точки
    // в два пикселя, и у точки в шесть.
    vSize = gl_PointSize;
    // Середина точки в ПИКСЕЛЯХ буфера. По ней фрагментный шейдер
    // сам считает смещение от центра — см. там же, почему не
    // gl_PointCoord.
    //
    // Берём СВОЮ переменную clip, а не читаем обратно gl_Position:
    // в GLSL ES 1.00 это выходная переменная, и чтение её после записи
    // спецификацией не обещано. Работать может, а может и вернуть
    // что угодно — от драйвера.
    vSeredina = (clip.xy / clip.w * 0.5 + 0.5) * uHolst;
  }
`;

const FRAG = /* glsl */ `
  precision mediump float;
  varying vec3  vColor;
  varying float vAlpha;
  varying float vSize;
  varying vec2  vSeredina;

  uniform vec3  uBlik;   // цвет блика: свет, а не белила
  uniform float uSila;   // сколько блика подмешивать, число из токена

  // ОДИН ИСТОЧНИК СВЕТА НА ВСЮ СЦЕНУ.
  //
  // Направление в ЭКРАННЫХ координатах и одно и то же для каждой
  // точки — в этом весь смысл. Стоило бы взять направление от чего-то
  // своего у каждой точки (от её места на оболочке, от курсора,
  // от фазы), и блики смотрели бы вразнобой: получилась бы россыпь
  // самостоятельных бусин, а не поле, освещённое одной лампой.
  // Объём собирается именно из того, что блики согласованы.
  //
  // Свет сверху-слева и чуть на зрителя: так лежит свет почти на всех
  // фотографиях предметов, и глаз читает такую расстановку объёмом
  // без раздумий. Снизу он читался бы вывернутым наизнанку.
  const vec3 SVET = vec3(-0.46, 0.55, 0.70);

  void main() {
    // Смещение от середины точки считаем ЧЕРЕЗ gl_FragCoord, а не
    // через gl_PointCoord, и это главная поправка всей затеи.
    //
    // У gl_PointCoord ориентация оси Y на практике оказалась не той,
    // о которой говорит здравый смысл: с очевидным минусом у p.y блик
    // уезжал в НИЗ-СПРАВА, без минуса — в ВЕРХ-СПРАВА, то есть и по
    // горизонтали
    // он стоял зеркально к заданному направлению света. Спорить
    // об ориентации с реализацией бессмысленно, а подгонять знаки
    // «пока не совпадёт» опасно вдвойне: подобранное на программном
    // рендерере контейнера могло разъехаться на настоящей видеокарте
    // у человека, и блики смотрели бы не туда именно там, где
    // проверить некому.
    //
    // gl_FragCoord определён однозначно: начало в левом НИЖНЕМ углу
    // буфера, значит +Y это вверх экрана при любой реализации.
    // Середину точки вершинный шейдер отдаёт в тех же пикселях.
    vec2 p = (gl_FragCoord.xy - vSeredina) / max(vSize * 0.5, 0.5);
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;

    float r = sqrt(r2);

    // Мягкая кромка. Её ширина считается ОТ РАЗМЕРА ТОЧКИ, чтобы
    // в экранных пикселях она была одинаковой у крупных и у мелких:
    // фиксированная доля радиуса у точки в два пикселя даёт кромку
    // в полпикселя — то есть ступеньку, ради отсутствия которой
    // всё и считается на пиксель. Ниже 0.30 доля не опускается:
    // силуэт обязан оставаться мягким, иначе шарик превращается
    // в вырезанный кружок.
    float soft = max(2.0 / max(vSize, 2.0), 0.30);
    float a = (1.0 - smoothstep(1.0 - soft, 1.0, r)) * vAlpha;
    if (a <= 0.012) discard;

    // Нормаль полусферы: у шара, повёрнутого к зрителю, это
    // (x, y, sqrt(1 - x² - y²)). Обе оси уже в экранных направлениях,
    // переворачивать нечего.
    vec3 n = vec3(p.x, p.y, sqrt(max(1.0 - r2, 0.0001)));
    vec3 L = normalize(SVET);

    // Рассеянный свет ЗАВЁРНУТ (lambert * 0.5 + 0.5), а не обрезан
    // нулём. Обрезанный даёт чёрную половину и читается не объёмом,
    // а дыркой; завёрнутый оставляет теневую сторону цветной, просто
    // темнее — так выглядит предмет, вокруг которого есть воздух.
    float lit = dot(n, L) * 0.5 + 0.5;

    // Коэффициенты подобраны так, чтобы СРЕДНЯЯ яркость по кружку
    // осталась прежней: 0.55 + 0.90 * 0.5 = 1.0. Тёмная сторона
    // уходит в 0.55 от цвета, светлая выходит в 1.45 — точка не стала
    // ни бледнее, ни темнее в среднем, у неё появились стороны.
    vec3 col = vColor * (0.55 + 0.90 * lit);

    // Блик по Блинну — Фонгу: половинный вектор между светом
    // и зрителем (зритель по оси Z). Степень высокая, поэтому пятно
    // маленькое и плотное — такое и читается «металлом», а не
    // «подсвеченным шариком».
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float sp = pow(max(dot(n, H), 0.0), 34.0);

    // Отблеск на кромке с теневой стороны: у металла свет,
    // пришедший со стороны, обегает силуэт узкой каймой. Без неё шарик
    // читается матовым — резиновым, а не блестящим.
    float rim = pow(1.0 - abs(n.z), 3.0) * smoothstep(0.62, 0.05, lit) * 0.5;

    col = mix(col, uBlik, clamp((sp + rim) * uSila, 0.0, 1.0));

    gl_FragColor = vec4(col, a);
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
type Rect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Запас в радиусах. У строк подзаголовка он большой — краска
   *  не должна касаться букв вовсе. У блока условий маленький: блок
   *  непрозрачный, и пузырь, наполовину ушедший ЗА него, читается
   *  нормально; запрещать надо ровно то, чтобы он не торчал из щели
   *  между карточками. */
  keep: number;
};

export function mount(canvas: HTMLCanvasElement, host: HTMLElement): (() => void) | null {
  const gl = makeGL(canvas);
  if (!gl) return null; // WebGL нет — просто ничего не показываем

  const phone = window.matchMedia('(max-width: 640px)').matches;

  // Число пузырей — это ПЛОТНОСТЬ НА ЭКРАНЕ, помноженная на новую
  // площадь. Прежде холст занимал 900×504 на десктопе и 366×733
  // на телефоне; теперь он во всё окно, и площадь выросла ровно
  // втрое и в 1.23 раза. Отсюда 19 → 57 и 11 → 14: на глаз плотность
  // та же, что была, просто поля стало больше.
  //
  // Растить число вслед за ДЛИНОЙ страницы нельзя: состояние пузыря
  // уходит в шейдер массивами `uPos[N]` и `uRot[N]`, то есть 2N
  // векторов uniform, а WebGL гарантирует всего 128 на вершинный
  // шейдер. Длину страницы отрабатывает возвращение пузыря с другой
  // стороны полосы обитания, а не их количество.
  const HOTIM = phone ? 14 : 57;
  // Потолок берём у самой машины, а не на веру: на устройстве
  // с гарантированным минимумом 57 пузырей просто не собрались бы,
  // и шейдер не слинковался бы вовсе. Восемь векторов оставлены
  // под матрицы и скаляры.
  const VEKTOROV = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) as number;
  const COUNT = Math.max(6, Math.min(HOTIM, Math.floor((VEKTOROV - 8) / 2)));
  /** Границы радиусов. Разброс широкий НАМЕРЕННО: пузыри одного
   *  калибра читаются россыпью одинаковых бусин, а не живым полем. */
  const R_MIN = phone ? 10 : 15;
  const R_MAX = phone ? 26 : 54;

  const tanHalf = Math.tan((FOV / 2) * (Math.PI / 180));
  let proj = perspective(FOV, 1, 1, 4000);
  let view = viewAt(1);

  let w = 1;
  let h = 1;
  let dpr = 1;
  let camZ = 1;
  let rects: Rect[] = [];
  /** Полоса обитания в ПОСТРАНИЧНЫХ координатах: +y вверх, ноль
   *  у верха документа. Пересчитывается каждый кадр — она едет вместе
   *  с прокруткой. */
  let vis = { xmin: 0, xmax: 0, ymin: 0, ymax: 0 };
  /** Запас полосы за кромками окна. Возвращение пузыря обязано
   *  случаться там, где его не видно. */
  const ZAPAS = 130;
  /** Прокрутка и высота документа на текущем кадре: читаются один раз
   *  в начале такта, а не по ходу — иначе это принудительная
   *  раскладка по нескольку раз за кадр. */
  let scrollTop = 0;
  let docH = 1;
  /** Что считается рабочим текстом НА ФОНЕ СТРАНИЦЫ. Плашки, карточки
   *  и чек сюда не входят: они непрозрачны, пузырь за ними не виден
   *  вовсе и контрасту не мешает. */
  const TEKST = '.hero__lead, .hero__title, .shop__title, .shop__lead, '
    + '.steps__title, .step__title, .step__text, .footer__title';

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

  // Радиус берётся НЕ случайно из отрезка, а с лесенки: отрезок
  // [R_MIN, R_MAX] делится на COUNT логарифмических ступеней, и внутри
  // своей ступени радиус уже случаен. Иначе на каждой третьей загрузке
  // все двадцать два пузыря выпадали бы из середины отрезка и поле
  // снова читалось бы одинаковым. Лесенка логарифмическая, а не
  // равномерная: на глаз важно ОТНОШЕНИЕ размеров, и равномерный шаг
  // отдал бы половину ступеней крупным, где разница уже не видна.
  const stupen = Math.pow(R_MAX / R_MIN, 1 / COUNT);
  for (let i = 0; i < COUNT; i++) {
    const b: Bubble = {
      r: R_MIN * Math.pow(stupen, i + Math.random()),
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, dir: 0, speed: 0, pa: 1, pb: 1, swayA: 0, swayB: 0,
      rx: 0, ry: 0, wx: 0, wy: 0, popped: 0, pop: 0, gone: false,
    };
    spin(b);
    bubbles.push(b);
  }

  // ─── Геометрия: один объект на все пузыри, единичные сферы ───
  //
  // Точек — по ПЛОЩАДИ оболочки, а не по радиусу. Пока их было
  // пропорционально радиусу, плотность краски падала обратно
  // пропорционально ему: мелкий пузырь выходил плотным шариком,
  // крупный — редкой сеткой, и на широком разбросе размеров это
  // читалось как «большие недорисованы».
  //
  // Коэффициент 0.26 — это не «на глаз», а верхняя граница по кадрам.
  // Пузыри грузятся сразу после первой отрисовки, то есть попадают
  // ровно в окно, по которому считается время блокировки главного
  // потока. Замер под четырёхкратным замедлением процессора,
  // пять загрузок, медиана:
  //
  //   прежняя сборка ................................. 411 мс
  //   0.42, точки 1.9–4.0 ............................ 494 мс
  //   0.42, точки мельче (1.4–2.9) ................... 435 мс
  //   0.26, точки 1.9–4.0 ............................ 402 мс
  //
  // То есть платят ТОЧКИ, а не их размер. Крупные точки достаются
  // даром, число — нет.
  //
  // При этом плотность краски всё равно выше прежней на любом
  // радиусе: точки стали крупнее в полтора раза, и доля закрашенного
  // на оболочке выросла с 11.5 % до 17.9 % у мелкого пузыря
  // и с 6.9 % до 18 % у среднего.
  const counts = bubbles.map((b) => Math.max(48, Math.round(b.r * b.r * 0.26)));
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

      // Размер точки. Число точек при этом НЕ ТРОНУТО (см. counts
      // выше): растёт сама точка, а не их количество, — оболочка
      // становится плотнее, а не разреженнее.
      //
      // 2.2–4.5 против прежних 1.4–2.9, то есть ровно в полтора раза.
      // Верхняя граница не с потолка: точек на оболочке 0.26·r²,
      // в проекции это 0.083 точки на пиксель площади, то есть между
      // соседними точками около 3.5 px. Прежние 1.4–2.9 (а с учётом
      // глубины 0.7–3.9) оставляли между точками просвет шире самой
      // точки — отсюда «россыпь крупы» вместо оболочки. Полтора раза
      // подводят точку вплотную к шагу решётки и не дальше: при
      // двукратном увеличении соседи смыкаются и шар превращается
      // в сплошное пятно, где не видно ни спирали, ни перелива
      // глубины.
      //
      // Кадрами это не оплачивается. Замер под четырёхкратным
      // замедлением, записанный выше: «платят ТОЧКИ, а не их размер;
      // крупные точки достаются даром» — 0.26 при точках 1.9–4.0
      // дало 402 мс против 411 у прежней сборки с мелкими.
      size[k] = rnd(2.2, 4.5);
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
  const uHolst = U('uHolst');
  const uBlik = U('uBlik');
  const uSila = U('uSila');
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
    gl.uniform3fv(uBlik, readRgb(cs.getPropertyValue(TOKEN_BLIK)));
    gl.uniform1f(uSila, parseFloat(cs.getPropertyValue('--bubbles-blik')) || 0);
  };

  /** Число целых пузырей — единственная наружная примета состояния:
   *  проверке иначе не за что зацепиться, а пиксели считать ненадёжно. */
  const publish = () => {
    const n = String(bubbles.filter((b) => !b.gone && !b.popped).length);
    if (canvas.dataset.bubbles !== n) canvas.dataset.bubbles = n;
  };

  // ─── Запретные прямоугольники ───────────────────────────────
  //
  // Пузыри лежат ПОД содержимым, и краска на буквы не попадает. Но
  // у текста, стоящего прямо на фоне страницы, фоном становится сам
  // пузырь, а вместе с ним и контраст: замер по настоящим пикселям
  // в тёмной теме давал на самой плотной краске 1.54:1 у приглушённого
  // текста при пороге 4.5. Плотностью краски это не лечится — в
  // сумерках она СВЕТЛЕЕ фона и идёт навстречу светлому тексту.
  // Поэтому пузыри обходят рабочий текст по всей странице.
  //
  // Дорого (чтение геометрии десятка узлов), поэтому только на
  // изменение размеров и высоты документа, а не каждый кадр:
  // относительно СТРАНИЦЫ текст не двигается.
  const zameritTekst = () => {
    const sy = window.scrollY;
    const pad = 6;
    rects = [...document.querySelectorAll(TEKST)].map((el) => {
      const q = el.getBoundingClientRect();
      if (q.width < 4 || q.height < 4) return null;
      return {
        top: -(q.top + sy) + pad,
        bottom: -(q.bottom + sy) - pad,
        left: q.left - w / 2 - pad,
        right: q.right - w / 2 + pad,
        keep: 1.15,
      };
    }).filter(Boolean) as Rect[];
  };

  /** Накрывает ли пузырь какой-нибудь запретный прямоугольник. */
  const inBand = (x: number, y: number, r: number) => {
    for (const q of rects) {
      const keep = r * q.keep;
      if (x > q.left - keep && x < q.right + keep && y - keep < q.top && y + keep > q.bottom) return true;
    }
    return false;
  };

  /** Полоса обитания в постраничных координатах. Едет с прокруткой:
   *  сколько бы ни было страницы, рисуется ровно одно окно. */
  const polosa = () => {
    vis = {
      xmin: -w / 2,
      xmax: w / 2,
      ymin: -(scrollTop + h + ZAPAS),
      ymax: -(scrollTop - ZAPAS),
    };
  };

  /** Ставит пузырь в свободное место: не над строками подзаголовка,
   *  не вплотную к соседям и не туда, где только что лопнул
   *  предыдущий. */
  const place = (b: Bubble, avoid?: { x: number; y: number }) => {
    // Место ищется по ВСЕЙ полосе: так расставляются пузыри при
    // запуске и так возвращаются лопнувшие. Стороны у постановки
    // больше нет — уход за кромку полосы решается переносом
    // на её высоту прямо в такте, см. ниже.
    const lo = vis.ymin + b.r * EDGE;
    const hi = vis.ymax - b.r * EDGE;
    // Попыток стало больше: свободного поля убавилось (добавился
    // запрет на блок условий), а пузырей прибавилось, и прежние
    // двадцать четыре нет-нет да и исчерпывались — тогда срабатывал
    // запасной путь, который запреты не смотрит вовсе.
    for (let i = 0; i < 60; i++) {
      const x = rnd(vis.xmin + b.r * EDGE, vis.xmax - b.r * EDGE);
      const y = rnd(lo, hi);
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
    // Запасной путь: место не нашлось за шестьдесят попыток. Ставим
    // к верхней кромке поля — там запретов нет по построению —
    // и с тем же запасом от края, что и везде, иначе пузырь окажется
    // ближе к кромке, чем ему позволено, и будет от неё отскакивать.
    b.x = rnd(vis.xmin + b.r * EDGE, vis.xmax - b.r * EDGE);
    b.y = rnd(lo, hi);
    b.z = 0;
  };

  const resize = () => {
    // Холст закреплён по ОКНУ (position: fixed, inset: 0), а пузыри
    // живут на СТРАНИЦЕ. Разница принципиальная и она про кадры: слой
    // композитится каждый кадр целиком, и холст во всю высоту
    // документа был бы втрое больше окна. Постраничные координаты
    // дают ту же картину при постоянной цене.
    //
    // Размеры ставит скрипт, а не CSS: canvas — заменяемый элемент
    // и при width: auto берёт своё собственное 300×150.
    w = Math.max(1, Math.round(document.documentElement.clientWidth));
    h = Math.max(1, Math.round(window.innerHeight));
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
    // Размер буфера нужен фрагментному шейдеру: по нему он переводит
    // середину точки в пиксели и считает от неё нормаль шарика.
    gl.uniform2f(uHolst, canvas.width, canvas.height);
    gl.uniformMatrix4fv(uProj, false, proj);
    gl.uniformMatrix4fv(uView, false, view);
    gl.uniform1f(uSizeScale, dpr * camZ);
    gl.uniform1f(uCamZ, camZ);
    scrollTop = window.scrollY;
    docH = document.documentElement.scrollHeight;
    zameritTekst();
    polosa();
    for (const b of bubbles) {
      b.x = Math.max(vis.xmin + b.r * EDGE, Math.min(vis.xmax - b.r * EDGE, b.x));
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

  /** Экранная точка в ПОСТРАНИЧНЫЕ координаты пузырей. */
  const toWorld = (e: PointerEvent) => ({
    x: e.clientX - w / 2,
    y: -(e.clientY + scrollTop),
  });

  /** Курсор в окне. Поле теперь во всё окно, так что проверять
   *  нечего, кроме самого окна. */
  const inField = (e: PointerEvent) =>
    e.clientX >= 0 && e.clientX <= w && e.clientY >= 0 && e.clientY <= h;

  const INTERACTIVE = 'a, button, input, label, summary, [role="button"], [data-lenis-scrollable]';

  /** Свободна ли точка от содержимого.
   *
   *  Пузыри лежат под всем содержимым, и приоритет над ними всегда
   *  у интерфейса: над кнопкой, ссылкой, карточкой или чеком нажатие
   *  достаётся им, а не пузырю. Список селекторов для этого не годится
   *  — он устареет на первой же новой карточке. Признак берётся
   *  общий: над точкой не должно быть НИ ОДНОГО непрозрачного слоя.
   *
   *  Корень и body пропускаем: их заливка — это и есть фон страницы,
   *  он лежит ПОД холстом. */
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

  /** Состояние указателя и когда его проверяли: дорогая половина
   *  (elementsFromPoint и разбор стилей) считается не чаще раза
   *  в 120 мс — стопка элементов под курсором за кадр не меняется. */
  let ukazatel = false;
  let proverenoV = 0;

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
    // Указатель ставится только там, где пузырь ВИДЕН и по нему можно
    // щёлкнуть: над непрозрачным содержимым нажатие всё равно
    // достанется ему, и обещать пальцем несуществующее нельзя.
    const pop = hitTest(x, y);
    if (!pop) { if (ukazatel) { ukazatel = false; host.style.cursor = ''; } return; }
    const teper = performance.now();
    if (teper - proverenoV < 120 && ukazatel) return;
    proverenoV = teper;
    const nado = svobodno(e.clientX, e.clientY);
    if (nado !== ukazatel) { ukazatel = nado; host.style.cursor = nado ? 'pointer' : ''; }
  };

  const onLeave = () => {
    // Позицию НЕ уводим в бесконечность сразу: оболочка должна
    // разгладиться плавно, а не отпустить скачком. Курсор паркуется
    // сам, когда нажим доедет до нуля.
    pressTo = 0;
    ukazatel = false;
    host.style.cursor = '';
  };

  const onDown = (e: PointerEvent) => {
    if (!inField(e)) return;
    const el = e.target as HTMLElement | null;
    if (el?.closest(INTERACTIVE)) return;
    // Над непрозрачным содержимым нажатие достаётся ему: пузыря
    // за карточкой или чеком всё равно не видно.
    if (!svobodno(e.clientX, e.clientY)) return;
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
  // Прежде здесь стоял IntersectionObserver: холст жил в первом
  // экране, и когда тот уезжал, рисовать было нечего. Теперь холст
  // закреплён по окну и виден на любой высоте прокрутки.

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

    // Прокрутка и высота документа читаются РАЗ за кадр: это
    // принудительная раскладка, и делать её по ходу такта нельзя.
    scrollTop = window.scrollY;
    const nowH = document.documentElement.scrollHeight;
    if (Math.abs(nowH - docH) > 4) { docH = nowH; zameritTekst(); }
    polosa();

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
    gl.uniform3f(uPointerU, pointer.x, pointer.y + scrollTop + h / 2, pointer.z);
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
          const want = (b.r + o.r) * 1.65;
          if (od > want || od < 0.001) continue;
          const push = (1 - od / want) * 58 * dt;
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
        // По вертикали пузырь не отскакивает, а ПЕРЕНОСИТСЯ на высоту
        // полосы — за кромкой окна, где этого не видно. Иначе полоса,
        // едущая с прокруткой, тащила бы пузыри за собой, и они
        // казались бы приклеенными к экрану вместо того, чтобы стоять
        // на странице.
        //
        // Перенос именно НА ВЫСОТУ ПОЛОСЫ, а не «поставить заново
        // в запас с другой стороны», и разница видна только при
        // быстрой прокрутке. Полоса едет вместе с окном; прыжок
        // к витрине сдвигает её сразу на две высоты, и ВСЕ пузыри
        // разом оказываются снаружи. Постановка заново сваливала их
        // в запас — то есть за кромку окна, — и человек, вернувшийся
        // наверх, видел пустую страницу, пока они минуту сползали
        // обратно в кадр. Перенос сохраняет расстановку: сколько
        // бы полоса ни прыгнула, поле выглядит так же, как до прыжка.
        //
        // Кромка сходится точно: y = ymax + r за вычетом высоты
        // полосы даёт ровно ymin + r. Цикл нужен на случай прыжка
        // длиннее одной полосы.
        const polosaH = vis.ymax - vis.ymin;
        if (b.y > vis.ymax + b.r) {
          spin(b);
          do { b.y -= polosaH; } while (b.y > vis.ymax + b.r);
        } else if (b.y < vis.ymin - b.r) {
          spin(b);
          do { b.y += polosaH; } while (b.y < vis.ymin - b.r);
        }

        // Запретные прямоугольники: строки подзаголовка и блок условий.
        //
        // Проход ПОВТОРЯЕТСЯ, и это не перестраховка. Прямоугольников
        // теперь два, они стоят один под другим, и выталкивание
        // из нижнего заносит пузырь в верхний. Верхний в этом кадре
        // уже разобран, поправка приходит только на следующем — и на
        // один кадр краска оказывается на строках подзаголовка.
        // Замер это и поймал: 9 окрашенных пикселей из 42408.
        for (let pass = 0; pass < 3; pass++)
        for (const q of rects) {
          const keep = b.r * q.keep;
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

      // Постраничная координата → экранная: сцена ничего не знает
      // о прокрутке, ей отдаётся уже готовое положение в кадре.
      const o4 = i * 4;
      posArr[o4] = b.x;
      posArr[o4 + 1] = b.y + scrollTop + h / 2;
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
  ro.observe(document.documentElement);

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
    mo.disconnect();
    host.style.cursor = '';
    for (const b of buffers) if (b) gl.deleteBuffer(b);
    gl.deleteProgram(program);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  };
}
