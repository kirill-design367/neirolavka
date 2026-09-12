/**
 * Робокасса: приём платежей.
 *
 * Здесь ровно три вещи, и все три — про подпись. Всё остальное
 * (кто кому что должен, когда заказ считается оплаченным, куда
 * деваются деньги при отмене) живёт в `db/zakazy.ts` и не меняется
 * от того, кто принёс деньги.
 *
 *   1. собрать ссылку на оплату и подписать её ПАРОЛЕМ №1;
 *   2. проверить уведомление на ResultURL подписью с ПАРОЛЕМ №2;
 *   3. проверить возврат человека на SuccessURL подписью с ПАРОЛЕМ №1.
 *
 * ТРИ РАЗНЫЕ ПОДПИСИ И ДВА РАЗНЫХ ПАРОЛЯ — и путать их нельзя.
 * Пароль №2 знает только наш сервер и Робокасса; именно поэтому
 * уведомление, подписанное им, можно считать правдой. Проверь мы
 * уведомление паролем №1 — тем самым, который уезжает в браузер
 * человека в составе ссылки, — «оплачено» мог бы сказать кто угодно,
 * кто хоть раз видел ссылку на оплату.
 *
 * ТЕСТОВЫЙ РЕЖИМ — ЭТО ДРУГАЯ ПАРА ПАРОЛЕЙ, а не только флажок
 * `IsTest=1`. Боевые пароли в тестовом режиме дают ошибку 29
 * («неверная подпись»), и ошибка эта неотличима от настоящей ошибки
 * в формуле: полдня уходит на поиск поломки, которой нет. Поэтому
 * пароли выбираются здесь, ОДНИМ местом, вместе с флажком.
 */

import { createHash } from 'node:crypto';
import type { PostavshchikOplaty, Schet, Uvedomlenie, ZaprosScheta } from './index.js';

/** Куда человек уходит платить. */
export const ADRES_OPLATY = 'https://auth.robokassa.ru/Merchant/Index.aspx';

/**
 * Чем хешируется подпись.
 *
 * Робокасса позволяет выбрать алгоритм в настройках магазина; по
 * умолчанию там md5. Значение обязано совпадать с тем, что выбрано
 * в кабинете, иначе — ошибка 29 на ровном месте.
 */
export type Algoritm = 'md5' | 'ripemd160' | 'sha1' | 'sha256' | 'sha384' | 'sha512';

export const ALGORITMY: Algoritm[] = ['md5', 'ripemd160', 'sha1', 'sha256', 'sha384', 'sha512'];

/**
 * В каком виде чек входит в подпись.
 *
 * ЭТО БЫЛО ЕДИНСТВЕННЫМ МЕСТОМ, ГДЕ МЫ НЕ БЫЛИ УВЕРЕНЫ. Теперь
 * ЗАМЕРЕНО: `syroy` — чек входит в строку подписи РАСКОДИРОВАННЫМ,
 * тем самым JSON, который видит сервер после разбора строки запроса.
 *
 * Документация Робокассы говорит обратное («перед добавлением
 * в строку подписи значение Receipt необходимо URL-кодировать»),
 * и так же устроена проба подписи холда в её официальном SDK. Но путь
 * оплаты через POST в том же SDK подписывает чек раскодированным,
 * и правым оказался он. Разница видна только на живом ответе, потому
 * что оба вида дают ОДИН И ТОТ ЖЕ отказ на глаз — «ошибка 29».
 *
 * Как это разделили. Проба перебрала шесть алгоритмов на оба вида
 * чека: одиннадцать сочетаний ответили 29, и ровно одно — `md5`
 * с сырым чеком — ответило ДРУГОЙ ошибкой, 838. Другая ошибка здесь
 * и есть доказательство: 838 — это уже не про подпись, а про режим
 * магазина, то есть подпись к тому моменту принята. Отсюда правило
 * для любой будущей возни с подписью: ищите не «прошло», а «ответ
 * ИЗМЕНИЛСЯ». Пока все сочетания отвечают одинаково, вы не отличаете
 * их вовсе.
 */
export type VidChekaVPodpisi = 'kodirovanny' | 'syroy';

/**
 * Что означают номера, которыми Робокасса отвечает вместо страницы
 * оплаты. Список неполный намеренно: сюда попадает то, обо что мы
 * ударились сами, — пересказывать чужую документацию по памяти
 * незачем, а вот объяснить пробе её собственный вывод надо.
 */
