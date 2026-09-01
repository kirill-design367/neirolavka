/**
 * Присмотр за путём до Telegram.
 *
 * Выбор семейства адресов делается при запуске, но сеть живёт своей
 * жизнью: IPv6 может отвалиться, IPv4 — разблокироваться. Бот,
 * выбравший путь однажды и навсегда, замолчит и не скажет почему.
 *
 * Поэтому раз в десять минут проверяется ТОЛЬКО выбранный путь —
 * один лёгкий запрос. Пока он отвечает, ничего не происходит и в
 * журнал не пишется. Перестал отвечать — идёт полный выбор заново,
 * и смена пути объявляется вслух.
 */

import type { Lavka } from '../lavka.js';
import { probaSemeystva, vybratPut, rasskazat } from '../lib/svyaz.js';
import type { Semeystvo } from '../lib/svyaz.js';
import { zhurnal } from '../lib/zhurnal.js';

export const SHAG_MS = 10 * 60_000;
const UZEL = 'api.telegram.org';

/** Возвращает действующий путь после проверки. */
export async function prismotret(tekushchiy: Semeystvo, uzel = UZEL): Promise<Semeystvo> {
  const p = await probaSemeystva(uzel, tekushchiy);
  if (p.ok) return tekushchiy;
  zhurnal.vnimanie(`${uzel} перестал отвечать по IPv${tekushchiy}: ${p.oshibka}. Выбираю путь заново.`);
  const v = await vybratPut(uzel);
  rasskazat(uzel, v);
  return v.vybrano ?? tekushchiy;
}

export function zapustit(l: Lavka, nachalnyy: Semeystvo): NodeJS.Timeout {
  let put = nachalnyy;
  const chasy = setInterval(() => {
    prismotret(put)
      .then((novyy) => {
        put = novyy;
      })
      .catch((e) => zhurnal.oshibka('присмотр за связью:', e));
  }, SHAG_MS);
  // Таймер не должен держать процесс живым сам по себе.
  chasy.unref();
  void l;
  return chasy;
}
