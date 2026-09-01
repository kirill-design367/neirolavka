/**
 * Напоминание о просроченном заказе.
 *
 * Обещание «доступ придёт в течение часа» держится не само по себе.
 * Раз в минуту бот смотрит, у каких оплаченных заказов обещанный срок
 * прошёл, и пишет команде. Повторяет с паузой и умолкает после
 * нескольких раз: напоминание, приходящее каждую минуту, перестают
 * читать через полчаса.
 *
 * Счётчик напоминаний лежит в базе, а не в памяти: перезапуск бота
 * не должен ни сбрасывать его, ни поднимать волну повторов.
 */

import type { Lavka } from '../lavka.js';
import * as zakazy from '../db/zakazy.js';
import * as lyudi from '../db/lyudi.js';
import * as klav from '../bot/klaviatury.js';
import * as uvedom from '../bot/uvedomleniya.js';
import { raspisanie } from '../db/nastroyki.js';
import { momentSlovami, skolkoOsalos } from '../lib/vremya.js';
import { zhurnal } from '../lib/zhurnal.js';

export const SHAG_MS = 60_000;

export async function proverit(l: Lavka, seychas = new Date()): Promise<number> {
  const spisok = zakazy.prosrochennye(l.db, seychas, l.n.napominatCherez, l.n.napominatRaz);
  const r = raspisanie(l.db, l.n);
  for (const z of spisok) {
    const c = lyudi.chelovek(l.db, z.tg_id);
    const srok = z.srok_do ? new Date(z.srok_do) : seychas;
    await uvedom.komande(
      l,
      [
        'Заказ просрочен.',
        '',
        `№ ${z.id} · ${z.nazvanie}`,
        `Покупатель: ${lyudi.podpis(c, z.tg_id)}`,
        `Обещали к ${momentSlovami(srok, r.poyas)} — ${skolkoOsalos(seychas, srok)}`,
      ].join('\n'),
      klav.zakazAdminu(z, false),
    );
    zakazy.otmetitNapominanie(l.db, z.id, seychas);
  }
  return spisok.length;
}

export function zapustit(l: Lavka): NodeJS.Timeout {
  const chasy = setInterval(() => {
    proverit(l).catch((e) => zhurnal.oshibka('напоминания:', e));
  }, SHAG_MS);
  // Таймер не должен держать процесс живым сам по себе: остановка
  // бота не должна ждать следующего тика.
  chasy.unref();
  return chasy;
}