export const OSHIBKI: Record<string, string> = {
  29: 'подпись не принята. Не тот пароль, не тот алгоритм или не тот вид чека в строке подписи.',
  40: 'номер счёта уже использован. Повторный InvId Робокасса не принимает никогда.',
  838:
    'ПОДПИСЬ ПРИНЯТА, а платёж ведётся как ТЕСТОВЫЙ, и параметры тестовых платежей ' +
    'в кабинете не заполнены. Лечится в кабинете Робокассы, а не в коде: ' +
    'Магазины → Технические настройки → «Параметры тестовых платежей» — ' +
    'завести тестовые пароли № 1 и № 2 (они обязаны отличаться от боевых). ' +
    'Если платёж объявлен боевым, а Робокасса всё равно ведёт его тестовым, ' +
    'значит магазин ещё не активирован: неактивированный магазин умеет только тестовые платежи.',
};

/**
 * Что ответила страница Робокассы вместо страницы оплаты.
 *
 * Ответ приходит СТРАНИЦЕЙ, а не кодом: HTTP при этом 200, а беда
 * описана текстом с номером. Ищем номер, а не фразу — фразы меняются,
 * номера нет. Текст при этом возвращается целиком: неизвестный номер
 * обязан объяснить себя сам, иначе следующий заход начнётся с того же
 * вопроса «а что такое 838».
 *
 * Живёт здесь, а не в пробе, по той же причине, что и подписи: это
 * знание о чужом протоколе, и проверять его надо отдельно от того,
 * кто им пользуется.
 */
export function nomerOshibki(telo: string): { nomer: string | null; tekst: string } {
  const bezTegov = telo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /(?:код|code|ошибк\w*)\D{0,20}(\d{1,4})/i.exec(bezTegov);
  return { nomer: m ? m[1]! : null, tekst: bezTegov.slice(0, 300) };
}

export type NastroykiRobokassy = {
  /** Идентификатор магазина. */
  login: string;
  /** Боевой пароль №1 — подпись ссылки и проверка SuccessURL. */
  parol1: string;
  /** Боевой пароль №2 — проверка уведомления на ResultURL. */
  parol2: string;
  /** Тестовый пароль №1. */
  testParol1: string;
  /** Тестовый пароль №2. */
  testParol2: string;
  /** Тестовый режим: деньги не списываются. */
  test: boolean;
  algoritm: Algoritm;
  /**
   * Система налогообложения в чеке. Пусто — берётся та, что заведена
   * в кабинете магазина; для продавца с ОДНОЙ системой это и есть
   * правильный ответ, а выдуманная строка в фискальном чеке — уже
   * не мелочь вёрстки.
   */
  sno: string;
  chekVPodpisi: VidChekaVPodpisi;
};

/** Позиция чека. Состав передаётся в каждом платеже. */
export type PoziciyaCheka = {
  name: string;
  quantity: number;
  /** Сумма позиции в РУБЛЯХ, с двумя знаками. */
  sum: number;
  payment_method: 'full_payment';
  payment_object: 'service';
  /** НДС. У продавца на УСН — «none». */
  tax: 'none';
};

/**
 * Копейки в рубли строкой с двумя знаками.
 *
 * Строкой, а не числом, и это важно: подпись считается по ТОЙ ЖЕ
 * строке, которая уедет в параметре `OutSum`. Число 1259.1
 * и строка «1259.10» — это разные строки, и хеш у них разный.
 */
export function rubliStrokoy(kop: number): string {
  return (Math.round(kop) / 100).toFixed(2);
}

/**
 * Чек по заказу.
 *
 * Одна позиция: человек покупает один доступ. Количество — единица,
 * сумма позиции равна сумме платежа, иначе касса не сойдётся.
 *
 * СУММА ПОЗИЦИИ — ЭТО СУММА ПЛАТЕЖА, А НЕ ЦЕНА ТАРИФА. Человек,
 * закрывший половину заказа балансом, платит остаток — и в чеке
 * обязан стоять этот остаток: чек пробивается на те деньги, которые
 * прошли через кассу.
 */
