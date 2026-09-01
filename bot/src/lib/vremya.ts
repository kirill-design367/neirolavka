/**
 * Часы работы и обещание срока выдачи.
 *
 * Выдача ручная: между оплатой и доступом стоит человек. Значит
 * обещать надо ВЕРХНЮЮ границу, а не идеальный случай, и обещание
 * обязано меняться вместе с часами работы, а не быть вбитым в текст.
 *
 * Все расчёты идут в объявленном часовом поясе (по умолчанию
 * Europe/Moscow), а не в поясе сервера: сервер могут переставить,
 * лавка от этого работать по-другому не начнёт.
 */

export type ChastiVremeni = {
  god: number;
  mesyac: number;
  den: number;
  chas: number;
  minuta: number;
  sekunda: number;
};

/** Разобрать момент на части в нужном поясе. */
export function chasti(d: Date, poyas: string): ChastiVremeni {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: poyas,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const ch of f.formatToParts(d)) p[ch.type] = ch.value;
  const chas = Number(p['hour']);
  return {
    god: Number(p['year']),
    mesyac: Number(p['month']),
    den: Number(p['day']),
    // В некоторых средах полночь приходит как «24».
    chas: chas === 24 ? 0 : chas,
    minuta: Number(p['minute']),
    sekunda: Number(p['second']),
  };
}

/** Сдвиг пояса относительно UTC в этот момент, в миллисекундах. */
function sdvig(d: Date, poyas: string): number {
  const c = chasti(d, poyas);
  const kakBudtoUTC = Date.UTC(c.god, c.mesyac - 1, c.den, c.chas, c.minuta, c.sekunda);
  return kakBudtoUTC - Math.floor(d.getTime() / 1000) * 1000;
}

/**
 * Момент по стенным часам пояса.
 *
 * Двумя приближениями: первое даёт сдвиг рядом с искомым моментом,
 * второе его уточняет. Нужно ради поясов с переводом часов — в Москве
 * его нет, но закладываться на это в общей функции не стоит.
 */
export function moment(
  c: { god: number; mesyac: number; den: number; chas: number; minuta?: number },
  poyas: string,
): Date {
  const bezSdviga = Date.UTC(c.god, c.mesyac - 1, c.den, c.chas, c.minuta ?? 0, 0);
  let t = bezSdviga;
  for (let i = 0; i < 2; i += 1) {
    t = bezSdviga - sdvig(new Date(t), poyas);
  }
  return new Date(t);
}

export type Raspisanie = {
  poyas: string;
  rabotaS: number;
  rabotaDo: number;
  obeshchanieMinut: number;
};

/** Работает ли лавка прямо сейчас. */
export function rabocheeVremya(seychas: Date, r: Raspisanie): boolean {
  const c = chasti(seychas, r.poyas);
  return c.chas >= r.rabotaS && c.chas < r.rabotaDo;
}

/** Ближайшее открытие: сегодня, если ещё не открылись, иначе завтра. */
export function blizhayshieeOtkrytie(seychas: Date, r: Raspisanie): Date {
  const c = chasti(seychas, r.poyas);
  if (c.chas < r.rabotaS) {
    return moment({ god: c.god, mesyac: c.mesyac, den: c.den, chas: r.rabotaS }, r.poyas);
  }
  // Следующий день. Date.UTC сам переносит через край месяца и года.
  const zavtra = new Date(Date.UTC(c.god, c.mesyac - 1, c.den + 1));
  return moment(
    {
      god: zavtra.getUTCFullYear(),
      mesyac: zavtra.getUTCMonth() + 1,
      den: zavtra.getUTCDate(),
      chas: r.rabotaS,
    },
    r.poyas,
  );
}

export type Srok = {
  /** Верхняя граница: позже этого момента заказ считается просроченным. */
  do: Date;
  /** true, если выдача уедет на утро. */
  utrom: boolean;
};

/**
 * Когда обещаем выдать доступ.
 *
 * В рабочие часы — в пределах обещанного срока. Но если срок
 * не помещается до закрытия (заказ в 22:50 при закрытии в 23:00),
 * обещание уезжает на утро: обещать час, когда лавка закрывается
 * через десять минут, — это обещание, которое не сдержать.
 */
export function srokVydachi(seychas: Date, r: Raspisanie): Srok {
  const obeshchanie = r.obeshchanieMinut * 60_000;
  if (rabocheeVremya(seychas, r)) {
    const c = chasti(seychas, r.poyas);
    const zakrytie =
      r.rabotaDo === 24
        ? moment({ god: c.god, mesyac: c.mesyac, den: c.den + 1, chas: 0 }, r.poyas)
        : moment({ god: c.god, mesyac: c.mesyac, den: c.den, chas: r.rabotaDo }, r.poyas);
    const predel = new Date(seychas.getTime() + obeshchanie);
    if (predel.getTime() <= zakrytie.getTime()) return { do: predel, utrom: false };
  }
  const otkrytie = blizhayshieeOtkrytie(seychas, r);
  return { do: new Date(otkrytie.getTime() + obeshchanie), utrom: true };
}

/** «08:00» из числа часов. Часы приходят из настроек, не из текста. */
export function chasSlovami(chas: number): string {
  return `${String(chas % 24).padStart(2, '0')}:00`;
}

/** «1 сентября 2026» в нужном поясе. */
export function dataSlovami(d: Date, poyas: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: poyas,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/** «1 сентября, 14:35». */
export function momentSlovami(d: Date, poyas: string): string {
  const den = new Intl.DateTimeFormat('ru-RU', { timeZone: poyas, day: 'numeric', month: 'long' }).format(d);
  const chas = new Intl.DateTimeFormat('ru-RU', {
    timeZone: poyas,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${den}, ${chas}`;
}

/** Дата, до которой открыт доступ, если выдать сегодня. */
export function dostupDo(seychas: Date, mesyacev: number): Date {
  const d = new Date(seychas);
  d.setUTCMonth(d.getUTCMonth() + mesyacev);
  return d;
}

/** «через 40 минут», «через 2 часа», «уже 15 минут назад». */
export function skolkoOsalos(seychas: Date, srok: Date): string {
  const minut = Math.round((srok.getTime() - seychas.getTime()) / 60_000);
  if (minut < 0) return `просрочен на ${sklonenie(-minut, 'минуту', 'минуты', 'минут')}`;
  if (minut < 90) return `${sklonenie(minut, 'минута', 'минуты', 'минут')}`;
  return `${sklonenie(Math.round(minut / 60), 'час', 'часа', 'часов')}`;
}

/** Русское склонение по числу: 1 минута, 2 минуты, 5 минут. */
export function sklonenie(n: number, odna: string, dve: string, pyat: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return `${n} ${pyat}`;
  if (b > 1 && b < 5) return `${n} ${dve}`;
  if (b === 1) return `${n} ${odna}`;
  return `${n} ${pyat}`;
}
