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
import { denKratko } from '../lib/vremya.js';
import { prichina } from './texty-komandy.js';

export const KNOPKA_KUPIT = 'Купить доступ';
export const KNOPKA_ZAKAZY = 'Мои заказы';
export const KNOPKA_BALANS = 'Баланс';
export const KNOPKA_O_NAS = 'О нас';
export const KNOPKA_PODDERZHKA = 'Поддержка';
/**
 * Служебная кнопка нижней клавиатуры — ПО-АНГЛИЙСКИ, как и всё
 * служебное с сентября 2026. Покупательские четыре кнопки рядом
 * остались русскими: команда пользуется ботом и как покупатель тоже.
 */
export const KNOPKA_LAVKA = 'Shop orders';

/**
 * ПРЕЖНЯЯ подпись той же кнопки, и убирать её нельзя.
 *
 * Нижняя клавиатура живёт в клиенте Telegram, пока человек не нажмёт
 * «Старт»: у помощника, открывшего бота до выкладки, на экране
 * по-прежнему «Заказы лавки». Не принимай бот старую подпись — тот
 * нажал бы свою кнопку и получил «Не понял сообщение» ровно в ту
 * минуту, когда в очереди лежит заказ.
 */
export const KNOPKA_LAVKA_STARAYA = 'Заказы лавки';

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
    .text(KNOPKA_O_NAS)
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

/**
 * Перепроверка введённого: подтвердить или исправить.
 *
 * Префикс `sv:` не сталкивается с `svoy:` — после `sv` там идёт `o`,
 * а не двоеточие, и регулярки разбирают их однозначно.
 */
/**
 * Вид аккаунта у заказа, КОТОРЫЙ УЖЕ ЕСТЬ.
 *
 * Отдельная пара кнопок, а не та же самая, потому что за ними стоит
 * разное действие. У `nov:`/`svoy:` в данных лежит выбранный товар,
 * и заказ ещё предстоит создать; здесь — номер уже оплаченного
 * заказа с сайта, и создавать нечего. Свести их в одну пару значило
 * бы разбирать «это id товара или номер заказа» по виду строки.
 */
export function vidAkkauntaZakaza(zakazId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Новый аккаунт', `zn:${zakazId}`)
    .row()
    .text('У меня уже есть аккаунт', `zs:${zakazId}`);
}

export function svereniyeAkkaunta(): InlineKeyboard {
  return new InlineKeyboard().text('Всё верно', 'sv:da').row().text('Исправить', 'sv:pr');
}

/**
 * Что именно исправляем. Двух кнопок хватает, потому что вопрос
 * ровно один: какое из двух полей набрано с опечаткой. Возвращать
 * человека к вводу ОБОИХ полей значило бы терять то, что он уже
 * набрал верно, — а этого просили не делать.
 */
export function chtoIspravit(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Почту', 'sv:po')
    .text('Пароль', 'sv:pa')
    .row()
    .text('← Назад', 'sv:naz');
}

export function svereniyeKoda(): InlineKeyboard {
  return new InlineKeyboard().text('Всё верно', 'kd:da').row().text('Исправить', 'kd:pr');
}

/**
 * Кнопка оплаты — ССЫЛКА, а не нажатие.
 *
 * Нажатие пришлось бы обрабатывать боту, а он в этот момент может
 * ждать Telegram; ссылка открывается мгновенно и не зависит от нас
 * вовсе. Стоит первой и одна в ряду: это единственное, что человеку
 * сейчас нужно сделать.
 */
export function poslePokupki(zakazId: number, oplataUrl?: string | null): InlineKeyboard {
  const k = new InlineKeyboard();
  if (oplataUrl) k.url('Оплатить', oplataUrl).row();
  return k.text('Мои заказы', 'zak').row().text('Заказ целиком', `z:${zakazId}`);
}

/**
 * Список заказов покупателя.
 *
 * НОМЕРА В ПОДПИСИ НЕТ — решение владельца: покупатель номера
 * не видит нигде. Вместо него дата оформления, и она тут не для
 * красоты: у одного человека бывает два выданных заказа на один
 * и тот же уровень, и без даты кнопки были бы неотличимы. Сам
 * номер по-прежнему едет в данных кнопки (`z:12`) — он нужен боту,
 * а не глазу.
 */