export function chek(n: NastroykiRobokassy, nazvanie: string, summaKop: number): Record<string, unknown> {
  const poziciya: PoziciyaCheka = {
    name: nazvanie,
    quantity: 1,
    sum: Number(rubliStrokoy(summaKop)),
    payment_method: 'full_payment',
    payment_object: 'service',
    tax: 'none',
  };
  const out: Record<string, unknown> = { items: [poziciya] };
  if (n.sno) out['sno'] = n.sno;
  return out;
}

/** Хеш подписи в том виде, в каком его ждёт Робокасса: hex. */
function hesh(n: NastroykiRobokassy, stroka: string): string {
  return createHash(n.algoritm).update(stroka, 'utf8').digest('hex');
}

/**
 * Пользовательские параметры (`Shp_…`) в строке подписи.
 *
 * Они добавляются ПОСЛЕ пароля, парами `ключ=значение`,
 * отсортированными по ключу. Сортировка не украшение: Робокасса
 * присылает их обратно в произвольном порядке, и без общего правила
 * наша строка и её строка не совпадут.
 *
 * Мы своих `Shp_` не передаём вовсе — заказ находится по номеру
 * счёта, — но разбор уведомления обязан их учитывать: параметр может
 * появиться со стороны Робокассы, и тогда он войдёт в подпись.
 */
export function shpHvost(pary: Record<string, string>): string[] {
  return Object.keys(pary)
    .filter((k) => /^shp_/i.test(k))
    .sort()
    .map((k) => `${k}=${pary[k]}`);
}

/**
 * Подпись ссылки на оплату.
 *
 * Формат: `login:OutSum:InvId[:Receipt]:пароль1[:Shp_…]`.
 * Чек стоит ПЕРЕД паролем, пользовательские параметры — ПОСЛЕ.
 */
export function podpisSsylki(
  n: NastroykiRobokassy,
  outSum: string,
  invId: number,
  chekVStroke: string | null,
  shp: Record<string, string> = {},
): string {
  const chasti = [n.login, outSum, String(invId)];
  if (chekVStroke) chasti.push(chekVStroke);
  chasti.push(n.test ? n.testParol1 : n.parol1);
  return hesh(n, [...chasti, ...shpHvost(shp)].join(':'));
}

/**
 * Подпись уведомления на ResultURL: `OutSum:InvId:пароль2[:Shp_…]`.
 *
 * Логина в этой строке НЕТ — в отличие от подписи ссылки. Дописать
 * его «для симметрии» значит получить несходящуюся подпись и решить,
 * что Робокасса врёт.
 */
export function podpisUvedomleniya(
  n: NastroykiRobokassy,
  outSum: string,
  invId: string,
  shp: Record<string, string> = {},
): string {
  const parol = n.test ? n.testParol2 : n.parol2;
  return hesh(n, [outSum, invId, parol, ...shpHvost(shp)].join(':'));
}

/** Подпись возврата человека на SuccessURL: то же, но паролем №1. */
export function podpisVozvrata(
  n: NastroykiRobokassy,
  outSum: string,
  invId: string,
  shp: Record<string, string> = {},
): string {
  const parol = n.test ? n.testParol1 : n.parol1;
  return hesh(n, [outSum, invId, parol, ...shpHvost(shp)].join(':'));
}

/**
 * Сравнение подписей — РЕГИСТРОНЕЗАВИСИМОЕ и постоянного времени.
 *
 * Регистр: Робокасса присылает hex прописными, мы считаем строчными.
 * Время: подпись — это секрет, и по времени сравнения его можно
 * подбирать посимвольно. Дешевле сравнить честно, чем объяснять,
 * почему заказ оплатился без денег.
 */
export function podpisiSovpali(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length !== y.length) return false;
  let raznica = 0;
  for (let i = 0; i < x.length; i++) raznica |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return raznica === 0;
}

/**
 * Ссылка на оплату.
 *
 * Чек кодируется РОВНО ОДИН РАЗ. В строку запроса уезжает
 * закодированное значение, а в подпись — раскодированное
 * (`syroy`, замерено; см. `VidChekaVPodpisi`). Второе кодирование
 * поверх первого — это ошибка 29 и час недоумения.
 */
