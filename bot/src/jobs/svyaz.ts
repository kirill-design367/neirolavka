/**
 * Присмотр за путём до Telegram.
 *
 * Сеть здесь живёт своей жизнью: IPv4 до api.telegram.org заблокирован
 * постоянно, IPv6 работает, но отваливается на секунды несколько раз
 * в час. Присмотр должен пережить и то и другое, оставаясь незаметным
 * для человека.
 *
 * Устройство — маленький автомат с ТРЕМЯ темпами вместо одного
 * расписания:
 *
 *   путь подтверждён и это IPv6  → проверяем раз в десять минут;
 *   путь подтверждён, но запасной → раз в две минуты, потому что
 *                                   на этом сервере запасной путь
 *                                   мёртв и вернуться на IPv6 надо
 *                                   при первой возможности;
 *   путь НЕ подтверждён           → раз в пятнадцать секунд, пока
 *                                   какой-нибудь не ответит.
 *
 * Прежнее устройство держало одно расписание в десять минут и хранило
 * «текущий путь» числом, которое при неизвестности молча становилось
 * четвёркой. Цена ошибки в журнале владельца: бот поднялся, не достучавшись
 * ни по одному пути, объявил себя работающим по IPv4 — и молчал двадцать
 * минут, пока расписание не дошло до следующей проверки.
 *
 * Отсюда два правила, которые нельзя нарушать:
 *
 * 1. НЕПОДТВЕРЖДЁННЫЙ ПУТЬ — ЭТО null, А НЕ ЧИСЛО. Пока проба
 *    не ответила, выбора нет, и об этом видно и в журнале, и в /health.
 * 2. ОДИН МОЛЧОК — ЕЩЁ НЕ СМЕНА ПУТИ. Отвал на секунды не должен
 *    уводить с работающего пути: сначала пробуем второе семейство,
 *    и только если ответило ОНО, переключаемся.
 */

import type { Lavka } from '../lavka.js';
import { probaSemeystva, vybratPut, rasskazat, postavitPoryadok, slushatObryvy, PREDPOCHTENIE } from '../lib/svyaz.js';
import type { Proba, Semeystvo } from '../lib/svyaz.js';
import { zhurnal } from '../lib/zhurnal.js';

const UZEL = 'api.telegram.org';

/** Путь подтверждён и он предпочтительный: смотреть можно редко. */
export const SHAG_ZDOROVYY_MS = 10 * 60_000;
/** Путь подтверждён, но запасной: возвращаться на основной — быстро. */
export const SHAG_ZAPASNOY_MS = 2 * 60_000;
/** Путь не подтверждён: ищем часто, пока не найдём. */
export const SHAG_POISKA_MS = 15_000;

export type Nastroyki = {
  uzel?: string;
  proba?: (h: string, s: Semeystvo) => Promise<Proba>;
  /** Полный выбор пути. Отдельно от пробы — ради подстановки в проверках. */
  vybor?: (h: string, p: (h: string, s: Semeystvo) => Promise<Proba>) => Promise<{ vybrano: Semeystvo | null; proby: Proba[] }>;
};

export type Prismotr = {
  /** Что подтверждено сейчас. null — путь неизвестен, идёт поиск. */
  put(): Semeystvo | null;
  /** Сколько ждать до следующей проверки при нынешнем состоянии. */
  shagMs(): number;
  /** Один круг проверки. Возвращает подтверждённый путь. */
  proverit(): Promise<Semeystvo | null>;
  zapustit(): void;
  ostanovit(): void;
};