export function moiZakazy(spisok: Zakaz[], poyas: string): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const z of spisok) {
    k.text(`${z.nazvanie} · ${denKratko(new Date(z.sozdan), poyas)}`, `z:${z.id}`).row();
  }
  return k;
}

export function zakazCheloveka(z: Zakaz, estDostup: boolean, oplataUrl?: string | null): InlineKeyboard {
  const k = new InlineKeyboard();
  if (estDostup) k.text('Показать логин и пароль', `d:${z.id}`).row();
  /* Оплата ЗДЕСЬ ЖЕ, и это главное в карточке неоплаченного заказа:
     человек, закрывший окно оплаты, возвращается в бот и должен
     найти вторую попытку там, где смотрел первый раз. Заново
     оформлять заказ ради этого он не должен. */
  if (oplataUrl) k.url('Оплатить', oplataUrl).row();
  k.text('← К заказам', 'zak');
  return k;
}

/* Ссылка НА КНОПКЕ, а не строкой в тексте: нижняя клавиатура
   URL не носит вовсе — Telegram разрешает ей только текст, —
   поэтому «Поддержка» внизу открывает сообщение, а ссылка живёт
   в кнопке под ним.

   КНОПКИ «НАПИСАТЬ АДМИНИСТРАТОРУ» ЗДЕСЬ БОЛЬШЕ НЕТ: владелец снял
   её вместе с переименованием раздела в «О нас». Частный случай
   разбирает живой человек в поддержке, а не пересланный ботом
   вопрос, и текст раздела четырежды говорит об этом словами. */
export const oNas = (): InlineKeyboard =>
  new InlineKeyboard().url(KNOPKA_PODDERZHKA, PODDERZHKA);

export const poddershka = (): InlineKeyboard =>
  new InlineKeyboard().url('Написать в поддержку', PODDERZHKA);

/* ── служебные ───────────────────────────────────────────────────────
   Всё ниже видят владелец и помощник, и говорит оно ПО-АНГЛИЙСКИ —
   решение владельца, сентябрь 2026. Кнопки покупателя выше остались
   русскими. Причины отмены берутся из словаря панели, а не пишутся
   здесь второй раз: одна и та же причина в боте и в панели обязана
   называться одними словами. */

export function sluzhebnoe(rol: Rol): InlineKeyboard {
  const k = new InlineKeyboard()
    .text('Delivery queue', 'aoch')
    .row()
    .text('On me', 'amoi')
    .row()
    .text('Awaiting payment', 'aneopl')
    .row();
  if (rol === 'vladelec') {
    k.text('People', 'alyudi').row().text('Statistics', 'astat').row().text('Settings', 'anastr');
  }
  return k;
}