export function ssylkaOplaty(n: NastroykiRobokassy, z: ZaprosScheta): string {
  const outSum = rubliStrokoy(z.summaKop);
  const chekJson = JSON.stringify(chek(n, z.zakaz.nazvanie, z.summaKop));
  const chekKod = encodeURIComponent(chekJson);
  const podpis = podpisSsylki(n, outSum, z.nomer, n.chekVPodpisi === 'syroy' ? chekJson : chekKod);

  /* Собираем строку запроса вручную, а не через URLSearchParams:
     чек уже закодирован, и повторное кодирование его испортит. */
  const pary: string[] = [
    `MerchantLogin=${encodeURIComponent(n.login)}`,
    `OutSum=${outSum}`,
    `InvId=${z.nomer}`,
    `Description=${encodeURIComponent(opisanie(z))}`,
    `SignatureValue=${podpis}`,
    `Receipt=${chekKod}`,
    'Culture=ru',
    'Encoding=utf-8',
  ];
  if (n.test) pary.push('IsTest=1');
  return `${ADRES_OPLATY}?${pary.join('&')}`;
}

/**
 * Описание платежа — то, что человек увидит на странице оплаты
 * и в выписке банка. Не длиннее ста знаков: Робокасса режет.
 */
function opisanie(z: ZaprosScheta): string {
  const s = `Нейролавка, заказ № ${z.zakaz.id}: ${z.zakaz.nazvanie}`;
  return s.length <= 100 ? s : `${s.slice(0, 99)}…`;
}

/**
 * Разбор уведомления.
 *
 * Возвращает `null` на всём, что не сошлось: нет полей, не та
 * подпись, сумма не похожа на сумму. Вызывающий код на `null`
 * обязан ответить отказом и НИЧЕГО не менять.
 */
export function razobrat(n: NastroykiRobokassy, pary: Record<string, string>): Uvedomlenie | null {
  const outSum = (pary['OutSum'] ?? pary['outSum'] ?? '').trim();
  const invId = (pary['InvId'] ?? pary['invId'] ?? '').trim();
  const podpis = (pary['SignatureValue'] ?? pary['signatureValue'] ?? '').trim();
  if (!outSum || !invId || !podpis) return null;
  if (!/^\d+$/.test(invId)) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(outSum)) return null;
  if (!podpisiSovpali(podpis, podpisUvedomleniya(n, outSum, invId, pary))) return null;
  return {
    nomer: Number(invId),
    summaKop: Math.round(Number(outSum) * 100),
    oplachen: true,
  };
}

/** Проверка возврата человека на SuccessURL. Ничего не меняет. */
export function proveritVozvrat(n: NastroykiRobokassy, pary: Record<string, string>): { nomer: number } | null {
  const outSum = (pary['OutSum'] ?? '').trim();
  const invId = (pary['InvId'] ?? '').trim();
  const podpis = (pary['SignatureValue'] ?? '').trim();
  if (!outSum || !invId || !podpis || !/^\d+$/.test(invId)) return null;
  if (!podpisiSovpali(podpis, podpisVozvrata(n, outSum, invId, pary))) return null;
  return { nomer: Number(invId) };
}

/** Что отвечать Робокассе на принятое уведомление. */
export function otvetPrinyato(nomer: number): string {
  return `OK${nomer}`;
}

/** Поставщик оплаты для свёртка лавки. */
export function sozdatRobokassu(n: NastroykiRobokassy): PostavshchikOplaty {
  return {
    imya: 'robokassa',
    rabotaet: Boolean(n.login) && Boolean(n.test ? n.testParol1 : n.parol1),
    async vystavit(z: ZaprosScheta): Promise<Schet> {
      return {
        vneshnyId: String(z.nomer),
        adres: ssylkaOplaty(n, z),
        /* ПУСТО В БОЕВОМ РЕЖИМЕ, и это не лень. Строка приписывается
           к сообщению о заказе; в бою человеку нечего сообщать сверх
           кнопки, а лишний абзац только отодвигает её. А вот про
           ТЕСТОВЫЙ режим молчать нельзя: человек попадёт на страницу
           Робокассы, где деньги не спишутся, и должен понимать,
           почему у него ничего не купилось. */
        soobshchenie: n.test
          ? 'Оплата сейчас в ТЕСТОВОМ режиме: деньги не спишутся, доступ по такой оплате не выдаётся.'
          : '',
        gotovoSrazu: false,
      };
    },
    razobratUvedomlenie(pary: Record<string, string>): Uvedomlenie | null {
      return razobrat(n, pary);
    },
  };
}
