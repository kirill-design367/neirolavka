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
 */

import { request } from 'node:https';
import { setDefaultResultOrder } from 'node:dns';
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
    setDefaultResultOrder('ipv6first');
    return { vybrano: 6, proby };
  }
  const chetyre = await proba(host, 4);
  proby.push(chetyre);
  if (chetyre.ok) {
    setDefaultResultOrder('ipv4first');
    return { vybrano: 4, proby };
  }
  return { vybrano: null, proby };
}

/** Одна строка про каждую пробу — в журнал. */
export function rasskazat(host: string, v: Vybor): void {
  for (const p of v.proby) {
    if (p.ok) zhurnal.info(`${host} по IPv${p.semeystvo}: ответил за ${p.ms} мс, адрес ${p.adres ?? '?'}`);
    else zhurnal.vnimanie(`${host} по IPv${p.semeystvo}: ${p.oshibka} (${p.ms} мс)`);
  }
  if (v.vybrano === null) {
    zhurnal.oshibka(`${host} не отвечает ни по IPv6, ни по IPv4`);
  } else {
    zhurnal.info(`иду в ${host} по IPv${v.vybrano}`);
  }
}
