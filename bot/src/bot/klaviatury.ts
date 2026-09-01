/**
 * Кнопки.
 *
 * Внизу экрана — постоянная клавиатура из трёх разделов, у своих
 * добавляется четвёртый. Внутри разделов — кнопки под сообщением.
 *
 * Данные кнопки короткие («z:12»): Telegram отводит на них 64 байта,
 * и длинное имя тарифа в них однажды не поместится.
 */

import { InlineKeyboard, Keyboard } from 'grammy';
import type { Product } from '../lib/katalog.js';
import { rubli } from '../lib/katalog.js';
import type { Zakaz } from '../db/zakazy.js';
import type { Rol } from '../db/komanda.js';

export const KNOPKA_KUPIT = 'Купить доступ';
export const KNOPKA_ZAKAZY = 'Мои заказы';
export const KNOPKA_POMOSHCH = 'Помощь';
export const KNOPKA_LAVKA = 'Заказы лавки';

export function nizhnyaya(rol: Rol | null): Keyboard {
  const k = new Keyboard().text(KNOPKA_KUPIT).row().text(KNOPKA_ZAKAZY).text(KNOPKA_POMOSHCH);
  if (rol) k.row().text(KNOPKA_LAVKA);
  return k.resized().persistent();
}

export function tovary(spisok: Product[]): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const t of spisok) k.text(t.name, `t:${t.id}`).row();
  return k;
}

export function tarify(t: Product): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const p of t.plans) k.text(`${p.short} — ${rubli(Math.round(p.priceRub * 100))}`, `p:${p.id}`).row();
  k.text('← К списку', 'kup');
  return k;
}

export function oformit(planId: string, produktId: string): InlineKeyboard {
  return new InlineKeyboard().text('Оформить заказ', `of:${planId}`).row().text('← Назад', `t:${produktId}`);
}

export function poslePokupki(zakazId: number): InlineKeyboard {
  return new InlineKeyboard().text('Мои заказы', 'zak').row().text('Заказ целиком', `z:${zakazId}`);
}

export function moiZakazy(spisok: Zakaz[]): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const z of spisok) k.text(`№ ${z.id} · ${z.nazvanie}`, `z:${z.id}`).row();
  return k;
}

export function zakazCheloveka(z: Zakaz, estDostup: boolean): InlineKeyboard {
  const k = new InlineKeyboard();
  if (estDostup) k.text('Показать логин и пароль', `d:${z.id}`).row();
  k.text('← К заказам', 'zak');
  return k;
}

export const pomoshch = (): InlineKeyboard => new InlineKeyboard().text('Написать администратору', 'vopros');

// ── служебные ────────────────────────────────────────────────────────

export function sluzhebnoe(rol: Rol): InlineKeyboard {
  const k = new InlineKeyboard().text('Очередь на выдачу', 'aoch').row().text('Ждут оплаты', 'aneopl').row();
  if (rol === 'vladelec') {
    k.text('Люди', 'alyudi').row().text('Статистика', 'astat').row().text('Настройки', 'anastr');
  }
  return k;
}

export function novyZakazAdminu(z: Zakaz, oplachen: boolean): InlineKeyboard {
  const k = new InlineKeyboard();
  if (!oplachen) k.text('Оплата пришла', `aopl:${z.id}`).row();
  else k.text('Взять в работу', `avz:${z.id}`).row();
  k.text('Открыть заказ', `az:${z.id}`);
  return k;
}

export function zakazAdminu(z: Zakaz, estDostup: boolean): InlineKeyboard {
  const k = new InlineKeyboard();
  if (z.status === 'zhdet_oplaty') k.text('Оплата пришла', `aopl:${z.id}`).row();
  if (z.status === 'oplachen') k.text('Взять в работу', `avz:${z.id}`).row();
  if (z.status === 'v_rabote') {
    k.text(estDostup ? 'Изменить доступ' : 'Ввести доступ', `avv:${z.id}`).row();
    k.text('Вернуть в очередь', `aver:${z.id}`).row();
  }
  if (z.status !== 'vydan' && z.status !== 'otmenen') k.text('Отменить заказ', `aotm:${z.id}`).row();
  k.text('← Очередь', 'aoch');
  return k;
}

export function ocheredAdminu(spisok: Zakaz[]): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const z of spisok) k.text(`№ ${z.id} · ${z.nazvanie}`, `az:${z.id}`).row();
  k.text('← Служебное', 'a');
  return k;
}

export function proverkaDostupa(zakazId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Отправить покупателю', `avyd:${zakazId}`)
    .row()
    .text('Ввести заново', `avv:${zakazId}`)
    .row()
    .text('← Заказ', `az:${zakazId}`);
}

export const nazadSluzhebnoe = (): InlineKeyboard => new InlineKeyboard().text('← Служебное', 'a');

export function nastroykiVladelca(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Часы работы', 'achasy')
    .row()
    .text('Команда', 'akom')
    .row()
    .text('← Служебное', 'a');
}

export function komandaVladelca(): InlineKeyboard {
  return new InlineKeyboard().text('Добавить помощника', 'adobp').row().text('← Настройки', 'anastr');
}

export const otmenaVvoda = (): InlineKeyboard => new InlineKeyboard().text('Отменить ввод', 'aotmena');