export function novyZakazAdminu(z: Zakaz, oplachen: boolean, vladelec: boolean): InlineKeyboard {
  const k = new InlineKeyboard();
  if (!oplachen && vladelec) k.text('Payment received', `aopl:${z.id}`).row();
  else k.text('Take into work', `avz:${z.id}`).row();
  k.text('Open order', `az:${z.id}`);
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
export function zakazAdminu(z: Zakaz, pod: Pod | boolean, vladelec: boolean): InlineKeyboard {
  const p: Pod = typeof pod === 'boolean' ? { estDostup: pod, estKod: false, estAkkaunt: false } : pod;
  const k = new InlineKeyboard();
  const uPomoshnika = z.status === 'v_rabote' || z.status === 'zhdem_kod' || z.status === 'kod_poluchen';

  /* Отметка оплаты — деньги, значит владелец. Флаг обязателен, а не
     «по умолчанию можно»: умолчание здесь означало бы, что забытый
     на новом месте вызов молча показывает помощнику чужие деньги. */
  if (z.status === 'zhdet_oplaty' && vladelec) k.text('Payment received', `aopl:${z.id}`).row();
  if (z.status === 'oplachen') k.text('Take into work', `avz:${z.id}`).row();

  /* ВВОД ДОСТУПА СТОИТ ПЕРВЫМ У ПОМОЩНИКА, и это про необязательность
     кода. Прежде над ним лежали «Данные аккаунта» и «Запросить код»,
     и порядок читался как очередь шагов: сначала спроси код, потом
     вводи. Код при входе спрашивают не все нейросети — значит путь
     к выдаче идёт мимо него, а всё, что про чужой аккаунт, стоит
     ниже отдельной кучкой. */
  if (uPomoshnika) k.text(p.estDostup ? 'Change access' : 'Enter access', `avv:${z.id}`).row();

  if (uPomoshnika && z.vid_akkaunta === 'svoy') {
    if (p.estAkkaunt) k.text('Customer account details', `aakk:${z.id}`).row();
    if (z.status !== 'zhdem_kod') k.text('Request 2FA code', `akodz:${z.id}`).row();
    if (p.estKod) k.text('Show code', `akodp:${z.id}`).row();
    if (!z.pismo_v) k.text('Mark: reset email sent', `apis:${z.id}`).row();
    else k.text('Cancel: password did not match', `aparol:${z.id}`).row();
  }

  if (uPomoshnika) k.text('Return to queue', `aver:${z.id}`).row();

  if (z.status !== 'vydan' && z.status !== 'otmenen') k.text('Cancel order', `aotm:${z.id}`).row();
  k.text('← Queue', 'aoch');
  return k;
}

/**
 * Причина отмены в боте.
 *
 * Раньше кнопка «Отменить заказ» писала `ruchnaya` — «отменён
 * администратором», — и это была единственная причина, которую
 * вообще можно было получить нажатием. Владелец её снял, значит
 * бот обязан спросить, как и панель: иначе панель показывает три
 * причины, а бот молча пишет четвёртую, снятую.
 *
 * Отмена по паролю здесь не предлагается: у неё свой путь через
 * `aparol:` — сначала письмо восстановления, потом отмена, и замок
 * на это стоит в базе.
 */
export function prichinaOtmeny(z: Zakaz): InlineKeyboard {
  const k = new InlineKeyboard();
  k.text(prichina('net_koda'), `aotmp:${z.id}:net_koda`).row();
  k.text(prichina('net_deneg'), `aotmp:${z.id}:net_deneg`).row();
  if (z.vid_akkaunta === 'svoy') {
    // Продлевают только СВОЙ аккаунт: у заказа на новый продлевать
    // нечего. Письма эта причина не требует — данные могли быть
    // с опечаткой в самой почте.
    k.text(prichina('nevernye_dannye'), `aotmp:${z.id}:nevernye_dannye`).row();
  }
  if (z.vid_akkaunta === 'svoy' && z.pismo_v) {
    k.text(prichina('nevernyy_parol'), `aotmp:${z.id}:nevernyy_parol`).row();
  }
  k.text('← Do not cancel', `az:${z.id}`);
  return k;
}

/** Кнопка «открыть заказ» под служебным сообщением про код. */
export function kodAdminu(zakazId: number): InlineKeyboard {
  return new InlineKeyboard().text(`Open order #${zakazId}`, `az:${zakazId}`);
}

export function ocheredAdminu(spisok: Zakaz[]): InlineKeyboard {
  const k = new InlineKeyboard();
  for (const z of spisok) k.text(`#${z.id} · ${z.nazvanie}`, `az:${z.id}`).row();
  k.text('← Shop desk', 'a');
  return k;
}

export function proverkaDostupa(zakazId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('Send to customer', `avyd:${zakazId}`)
    .row()
    .text('Enter again', `avv:${zakazId}`)
    .row()
    .text('← Order', `az:${zakazId}`);
}

export const nazadSluzhebnoe = (): InlineKeyboard => new InlineKeyboard().text('← Shop desk', 'a');

export function nastroykiVladelca(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Working hours', 'achasy')
    .row()
    .text('Team', 'akom')
    .row()
    .text('← Shop desk', 'a');
}

export function komandaVladelca(): InlineKeyboard {
  return new InlineKeyboard().text('Add an assistant', 'adobp').row().text('← Settings', 'anastr');
}

/** Люди — и пополнение баланса оттуда же: пополняет владелец. */
export function lyudiVladelca(): InlineKeyboard {
  return new InlineKeyboard().text('Top up a balance', 'abal').row().text('← Shop desk', 'a');
}

export const otmenaVvoda = (): InlineKeyboard => new InlineKeyboard().text('Cancel input', 'aotmena');
