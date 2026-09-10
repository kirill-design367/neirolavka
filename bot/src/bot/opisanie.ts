/**
 * Что человек видит ДО нажатия «Старт».
 *
 * При первом открытии бота экран пуст: одна кнопка «Старт» и больше
 * ничего. Кнопку убрать нельзя — это механика Telegram, — но над ней
 * Telegram показывает описание бота, и оно у нас было пустым. Человек,
 * пришедший по ссылке с сайта, упирался в пустоту и должен был нажать
 * на веру.
 *
 * Здесь два разных текста и два разных метода Bot API:
 *   setMyDescription      — большой текст на пустом экране до «Старта»,
 *                           до 512 знаков;
 *   setMyShortDescription — строка на карточке бота и в поиске,
 *                           до 120 знаков.
 *
 * ПИШЕМ ТОЛЬКО ПРИ РАСХОЖДЕНИИ, и это не экономия ради экономии.
 * Функция зовётся при каждом запуске, а запуск — это каждая выкладка;
 * два лишних запроса к Telegram на перезапуск ничего не стоят, но
 * и не дают ничего. Зато сравнение даёт то, чего иначе не было бы
 * вовсе: ответ на вопрос «а встало ли». После записи описание
 * читается обратно и сверяется — в журнал уходит либо «совпало»,
 * либо чем именно отличается.
 *
 * НЕУДАЧА НЕ ИМЕЕТ ПРАВА УРОНИТЬ ПОДЪЁМ. Тот же закон, что
 * у `proveritKomandu`: секундный отвал IPv6 не должен превращать
 * косметику в невзлетевшего бота. Наружу не вылетает ни одного
 * исключения, неудача — это значение.
 *
 * Аргумент у grammY ПОЗИЦИОННЫЙ (`setMyDescription(text)`), а не
 * объектом. Объект уходит на сервер как строка «[object Object]»
 * и возвращается 400 Bad Request — по такому сообщению причина
 * не видна вовсе.
 */

import { zhurnal } from '../lib/zhurnal.js';
import { raspisanie } from '../db/nastroyki.js';
import { opisanieBota, KRATKOE_OPISANIE } from '../lib/texty.js';
import type { Lavka } from '../lavka.js';

/** Пределы Bot API. Больше — запрос отвергается с 400. */
export const PREDEL_OPISANIYA = 512;
export const PREDEL_KRATKOGO = 120;

export type SostoyanieTeksta = 'совпало' | 'поставлено' | 'не вышло';

export type ItogOpisaniya = {
  opisanie: SostoyanieTeksta;
  kratkoe: SostoyanieTeksta;
};

type Tekst = {
  chto: string;
  tekst: string;
  predel: number;
  prochitat: () => Promise<string | null>;
  zapisat: (t: string) => Promise<unknown>;
};

/** Не прочли — не беда: значит поставим. Молчание тут не отказ. */
async function tiho(chtenie: () => Promise<string>): Promise<string | null> {
  try {
    return await chtenie();
  } catch {
    return null;
  }
}

async function postavitOdno(t: Tekst): Promise<SostoyanieTeksta> {
  if (t.tekst.length > t.predel) {
    /* Отвергнутый Telegram запрос выглядит в журнале как «400 Bad
       Request», по которому не видно, что именно длинно. Считаем сами. */
    zhurnal.oshibka(`${t.chto} длиннее предела: ${t.tekst.length} знаков при ${t.predel}`);
    return 'не вышло';
  }
  if ((await t.prochitat()) === t.tekst) {
    zhurnal.info(`${t.chto} бота уже стоит, менять нечего`);
    return 'совпало';
  }
  try {
    await t.zapisat(t.tekst);
  } catch (e) {
    zhurnal.oshibka(`${t.chto} бота не поставилось:`, e);
    return 'не вышло';
  }
  /* Проверяем, что встало. Не удалось перечитать — говорим прямо,
     а не выдаём отправленный запрос за проверенный итог. */
  const stalo = await t.prochitat();
  if (stalo === null) {
    zhurnal.vnimanie(`${t.chto} бота отправлено, но перечитать его не удалось`);
  } else if (stalo !== t.tekst) {
    zhurnal.oshibka(`${t.chto} бота отправлено, но Telegram отдаёт другое: ${stalo.slice(0, 80)}…`);
    return 'не вышло';
  } else {
    zhurnal.info(`${t.chto} бота поставлено и перечитано, ${t.tekst.length} знаков`);
  }
  return 'поставлено';
}

/**
 * Ставит оба описания. Зовётся при запуске и после смены часов
 * работы: час выдачи стоит в тексте описания, и без второго вызова
 * оно разошлось бы с настройками до ближайшей выкладки.
 */
export async function postavitOpisanie(l: Lavka): Promise<ItogOpisaniya> {
  const r = raspisanie(l.db, l.n);
  const opisanie = await postavitOdno({
    chto: 'описание',
    tekst: opisanieBota(r),
    predel: PREDEL_OPISANIYA,
    prochitat: () => tiho(async () => (await l.bot.api.getMyDescription()).description),
    zapisat: (t) => l.bot.api.setMyDescription(t),
  });
  const kratkoe = await postavitOdno({
    chto: 'короткое описание',
    tekst: KRATKOE_OPISANIE,
    predel: PREDEL_KRATKOGO,
    prochitat: () => tiho(async () => (await l.bot.api.getMyShortDescription()).short_description),
    zapisat: (t) => l.bot.api.setMyShortDescription(t),
  });
  return { opisanie, kratkoe };
}
