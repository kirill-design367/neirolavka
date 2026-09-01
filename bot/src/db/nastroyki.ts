/**
 * Настройки, которые владелец меняет из бота.
 *
 * Окружение задаёт значения по умолчанию, база их перекрывает.
 * Так часы работы можно поправить на ходу, не заходя по SSH,
 * и при этом свежая установка поднимается без базы настроек.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import type { Nastroyki } from '../config.js';
import type { Raspisanie } from '../lib/vremya.js';

export function postavit(db: Baza, klyuch: string, znachenie: string, kto: number): void {
  db.prepare(
    `INSERT INTO nastroyki (klyuch, znachenie, izmenen, kto) VALUES (?, ?, ?, ?)
     ON CONFLICT(klyuch) DO UPDATE SET znachenie = excluded.znachenie,
                                       izmenen = excluded.izmenen,
                                       kto = excluded.kto`,
  ).run(klyuch, znachenie, seychasISO(), kto);
}

export function vzyat(db: Baza, klyuch: string): string | null {
  const r = db.prepare('SELECT znachenie FROM nastroyki WHERE klyuch = ?').get(klyuch) as
    | { znachenie: string }
    | undefined;
  return r?.znachenie ?? null;
}

function chislo(db: Baza, klyuch: string, poumolchaniyu: number): number {
  const v = vzyat(db, klyuch);
  if (v === null) return poumolchaniyu;
  const n = Number(v);
  return Number.isFinite(n) ? n : poumolchaniyu;
}

/**
 * Действующее расписание: окружение плюс правки владельца.
 *
 * Читается на каждое обращение, а не запоминается при старте:
 * иначе смена часов из бота начала бы действовать только после
 * перезапуска, и владелец решил бы, что кнопка не работает.
 */
export function raspisanie(db: Baza, n: Nastroyki): Raspisanie {
  return {
    poyas: n.poyas,
    rabotaS: chislo(db, 'rabota_s', n.rabotaS),
    rabotaDo: chislo(db, 'rabota_do', n.rabotaDo),
    obeshchanieMinut: chislo(db, 'obeshchanie_minut', n.obeshchanieMinut),
  };
}
