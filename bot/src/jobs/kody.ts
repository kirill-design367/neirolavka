/**
 * Час на код — и отмена с возвратом денег.
 *
 * Помощник дошёл до входа в аккаунт и попросил код с почты. Если код
 * не пришёл за обещанное время, заказ отменяется, а деньги уходят
 * на баланс покупателя.
 *
 * Порог — это НЕ отдельное число: он равен обещанному сроку выдачи
 * (`obeshchanieMinut`), потому что это одна и та же величина —
 * гарантированное время выполнения заказа. Второе число здесь
 * означало бы, что лавка обещает одно, а ждёт другое, и однажды они
 * разъехались бы.
 *
 * Счёт времени идёт от `kod_zapros_v` в базе, а не от таймера
 * в памяти: бот перезапускается при каждом обновлении, и таймер
 * пережил бы ровно до первой выкладки.
 */

import type { Lavka } from '../lavka.js';
import * as zakazy from '../db/zakazy.js';
import * as koshelek from '../db/koshelek.js';
import * as lyudi from '../db/lyudi.js';
import * as dialogi from '../db/dialogi.js';
import * as uvedom from '../bot/uvedomleniya.js';
import * as t from '../lib/texty.js';
import { raspisanie } from '../db/nastroyki.js';
import { zhurnal } from '../lib/zhurnal.js';

export const SHAG_MS = 60_000;

export async function proverit(l: Lavka, seychas = new Date()): Promise<number> {
  const minut = raspisanie(l.db, l.n).obeshchanieMinut;
  const spisok = zakazy.prosrochennyeKody(l.db, seychas, minut);
  for (const z of spisok) {
    const itog = zakazy.otmenit(l.db, z.id, null, 'net_koda');
    if (!itog.otmenen) continue;

    // Разговор о коде больше не идёт: иначе следующее сообщение
    // человека уйдёт кодом в отменённый заказ.
    //
    // Ничейный заказ сюда не доходит — часа на код у него не бывает,
    // пока его не забрали, — но и разговора, и адресата у него нет.
    const svezhy = zakazy.po(l.db, z.id) ?? z;
    if (z.tg_id !== null) {
      dialogi.zabyt(l.db, z.tg_id);
      await uvedom.cheloveku(
        l,
        z.tg_id,
        t.zakazOtmenen(svezhy, 'net_koda', itog.vernuli, koshelek.balans(l.db, z.tg_id)),
      );
    }
    const c = lyudi.chelovek(l.db, z.tg_id);
    await uvedom.komande(
      l,
      [
        `Заказ № ${z.id} отменён: код не пришёл за ${minut} мин.`,
        '',
        `${z.nazvanie}`,
        `Покупатель: ${lyudi.podpis(c, z.tg_id)}`,
        itog.vernuli > 0 ? `Деньги вернулись на его баланс: ${itog.vernuli / 100} ₽` : 'Денег по заказу не было',
      ].join('\n'),
    );
    zhurnal.info(`заказ № ${z.id} отменён: код не пришёл за ${minut} мин.`);
  }
  return spisok.length;
}

export function zapustit(l: Lavka): NodeJS.Timeout {
  const chasy = setInterval(() => {
    proverit(l).catch((e) => zhurnal.oshibka('ожидание кода:', e));
  }, SHAG_MS);
  // Таймер не держит процесс живым сам по себе: остановка бота
  // не должна ждать следующего тика.
  chasy.unref();
  return chasy;
}
