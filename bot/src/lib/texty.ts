/**
 * Тексты бота.
 *
 * Собраны в одном месте по той же причине, по какой на сайте собраны
 * токены цвета: тон должен быть один. Тон здесь — тон лавки: спокойно,
 * по-человечески, без восклицательных знаков и без подгонялок.
 *
 * Числа в текстах не пишутся руками. Часы работы, срок обещания
 * и цены приходят из настроек и каталога — иначе смена расписания
 * превращается в поиск чисел по строкам, и одно из них обязательно
 * останется старым.
 *
 * Латиница — только в названиях продуктов и Telegram.
 */

import { chasSlovami, chasyMinuty, dataSlovami, momentSlovami, sklonenie } from './vremya.js';
import type { Raspisanie, Srok } from './vremya.js';
import { rubli } from './katalog.js';
import type { Zakaz, StatusZakaza } from '../db/zakazy.js';

export const NAZVANIE = 'Нейролавка';

export function privetstvie(imya: string, r: Raspisanie): string {
  const kak = imya ? `${imya}, здравствуйте.` : 'Здравствуйте.';
  return [
    `${kak} Это ${NAZVANIE} — здесь продают доступ к Claude, ChatGPT и Seedance.`,
    '',
    'Как это устроено. Вы выбираете нейросеть и срок, оплачиваете, ' +
      'а доступ — логин и пароль — присылаю сюда же, в этот чат. ' +
      'Доступы выдаёт человек, поэтому не мгновенно, но и не «когда-нибудь»: ' +
      `${obeshchanieVoobshche(r)}.`,
    '',
    'Ничего, кроме вашего Telegram, я не спрашиваю: ни почты, ни телефона, ни данных карты.',
  ].join('\n');
}

/** Общее обещание для приветствия — без привязки к конкретному заказу. */
export function obeshchanieVoobshche(r: Raspisanie): string {
  const skolko = r.obeshchanieMinut >= 60
    ? sklonenie(Math.round(r.obeshchanieMinut / 60), 'часа', 'часов', 'часов')
    : sklonenie(r.obeshchanieMinut, 'минуты', 'минут', 'минут');
  return (
    `в рабочие часы, с ${chasSlovami(r.rabotaS)} до ${chasSlovami(r.rabotaDo)} по Москве, ` +
    `в течение ${skolko}; ночной заказ уходит в работу утром`
  );
}

export const VYBOR_TOVARA = 'Что берём? Ниже — то, что есть в лавке.';

export function kartochkaTovara(nazvanie: string, tagline: string, note: string): string {
  return [`${nazvanie}`, tagline, '', note, '', 'Выберите срок.'].join('\n');
}

/** Карточка заказа до оформления: что именно человек берёт. */
export function podtverzhdenie(
  nazvanie: string,
  cenaKop: number,
  mesyacev: number,
  dostupDo: Date,
  srok: Srok,
  r: Raspisanie,
): string {
  return [
    'Проверьте заказ.',
    '',
    `Что: ${nazvanie}`,
    `Сколько: ${rubli(cenaKop)}`,
    `Срок: ${sklonenie(mesyacev, 'месяц', 'месяца', 'месяцев')}, доступ до ${dataSlovami(dostupDo, r.poyas)}`,
    `Когда придёт: ${kogdaPridet(srok, r)}`,
    '',
    'Доступ приходит в этот чат: логин и пароль от готового аккаунта. ' +
      'Их можно будет посмотреть ещё раз в разделе «Мои заказы».',
  ].join('\n');
}

/** Обещание по конкретному заказу. Верхняя граница, а не идеал. */
export function kogdaPridet(srok: Srok, r: Raspisanie): string {
  if (!srok.utrom) {
    return `сегодня, не позже ${chasyMinuty(srok.do, r.poyas)}`;
  }
  return `утром, после ${chasSlovami(r.rabotaS)} по Москве — сейчас лавка закрыта`;
}

export function zakazPrinyat(zakaz: Zakaz, srok: Srok, r: Raspisanie, oplataRabotaet: boolean): string {
  const shapka = [`Заказ № ${zakaz.id} записан.`, '', `${zakaz.nazvanie} — ${rubli(zakaz.cena_kop)}`];
  if (oplataRabotaet) {
    shapka.push('', 'Осталось оплатить — кнопка ниже.');
  } else {
    shapka.push(
      '',
      'Оплата в боте пока не подключена, и придумывать её я не буду. ' +
        'Заказ уже у администратора: он напишет вам сюда и скажет, как заплатить.',
      '',
      `После оплаты доступ придёт ${kogdaPridet(srok, r)}.`,
    );
  }
  shapka.push('', 'Заказ никуда не денется: он записан и виден в разделе «Мои заказы».');
  return shapka.join('\n');
}

export function zakazUzheEst(zakaz: Zakaz): string {
  return [
    `Такой заказ уже оформлен — № ${zakaz.id}, ${zakaz.nazvanie}.`,
    '',
    'Второй такой же заводить не стал: скорее всего кнопка нажалась дважды. ' +
      'Если нужен ещё один доступ на тот же срок — напишите администратору через «Помощь».',
  ].join('\n');
}

export function oplataPodtverzhdena(zakaz: Zakaz, srok: Srok, r: Raspisanie): string {
  return [
    `Оплата по заказу № ${zakaz.id} принята.`,
    '',
    `Теперь очередь за человеком: доступ придёт ${kogdaPridet(srok, r)}. ` +
      'Ждать в чате не нужно — я напишу сам, когда всё будет готово.',
  ].join('\n');
}

