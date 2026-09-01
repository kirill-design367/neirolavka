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

function stroka(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x instanceof Error) return `${x.name}: ${x.message}\n${x.stack ?? ''}`;
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