export function sozdatPrismotr(nachalnyy: Semeystvo | null, n: Nastroyki = {}): Prismotr {
  const uzel = n.uzel ?? UZEL;
  const proba = n.proba ?? probaSemeystva;
  const vybor = n.vybor ?? ((h, p) => vybratPut(h, p));

  let put: Semeystvo | null = nachalnyy;
  let chasy: NodeJS.Timeout | null = null;
  let idyot = false;
  // Сколько кругов подряд не нашли ничего. Нужен ровно для журнала:
  // писать «никто не отвечает» каждые пятнадцать секунд — значит
  // залить журнал и потерять в нём всё остальное.
  let molchaniyPodryad = 0;

  const shagMs = (): number => {
    if (put === null) return SHAG_POISKA_MS;
    return put === PREDPOCHTENIE ? SHAG_ZDOROVYY_MS : SHAG_ZAPASNOY_MS;
  };

  const drugoe = (s: Semeystvo): Semeystvo => (s === 6 ? 4 : 6);

  const polnyyVybor = async (): Promise<void> => {
    const v = await vybor(uzel, proba);
    if (v.vybrano !== null) {
      if (molchaniyPodryad > 0) {
        zhurnal.info(`${uzel} снова отвечает — иду по IPv${v.vybrano}`);
      }
      molchaniyPodryad = 0;
      put = v.vybrano;
      rasskazat(uzel, v);
      return;
    }
    // Не ответил никто. Путь остаётся НЕизвестным: сесть на семейство,
    // которое молчит, — это и есть залипание, из-за которого бот
    // замолкал на двадцать минут.
    put = null;
    molchaniyPodryad += 1;
    if (molchaniyPodryad === 1 || molchaniyPodryad % 20 === 0) {
      rasskazat(uzel, v);
      zhurnal.vnimanie(
        `${uzel} молчит ${molchaniyPodryad}-й круг подряд (проверяю раз в ${Math.round(SHAG_POISKA_MS / 1000)} с). ` +
          'Бот жив, обновления копятся у Telegram и придут, когда связь вернётся.',
      );
    }
  };

  const proverit = async (): Promise<Semeystvo | null> => {
    if (idyot) return put;
    idyot = true;
    try {
      if (put === null) {
        await polnyyVybor();
        return put;
      }

      const svoy = await proba(uzel, put);
      if (svoy.ok) {
        molchaniyPodryad = 0;
        // Путь жив. Если он ЗАПАСНОЙ — проверяем заодно основной:
        // сидеть на запасном дольше необходимого нельзя, на этом
        // сервере он заблокирован постоянно.
        if (put !== PREDPOCHTENIE) {
          const osnovnoy = await proba(uzel, PREDPOCHTENIE);
          if (osnovnoy.ok) {
            put = PREDPOCHTENIE;
            postavitPoryadok(PREDPOCHTENIE);
            zhurnal.info(`${uzel} снова доступен по IPv${PREDPOCHTENIE} — возвращаюсь на него`);
          }
        }
        return put;
      }

      // Текущий путь молчит. ОДИН молчок — ещё не смена пути: сначала
      // спрашиваем второе семейство, и переключаемся, только если
      // ответило оно. Иначе секундный отвал IPv6 уводил бы бота
      // на заблокированный IPv4.
      const zapasnoy = drugoe(put);
      const drugaya = await proba(uzel, zapasnoy);
      if (drugaya.ok) {
        zhurnal.vnimanie(
          `${uzel} перестал отвечать по IPv${put} (${svoy.oshibka}), ` +
            `но отвечает по IPv${zapasnoy} — перехожу на него`,
        );
        put = zapasnoy;
        postavitPoryadok(zapasnoy);
        molchaniyPodryad = 0;
        return put;
      }

      // Молчат оба. Выбора нет — и объявлять его нельзя.
      zhurnal.vnimanie(
        `${uzel} не отвечает ни по IPv${put}, ни по IPv${zapasnoy}. ` +
          'Путь снят, ищу заново каждые несколько секунд.',
      );
      put = null;
      postavitPoryadok(PREDPOCHTENIE);
      molchaniyPodryad = 1;
      return put;
    } finally {
      idyot = false;
    }
  };

  const perevzvesti = () => {
    if (chasy) clearTimeout(chasy);
    chasy = setTimeout(krug, shagMs());
    // Таймер не держит процесс живым сам по себе: остановка бота
    // не должна ждать следующего тика.
    chasy.unref();
  };

  const krug = () => {
    proverit()
      .catch((e) => zhurnal.oshibka('присмотр за связью:', e))
      .finally(perevzvesti);
  };

  return {
    put: () => put,
    shagMs,
    proverit,
    zapustit() {
      perevzvesti();
      // Обрыв исходящего запроса — самый ранний признак, что путь умер.
      // Проверяем сразу, не дожидаясь расписания: между обрывом
      // и проверкой человек сидит в тишине.
      slushatObryvy(() => {
        if (idyot) return;
        if (chasy) clearTimeout(chasy);
        chasy = setTimeout(krug, 0);
        chasy.unref();
      });
    },
    ostanovit() {
      if (chasy) clearTimeout(chasy);
      chasy = null;
      slushatObryvy(null);
    },
  };
}

/** Совместимость с точкой входа: поднять присмотр и вернуть его. */
export function zapustit(l: Lavka, nachalnyy: Semeystvo | null): Prismotr {
  const p = sozdatPrismotr(nachalnyy);
  p.zapustit();
  void l;
  return p;
}