export function dostupVydan(zakaz: Zakaz, login: string, parol: string, zametka: string | null, r: Raspisanie): string {
  const chasti = [
    `Доступ по заказу № ${zakaz.id} готов.`,
    '',
    `${zakaz.nazvanie}`,
    ...(zakaz.dostup_do ? [`Действует до ${dataSlovami(new Date(zakaz.dostup_do), r.poyas)}`] : []),
    '',
    `Логин: ${login}`,
    `Пароль: ${parol}`,
  ];
  if (zametka) chasti.push('', zametka);
  chasti.push(
    '',
    'Пароль от аккаунта менять не нужно: аккаунт общий по подписке, ' +
      'и смена пароля закроет доступ вам же. Если что-то не входит — ' +
      'напишите через «Помощь», разберёмся.',
    '',
    'Эти же логин и пароль всегда лежат в разделе «Мои заказы».',
  );
  return chasti.join('\n');
}

export const NET_ZAKAZOV = [
  'Заказов пока нет.',
  '',
  'Когда что-нибудь купите, здесь будет список: что взяли, до какого числа действует ' +
    'и логин с паролем от выданного доступа.',
].join('\n');

export function statusSlovami(s: StatusZakaza): string {
  switch (s) {
    case 'zhdet_oplaty':
      return 'ждёт оплаты';
    case 'oplachen':
      return 'оплачен, готовим доступ';
    case 'v_rabote':
      return 'в работе';
    case 'vydan':
      return 'выдан';
    case 'otmenen':
      return 'отменён';
  }
}

export function strokaZakaza(z: Zakaz, r: Raspisanie): string {
  const hvost =
    z.status === 'vydan' && z.dostup_do ? ` · до ${dataSlovami(new Date(z.dostup_do), r.poyas)}` : ` · ${statusSlovami(z.status)}`;
  return `№ ${z.id} · ${z.nazvanie}${hvost}`;
}

export function kartochkaZakaza(z: Zakaz, r: Raspisanie, estDostup: boolean): string {
  const strok = [
    `Заказ № ${z.id}`,
    '',
    z.nazvanie,
    `${rubli(z.cena_kop)} · ${statusSlovami(z.status)}`,
    `Оформлен ${momentSlovami(new Date(z.sozdan), r.poyas)}`,
  ];
  if (z.status === 'vydan' && z.dostup_do) {
    strok.push(`Доступ действует до ${dataSlovami(new Date(z.dostup_do), r.poyas)}`);
  }
  if ((z.status === 'oplachen' || z.status === 'v_rabote') && z.srok_do) {
    strok.push('', `Обещал не позже ${momentSlovami(new Date(z.srok_do), r.poyas)}.`);
  }
  if (z.status === 'zhdet_oplaty') {
    strok.push('', 'Оплата в боте пока не подключена — администратор напишет вам сам.');
  }
  if (estDostup) strok.push('', 'Логин и пароль — по кнопке ниже.');
  return strok.join('\n');
}

export function pomoshch(r: Raspisanie, botUrl: string): string {
  return [
    'Коротко о главном.',
    '',
    `Часы работы: с ${chasSlovami(r.rabotaS)} до ${chasSlovami(r.rabotaDo)} по Москве. ` +
      'Заказ можно оформить в любое время суток, но выдаёт доступ человек, ' +
      'поэтому ночной заказ уходит в работу утром.',
    '',
    'Доступ не пришёл в обещанный срок. Напишите сюда — я передам администратору, ' +
      'и он ответит вам лично. Что делать дальше, решаете вы вдвоём: ' +
      'придумывать за него правила я не буду.',
    '',
    'Как продлить. Оформите такой же заказ ещё раз, когда срок будет подходить к концу. ' +
      'Продление — это новый заказ на тот же срок; аккаунт по возможности оставляем прежний, ' +
      'скажите об этом при оформлении.',
    '',
    'Что-то не входит. Проверьте, что копируете пароль целиком, без пробела в конце. ' +
      'Не помогло — напишите, разберёмся.',
    '',
    'Что я про вас знаю: ваш Telegram и ваши заказы. Телефон, почту и данные карты ' +
      'я не спрашиваю и не храню.',
    botUrl ? `\nСайт: ${botUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const NAPISAT_ADMINU = [
  'Напишите одним сообщением, что случилось, — я передам администратору.',
  '',
  'Если вопрос по конкретному заказу, назовите его номер.',
].join('\n');

export const VOPROS_PRINYAT = [
  'Передал. Администратор ответит вам здесь же.',
  '',
  'В рабочие часы это обычно быстро, ночью — утром.',
].join('\n');

export const NE_PONYAL = [
  'Не понял сообщение.',
  '',
  'Внизу есть кнопки: «Купить доступ», «Мои заказы» и «Помощь». ' +
    'Если нужно написать администратору — это в «Помощи».',
].join('\n');

export const OSHIBKA_OBSHCHAYA = [
  'Что-то пошло не так на моей стороне.',
  '',
  'Заказы от этого не теряются: всё, что было оформлено, записано. ' +
    'Попробуйте ещё раз через минуту, а если повторится — напишите через «Помощь».',
].join('\n');

export const TARIF_PROPAL = 'Этого тарифа больше нет в каталоге. Посмотрите, что есть сейчас.';
