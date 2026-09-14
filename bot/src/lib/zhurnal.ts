/**
 * Журнал.
 *
 * Два правила, ради которых он вообще написан отдельным модулем.
 *
 * 1. Секреты не печатаются НИКОГДА и ни при какой ошибке. Токен бота
 *    и ключ шифрования регистрируются при старте, и любое их вхождение
 *    в строку — хоть в сообщении, хоть в трассировке чужой библиотеки —
 *    заменяется на «‹скрыто›». Полагаться на «мы просто не будем их
 *    логировать» нельзя: их печатает не наш код, а, например, grammY,
 *    когда Telegram отвечает ошибкой на запрос с токеном в адресе.
 *
 * 2. Пароли доступов сюда не попадают в принципе — ни открытые,
 *    ни зашифрованные. Модуль выдачи оперирует ими в памяти
 *    и передаёт дальше, не касаясь журнала. Скрытие вхождений —
 *    вторая линия, а не первая.
 */

const sekrety: string[] = [];

/** Зарегистрировать значение как секрет. Короткие строки игнорируются. */
export function skryt(...znacheniya: (string | undefined | null)[]): void {
  for (const z of znacheniya) {
    if (typeof z === 'string' && z.length >= 8 && !sekrety.includes(z)) sekrety.push(z);
  }
}

/** Вырезать все известные секреты из строки. */
export function bezSekretov(s: string): string {
  let out = s;
  for (const sek of sekrety) {
    while (out.includes(sek)) out = out.replace(sek, '‹скрыто›');
  }
  return out;
}

/**
 * Ошибка словами: ПРИЧИНА, а не один стектрейс.
 *
 * Здесь стояло `${x.name}: ${x.message}\n${x.stack}`, и на боевом это
 * молчало ровно там, где нужно было говорить. Две беды сразу.
 *
 * ПЕРВАЯ: У ОШИБКИ МОЖЕТ НЕ БЫТЬ ТЕКСТА. `AggregateError`, который
 * Node бросает из «счастливых глазок» (`autoSelectFamily`), приходит
 * с ПУСТЫМ `message`: настоящие причины лежат у него в `errors`,
 * по одной на каждый адрес, куда он не достучался. В журнал уезжало
 * `AggregateError: ` и стектрейс — то есть «что-то упало в сети»
 * без единого слова о том, что именно. На сервере, где IPv4
 * до Telegram заблокирован, а IPv6 отваливается на секунды, это
 * ровно та ошибка, которая идёт постоянно.
 *
 * ВТОРАЯ: ПРИЧИНА БЫВАЕТ ЗАВЁРНУТА. `HttpError` у grammY держит
 * настоящую ошибку в `error`, Node — в `cause`. Внешний слой при
 * этом говорит «Network request failed», а что случилось — этажом
 * ниже.
 *
 * Поэтому разворачиваем: заголовок, служебные поля (`code`,
 * `syscall`, адрес), ответ Telegram, и рекурсивно — `cause`, `error`
 * и весь список `errors`. Стектрейс печатается ОДИН, у самой внешней
 * ошибки, и без первой строки: она дословно повторяет заголовок.
 *
 * ЧЕГО ЗДЕСЬ НЕТ: `payload`. У `GrammyError` в нём лежит тело
 * запроса — то есть текст сообщения, а в выдаче доступа это логин
 * и пароль покупателя. Правило «не писать пароли в журнал ни при
 * какой ошибке» стоит выше удобства разбора.
 */
function polya(e: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ['code', 'errno', 'syscall', 'address', 'port', 'hostname']) {
    const v = e[k];
    if (v !== undefined && v !== null && v !== '') out.push(`${k}=${String(v)}`);
  }
  // Ответ Telegram: номер и описание. Тело запроса — намеренно нет.
  if (typeof e['error_code'] === 'number') out.push(`telegram=${String(e['error_code'])}`);
  if (typeof e['description'] === 'string') out.push(`«${e['description']}»`);
  if (typeof e['method'] === 'string') out.push(`метод=${String(e['method'])}`);
  return out;
}

function opisatOshibku(x: Error, glubina = 0): string {
  /* Потолок глубины: `cause` может ссылаться по кругу, и журнал,
     ушедший в бесконечность, — это не «подробно», а остановленный
     процесс. */
  if (glubina > 4) return '…';
  const e = x as unknown as Record<string, unknown>;
  const text = typeof x.message === 'string' ? x.message.trim() : '';
  const hvost = polya(e);
  let out = `${x.name}: ${text || '(без текста)'}`;
  if (hvost.length) out += ` [${hvost.join(', ')}]`;

  const otstup = '  '.repeat(glubina + 1);
  const vlozhit = (podpis: string, v: unknown) => {
    if (v instanceof Error) out += `\n${otstup}${podpis} ${opisatOshibku(v, glubina + 1)}`;
    else if (v !== undefined && v !== null) out += `\n${otstup}${podpis} ${String(v)}`;
  };

  vlozhit('← причина:', e['cause']);
  // `error` — так заворачивает настоящую ошибку HttpError у grammY.
  if (e['error'] !== e['cause']) vlozhit('← внутри:', e['error']);
  const spisok = e['errors'];
  if (Array.isArray(spisok)) {
    spisok.forEach((v, i) => vlozhit(`← ${i + 1} из ${spisok.length}:`, v));
  }

  if (glubina === 0 && typeof x.stack === 'string') {
    // Первая строка стектрейса дословно повторяет заголовок выше.
    const bezPervoy = x.stack.split('\n').slice(1).join('\n');
    if (bezPervoy.trim()) out += `\n${bezPervoy}`;
  }
  return out;
}

function stroka(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x instanceof Error) return opisatOshibku(x);
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function pechat(uroven: string, chasti: unknown[]): void {
  const vremya = new Date().toISOString();
  const telo = chasti.map(stroka).join(' ');
  const linia = bezSekretov(`${vremya} ${uroven} ${telo}`);
  if (uroven === 'ОШИБКА') process.stderr.write(linia + '\n');
  else process.stdout.write(linia + '\n');
}

export const zhurnal = {
  info: (...ch: unknown[]) => pechat('инфо', ch),
  vnimanie: (...ch: unknown[]) => pechat('внимание', ch),
  oshibka: (...ch: unknown[]) => pechat('ОШИБКА', ch),
};
