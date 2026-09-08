/**
 * Каким путём бот ходит в Telegram.
 *
 * Находка, ради которой этот модуль существует: с российского сервера
 * `api.telegram.org` НЕ ОТВЕЧАЕТ по IPv4 и прекрасно отвечает по IPv6.
 * Замер с боевой машины: `curl -4` — таймаут 10 с, `curl -6` — 302
 * за 0,13 с. При этом IPv4 самого сервера исправен (ping 8.8.8.8,
 * google по IPv4 — 200). Блокируется именно Telegram и именно
 * по IPv4.
 *
 * Полагаться на умолчание нельзя. Порядок адресов по умолчанию —
 * `verbatim`, то есть тот, что вернул системный резолвер; он зависит
 * от правил RFC 6724, содержимого /etc/gai.conf и настроения
 * дистрибутива. Работать «пока везёт» на боевом боте, который
 * принимает деньги, — не работать.
 *
 * Поэтому путь выбирается ЯВНО и вслух: пробуем оба семейства
 * настоящим соединением, печатаем, что вышло, и ставим предпочтение.
 * IPv6 предпочитаем, но не прибиваем: если однажды он отвалится,
 * а IPv4 разблокируют, проба это увидит и переключит.
 *
 * И главное правило, купленное двадцатью минутами молчания на боевом:
 * НЕПОДТВЕРЖДЁННЫЙ ПУТЬ — ЭТО НЕ ВЫБОР. Если не ответил ни один,
 * бот не объявляет «иду по IPv4» и не садится на него до следующей
 * проверки: порядок возвращается к предпочтению, а поиск продолжается.
 */

import { request } from 'node:https';
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import { zhurnal } from './zhurnal.js';

export type Semeystvo = 4 | 6;

export type Proba = {
  semeystvo: Semeystvo;
  ok: boolean;
  /** Адрес, с которым соединились. Он и есть доказательство пути. */
  adres?: string;
  ms: number;
  oshibka?: string;
};

/** Сколько ждём соединения на пробе. Заблокированный путь молчит. */
export const PREDEL_PROBY_MS = 5_000;

/**
 * Соединиться с узлом ровно по этому семейству адресов.
 *
 * Проверяется не «резолвится ли имя», а «доходит ли соединение»:
 * заблокированный маршрут отвечает молчанием, а не отказом DNS,
 * и различить это можно только настоящим соединением.
 */
export function probaSemeystva(
  host: string,
  semeystvo: Semeystvo,
  predelMs = PREDEL_PROBY_MS,
  port = 443,
): Promise<Proba> {
  return new Promise<Proba>((gotovo) => {
    const nachalo = Date.now();
    let otvecheno = false;
    const otvet = (p: Omit<Proba, 'semeystvo' | 'ms'>) => {
      if (otvecheno) return;
      otvecheno = true;
      gotovo({ semeystvo, ms: Date.now() - nachalo, ...p });
    };

    const zapros = request(
      { host, port, method: 'HEAD', path: '/', family: semeystvo, timeout: predelMs, rejectUnauthorized: false },
      (res) => {
        const adres = res.socket.remoteAddress ?? undefined;
        res.resume();
        otvet({ ok: true, adres });
      },
    );
    zapros.on('timeout', () => {
      zapros.destroy();
      otvet({ ok: false, oshibka: `молчание дольше ${predelMs} мс` });
    });
    zapros.on('error', (e) => otvet({ ok: false, oshibka: (e as Error).message }));
    zapros.end();
  });
}

/**
 * Путь, который на этом сервере работает. Предпочтение, а не догма:
 * выбор всё равно делается пробой, но при неизвестности возвращаемся
 * СЮДА, а не туда, где оказались в прошлый раз.
 */
export const PREDPOCHTENIE: Semeystvo = 6;

/** Поставить порядок адресов под выбранное семейство. */
export function postavitPoryadok(s: Semeystvo): void {
  setDefaultResultOrder(s === 6 ? 'ipv6first' : 'ipv4first');
}

/**
 * Соединяться сразу по обоим семействам и брать то, что ответит
 * первым (RFC 8305, «счастливые глазки»).
 *
 * Это вторая линия обороны, независимая от нашего выбора: даже если
 * порядок адресов оказался неверным, соединение уходит на живой путь
 * через четверть секунды вместо того, чтобы молчать до таймаута.
 * В Node 22 это умолчание, но объявляем ЯВНО: умолчания меняются
 * от версии к версии, а зависимость от них — тот же «пока везёт»,
 * из-за которого этот модуль и появился.
 */
export function nastroitSokety(): void {
  setDefaultAutoSelectFamily(true);
}

export type Vybor = { vybrano: Semeystvo | null; proby: Proba[] };

/**
 * Выбрать путь и объявить его системе.
 *
 * IPv6 сначала — не из любви к нему, а потому что это единственный
 * работающий путь к Telegram с этой машины. Если он не отвечает,
 * а IPv4 отвечает, выбор уходит на IPv4 сам: правило «предпочитаем,
 * но не прибиваем».
 */
export async function vybratPut(
  host: string,
  proba: (h: string, s: Semeystvo) => Promise<Proba> = probaSemeystva,
): Promise<Vybor> {
  const proby: Proba[] = [];
  const shest = await proba(host, 6);
  proby.push(shest);
  if (shest.ok) {
    postavitPoryadok(6);
    return { vybrano: 6, proby };
  }
  const chetyre = await proba(host, 4);
  proby.push(chetyre);
  if (chetyre.ok) {
    postavitPoryadok(4);
    return { vybrano: 4, proby };
  }
  // Не ответил никто. Это НЕ повод остаться там, где стояли: если
  // прошлый выбор был запасным IPv4, на нём и залипнем — а он на этом
  // сервере заблокирован постоянно. Возвращаем порядок к тому пути,
  // который здесь единственный живой, и честно говорим, что выбора нет.
  postavitPoryadok(PREDPOCHTENIE);
  return { vybrano: null, proby };
}

/**
 * Сообщить присмотру, что запрос оборвался.
 *
 * Шов между слоем запросов и присмотром за путём. Обрыв исходящего
 * запроса — самый ранний и самый честный признак, что путь умер:
 * ждать очередной проверки по расписанию значит держать человека
 * в молчании ровно столько, сколько до неё осталось.
 */
let naObryv: (() => void) | null = null;

export function slushatObryvy(f: (() => void) | null): void {
  naObryv = f;
}

export function soobshchitObObryve(): void {
  try {
    naObryv?.();
  } catch (e) {
    zhurnal.oshibka('присмотр за связью не отозвался на обрыв:', e);
  }
}

/** Одна строка про каждую пробу — в журнал. */
export function rasskazat(host: string, v: Vybor): void {
  for (const p of v.proby) {
    if (p.ok) zhurnal.info(`${host} по IPv${p.semeystvo}: ответил за ${p.ms} мс, адрес ${p.adres ?? '?'}`);
    else zhurnal.vnimanie(`${host} по IPv${p.semeystvo}: ${p.oshibka} (${p.ms} мс)`);
  }
  if (v.vybrano === null) {
    zhurnal.oshibka(
      `${host} не отвечает ни по IPv6, ни по IPv4. Путь НЕ выбран: ` +
        `порядок адресов вернул к IPv${PREDPOCHTENIE} и продолжаю искать.`,
    );
  } else {
    zhurnal.info(`иду в ${host} по IPv${v.vybrano}`);
  }
}
