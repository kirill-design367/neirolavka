/**
 * Мельчайший слой над WebGL: контекст, программа, буферы, матрица
 * перспективы. Ровно то, что нужно облаку точек, и ничего больше.
 *
 * Зачем он вместо Three.js. Пузырям от библиотеки требовалось восемь
 * имён: контекст, сцена, камера, точки, геометрия, материал, вектор
 * и рендерер. Всё это тянуло за собой 516 КБ разбора — и именно из-за
 * них загрузка была отложена до первого действия человека, а первый
 * экран первые секунды стоял пустой. Здесь то же самое умещается
 * в несколько килобайт, поэтому пузыри можно грузить сразу.
 *
 * Отрисовка не изменилась ни на пиксель: шейдеры те же, единственный
 * вызов отрисовки тот же. Это НЕ возврат к канве со спрайтами —
 * точка по-прежнему рисуется шейдером, край считается на пиксель.
 */

export type GL = WebGLRenderingContext;

/** Контекст или null, если WebGL недоступен. */
export function makeGL(canvas: HTMLCanvasElement): GL | null {
  const opts: WebGLContextAttributes = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: 'low-power',
  };
  try {
    // Шейдеры написаны на GLSL ES 1.00; контекст второй версии
    // принимает их наравне с первой, поэтому берём тот, что дадут.
    const gl = (canvas.getContext('webgl2', opts) ??
      canvas.getContext('webgl', opts)) as GL | null;
    return gl ?? null;
  } catch {
    return null;
  }
}

const shader = (gl: GL, type: number, src: string) => {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
};

/** Собранная программа или null, если что-то не скомпилировалось. */
export function makeProgram(gl: GL, vertSrc: string, fragSrc: string): WebGLProgram | null {
  const vs = shader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = shader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

/** Неизменный атрибут: буфер заливается один раз и остаётся. */
export function staticAttrib(
  gl: GL,
  program: WebGLProgram,
  name: string,
  data: Float32Array,
  size: number,
): WebGLBuffer | null {
  const loc = gl.getAttribLocation(program, name);
  if (loc < 0) return null;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  return buf;
}

/**
 * Матрица перспективы, столбцами — как её ждёт WebGL.
 * Угол задаётся по ВЕРТИКАЛИ, как у камеры Three.js, чтобы единица
 * мира на плоскости z = 0 осталась ровно одним пикселем.
 */
export function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

/** Взгляд из точки (0, 0, z) вдоль оси −Z: просто сдвиг. */
export function viewAt(z: number): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, -z, 1,
  ]);
}
