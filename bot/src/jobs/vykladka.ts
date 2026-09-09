/**
 * Присмотр за выкладкой цен.
 *
 * Страницу панели могут закрыть сразу после нажатия — состояние
 * обязано доехать до конца само. Иначе владелец, вернувшись через
 * час, увидит «выкладка идёт» и не поймёт, вышло или нет.
 *
 * Работа дешёвая и редкая: пока ничего не выкладывается, тик не
 * делает ни одного запроса наружу.
 */

import type { Lavka } from '../lavka.js';
import * as vykladki from '../db/vykladki.js';
import { proverit } from '../admin/vykladka.js';
import { zhurnal } from '../lib/zhurnal.js';

/** Раз в полминуты: сборка сайта идёт минуты, чаще спрашивать незачем. */
export const SHAG_MS = 30_000;

export function zapustit(l: Lavka): NodeJS.Timeout {
  const chasy = setInterval(() => {
    if (!vykladki.idushchaya(l.db)) return;
    proverit(l).catch((e) => zhurnal.oshibka('присмотр за выкладкой:', e));
  }, SHAG_MS);
  chasy.unref();
  return chasy;
}
