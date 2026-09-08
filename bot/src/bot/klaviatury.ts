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
import { kopeyki, rubliIli } from '../lib/katalog.js';
import type { Zakaz } from '../db/zakazy.js';
import type { Rol } from '../db/komanda.js';

export const KNOPKA_KUPIT = 'Купить доступ';
export const KNOPKA_ZAKAZY = 'Мои заказы';
export const KNOPKA_BALANS = 'Баланс';
export const KNOPKA_POMOSHCH = 'Помощь';
export const KNOPKA_PODDERZHKA = 'Поддержка';
export const KNOPKA_LAVKA = 'Заказы лавки';

/** Живой человек поддержки. Отдельно от бота: бот отвечает по делу,
 *  а разбираться с частным случаем идут сюда. */
export const PODDERZHKA = 'https://t.me/Neirolavka_help';

export function nizhnyaya(rol: Rol | null): Keyboard {
  const k = new Keyboard()
    .text(KNOPKA_KUPIT)
    .row()
    .text(KNOPKA_ZAKAZY)
    .text(KNOPKA_BALANS)
    .row()
    .text(KNOPKA_POMOSHCH)
    .text(KNOPKA_PODDERZHKA);
  if (rol) k.row().text(KNOPKA_LAVKA);
  return k.resized().persistent();
}

export function tovary(spisok: Product[]): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const t of spisok) k.text(t.name, `t:${t.id}`).row();
  return k;
}

/** Уровни подписки продукта. Зовётся только у того, у кого они есть. */
export function tarify(t: Product): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const p of t.plans) k.text(`${p.short} — ${rubliIli(kopeyki(p))}`, `p:${p.id}`).row();
  k.text('← К списку', 'kup');
  return k;
}

/**
 * Продукт БЕЗ уровней: выбирать нечего, поэтому его карточка сразу
 * и есть подтверждение заказа. Назад — к списку товаров, а не
 * к самой карточке: возврат на то же место был бы кнопкой в никуда.
 */
export function oformitPodpisku(produktId: string): InlineKeyboard {
  return new InlineKeyboard().text('Оформить заказ', `of:${produktId}`).row().text('← К списку', 'kup');
}

export function oformit(planId: string, produktId: string): InlineKeyboard {
  return new InlineKeyboard().text('Оформить заказ', `of:${planId}`).row().text('← Назад', `t:${produktId}`);
}

/**
 * Развилка оформления: новый аккаунт или свой.
 *
 * Стоит МЕЖДУ подтверждением и заказом, а не после него: у двух путей
 * разная цена для человека — во втором он вводит свои логин и пароль
 * и должен будет прислать код с почты. Спрашивать об этом после
 * создания заказа значило бы ставить его перед фактом.
 */
export function vyborAkkaunta(vyborId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Новый аккаунт', `nov:${vyborId}`)
    .row()
    .text('У меня уже есть аккаунт', `svoy:${vyborId}`)
    .row()
    .text('← К списку', 'kup');
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

/* Ссылка НА КНОПКЕ, а не строкой в тексте: нижняя клавиатура
   URL не носит вовсе — Telegram разрешает ей только текст, —
   поэтому «Поддержка» внизу открывает сообщение, а ссылка живёт
   в кнопке под ним. */
export const pomoshch = (): InlineKeyboard =>
  new InlineKeyboard()
    .text('Написать администратору', 'vopros')
    .row()
    .url(KNOPKA_PODDERZHKA, PODDERZHKA);

export const poddershka = (): InlineKeyboard =>
  new InlineKeyboard().url('Написать в поддержку', PODDERZHKA);

// ── служебные ────────────────────────────────────────────────────────

export function sluzhebnoe(rol: Rol): InlineKeyboard {
  const k = new InlineKeyboard()
    .text('Очередь на выдачу', 'aoch')
    .row()
    .text('Мои в работе', 'amoi')
    .row()
    .text('Ждут оплаты', 'aneopl')
    .row();
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

/** Что помощник может сделать с заказом ПРЯМО СЕЙЧАС. */
export type Pod = {
  estDostup: boolean;
  /** Есть ли записанный код двухфакторной аутентификации. */
  estKod: boolean;
  /** Принёс ли покупатель свои логин и пароль. */
  estAkkaunt: boolean;
};

/**
 * Кнопки карточки заказа.
 *
 * Собираются ПО СОСТОЯНИЮ, а не показываются все сразу с отказом при
 * нажатии: помощник ведёт несколько заказов, и кнопка, которая сейчас
 * не сработает, — это лишний повод ошибиться.
 *
 * Порядок «сначала письмо, потом отмена по неверному паролю» держится
 * тем же способом: пока письмо не отмечено, кнопки отмены по паролю
 * тут просто нет. Замок при этом стоит и в базе — кнопки достаточно
 * для удобства, но не для правильности.
 */
export function zakazAdminu(z: Zakaz, pod: Pod | boolean): InlineKeyboard {
  const p: Pod = typeof pod === 'boolean' ? { estDostup: pod, estKod: false, estAkkaunt: false } : pod;
  const k = new InlineKeyboard();
  const uPomoshnika = z.status === 'v_rabote' || z.status === 'zhdem_kod' || z.status === 'kod_poluchen';

  if (z.status === 'zhdet_oplaty') k.text('Оплата пришла', `aopl:${z.id}`).row();
  if (z.status === 'oplachen') k.text('Взять в работу', `avz:${z.id}`).row();

  if (uPomoshnika && z.vid_akkaunta === 'svoy') {
    if (p.estAkkaunt) k.text('Данные аккаунта', `aakk:${z.id}`).row();
    if (z.status !== 'zhdem_kod') k.text('Запросить код', `akodz:${z.id}`).row();
    if (p.estKod) k.text('Показать код', `akodp:${z.id}`).row();
    if (!z.pismo_v) k.text('Письмо восстановления отправлено', `apis:${z.id}`).row();
    else k.text('Отменить: пароль не подошёл', `aparol:${z.id}`).row();
  }

  if (uPomoshnika) {
    k.text(p.estDostup ? 'Изменить доступ' : 'Ввести доступ', `avv:${z.id}`).row();
    k.text('Вернуть в очередь', `aver:${z.id}`).row();
  }

  if (z.status !== 'vydan' && z.status !== 'otmenen') k.text('Отменить заказ', `aotm:${z.id}`).row();
  k.text('← Очередь', 'aoch');
  return k;
}

/** Кнопка «открыть заказ» под служебным сообщением про код. */
export function kodAdminu(zakazId: number): InlineKeyboard {
  return new InlineKeyboard().text(`Открыть заказ № ${zakazId}`, `az:${zakazId}`);
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

/** Люди — и пополнение баланса оттуда же: пополняет владелец. */
export function lyudiVladelca(): InlineKeyboard {
  return new InlineKeyboard().text('Пополнить баланс', 'abal').row().text('← Служебное', 'a');
}

export const otmenaVvoda = (): InlineKeyboard => new InlineKeyboard().text('Отменить ввод', 'aotmena');
