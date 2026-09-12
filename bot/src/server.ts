/**
 * Вебхук-сервер на петле.
 *
 * Вынесен из точки входа отдельным модулем не ради красоты: проверки
 * должны гонять ТОТ ЖЕ код, который работает на сервере. Копия сервера
 * в проверке доказывает исправность копии.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { webhookCallback } from 'grammy';
import type { Lavka } from './lavka.js';
import { putVebhuka } from './config.js';
import { zhurnal } from './lib/zhurnal.js';
import { sozdatPanel, KOREN as KOREN_PANELI } from './admin/index.js';
import * as promokody from './db/promokody.js';
import { otkazSlovami } from './lib/promokod.js';
import { prinyatUvedomlenie } from './oplata/schet.js';
import { proveritVozvrat } from './oplata/robokassa.js';

/**
 * Сколько ждём обработчик, прежде чем ответить Telegram и доделать
 * начатое в стороне.
 *
 * Число выбрано не наугад. Пока Telegram не получил ответа на одно
 * обновление, он не присылает следующие: доставка последовательная,
 * и невечное молчание в ответ на одно нажатие останавливает бота
 * целиком. Это уже случалось. Восемь секунд — заведомо больше, чем
 * нужно любому нашему обработчику, и заведомо меньше, чем терпит
 * Telegram.
 */
export const PREDEL_OBRABOTKI_MS = 8_000;

/**
 * Готовность бота.
 *
 * Разделять «процесс жив» и «бот работает» пришлось после боевого
 * случая: сервер не смог достучаться до api.telegram.org, grammY
 * молча повторял getMe (он делает это БЕСКОНЕЧНО), а server.listen
 * стоял после init — и снаружи бот выглядел мёртвым, хотя процесс
 * был жив и здоров. Сорок секунд тишины стоили откаченной выкладки.
 *
 * Теперь сервер поднимается ПЕРВЫМ, а состояние говорит правду:
 * /vypusk отвечает всегда (это про то, какой код запущен), /health —
 * только когда бот действительно на связи.
 */
export type Sostoyanie = {
  gotov: boolean;
  shag: string;
  /**
   * Каким способом обновления доходят до нас ПРЯМО СЕЙЧАС.
   *
   * Не то же самое, что настройка режима: бот начинает с вебхука
   * и может перейти на опрос на ходу, если Telegram доказательно
   * не может достучаться. Поле нужно двоим — /health, чтобы говорить
   * правду, и самому серверу, чтобы не принимать вебхук, когда мы
   * уже забираем обновления сами.
   */
  dostavka: 'vebhuk' | 'opros';
};

export type Sluzhba = {
  server: Server;
  /** Путь, который слушает вебхук (с секретом). */
  put: string;
};

export function sozdatServer(l: Lavka, vypusk: string, sostoyanie: Sostoyanie): Sluzhba {
  const put = putVebhuka(l.n);

  /**
   * Панель живёт в ЭТОМ же процессе и на этом же порту.
   *
   * Не отдельная служба — и это решение, а не экономия: у SQLite
   * один пишущий, и вторая служба у той же базы означала бы очередь
   * блокировок и второй источник правды о заказе. Наружу путь
   * `/admin` проксирует nginx, порт бота по-прежнему закрыт.
   */
  const panel = sozdatPanel(l);

  const obrabotchik = webhookCallback(l.bot, 'http', {
    secretToken: l.n.sekretVebhuka,
    // Долгий обработчик не должен доводить Telegram до повтора:
    // отвечаем 200 и доделываем начатое. От двойной работы спасает
    // отсев повторов по update_id.
    onTimeout: 'return',
    timeoutMilliseconds: PREDEL_OBRABOTKI_MS,
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const adres = (req.url ?? '').split('?')[0] ?? '';
    if (adres === '/health') {
      // 503, пока бот не на связи. «Процесс жив» и «бот работает» —
      // разные вещи, и монитор должен различать их, иначе недоступный
      // Telegram выглядит как исправная лавка.
      if (sostoyanie.gotov) {
        // В теле — каким путём бот ходит в Telegram. Иначе это знание
        // живёт только в журнале сервера, куда выкладка не дотягивается,
        // и «запросы должны уходить по IPv6» остаётся намерением,
        // а не фактом.
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`жив: ${sostoyanie.shag}`);
      } else {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`не готов: ${sostoyanie.shag}`);
      }
      return;
    }
    if (adres === '/vypusk') {
      // Наружу не проксируется: спрашивает только выкладка с самого
      // сервера. Снаружи знать номер выпуска незачем.
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(vypusk);
      return;
    }
    if (adres === put && req.method === 'POST' && sostoyanie.dostavka === 'opros') {
      // Мы забираем обновления сами. Принять то же обновление ещё
      // и вебхуком значило бы обработать его дважды — от этого спасает
      // отсев по update_id, но полагаться на него как на единственную
      // защиту незачем: правильный ответ здесь «сюда больше не надо».
      zhurnal.vnimanie('вебхук пришёл, когда бот на опросе — отвечаю отказом');
      res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('бот забирает обновления опросом');
      return;
    }
    if (adres === put && req.method === 'POST') {
      // ПОСЛЕДНЯЯ ЛИНИЯ: что бы ни случилось внутри, Telegram получает
      // ответ. Прежде здесь стояло `void obrabotchik(req, res)` —
      // отказ внутри оставлял бы запрос без ответа, Telegram упирался
      // бы в таймаут и вставал в повторы, а за ним копилась бы очередь
      // всех остальных нажатий.
      //
      // Отвечаем 200, а не 500, даже на собственную поломку: обновление
      // уже отмечено в базе как принятое, повтор его всё равно отсеет,
      // а 500 заставил бы Telegram долбиться в него вечно.
      obrabotchik(req, res).catch((e) => {
        zhurnal.oshibka('вебхук: обработка не удалась, но ответ Telegram отдан:', e);
        if (!res.headersSent) res.writeHead(200, { 'content-type': 'text/plain' });
        if (!res.writableEnded) res.end();
      });
      return;
    }
    if (adres === KOREN_PANELI || adres.startsWith(`${KOREN_PANELI}/`)) {
      // Панель не имеет права уронить бота: любой отказ внутри
      // отвечает страницей, а не оставляет запрос висеть.
      panel(req, res).catch((e) => {
        zhurnal.oshibka('панель: запрос не обработан:', e);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        if (!res.writableEnded) res.end('панель не смогла ответить');
      });
      return;
    }
    /**
     * Проверка промокода для САЙТА.
     *
     * Сайт статический и базы не видит, а показать в чеке «исходная
     * цена — скидка — итого» можно только зная, что код существует,
     * не истёк и не разобран. Запечь список кодов в сборку нельзя
     * дважды: остаток активаций и досрочное отключение — живые
     * сведения, и статическая копия врала бы ровно в тот момент,
     * когда код кончился; да и весь список кодов лежал бы на виду.
     *
     * ОТВЕТ ПРЕДВАРИТЕЛЬНЫЙ, И ЭТО СКАЗАНО ПРЯМО. Настоящее решение
     * принимается один раз — при создании заказа в боте, и принимает
     * его база. Между «сайт спросил» и «человек оформил» проходит
     * время, за которое последнюю активацию может забрать другой.
     *
     * Отдаётся РОВНО ОДИН БИТ И ПРОЦЕНТ: годится или нет и на сколько
     * скидка. Ни срока, ни остатка активаций, ни имени — перебором
     * по этому ответу можно узнать только то, что и так узнаётся
     * вводом кода в поле. От самого перебора стоит предел частоты
     * в nginx, тот же приём, что у входа в панель.
     */
    if (adres === '/api/promo') {
      const zagolovki = {
        'content-type': 'application/json; charset=utf-8',
        // Ответ живой: остаток активаций меняется, и кешировать его
        // нельзя ни браузеру, ни промежуточному узлу.
        'cache-control': 'no-store, no-cache, must-revalidate',
        'x-content-type-options': 'nosniff',
      };
      if (req.method !== 'GET') {
        res.writeHead(405, zagolovki).end(JSON.stringify({ godit: false, pochemu: 'net' }));
        return;
      }
      const kod = new URL(req.url ?? '/', 'http://bot').searchParams.get('kod') ?? '';
      let otvet: Record<string, unknown>;
      try {
        const itog = promokody.proverit(l.db, kod);
        otvet = itog.godit
          ? { godit: true, kod: itog.kod, skidkaProc: itog.skidkaProc }
          : { godit: false, pochemu: itog.pochemu, soobshchenie: otkazSlovami(itog.pochemu) };
      } catch (e) {
        // Поломка базы — это не «кода нет»: соврать человеку, что его
        // код не существует, хуже, чем признаться, что не проверили.
        zhurnal.oshibka('проверка промокода не удалась:', e);
        res.writeHead(503, zagolovki).end(JSON.stringify({ godit: false, pochemu: 'ne_proverili' }));
        return;
      }
      res.writeHead(200, zagolovki).end(JSON.stringify(otvet));
      return;
    }
    /**
     * РОБОКАССА: уведомление и возврат человека.
     *
     * Три пути, и роли у них РАЗНЫЕ — путать их нельзя.
     *
     * `/robokassa/result` — сервер Робокассы говорит серверу лавки,
     * что деньги получены. ТОЛЬКО ЭТОТ ПУТЬ МЕНЯЕТ СОСТОЯНИЕ ЗАКАЗА.
     * Подпись проверяется паролем № 2, который в браузер не уезжает
     * никогда.
     *
     * `/robokassa/uspeh` и `/robokassa/neudacha` — сюда возвращается
     * ЧЕЛОВЕК из браузера. Здесь не меняется ничего: страницу можно
     * открыть руками, а подпись на ней считается паролем № 1, который
     * человек уже видел в составе ссылки на оплату. Заказ на этих
     * страницах не оплачивается — он оплачивается уведомлением,
     * и только им.
     *
     * Метод — и GET, и POST: в кабинете Робокассы он выбирается
     * галочкой, и принимать надо оба, иначе «у нас всё настроено,
     * а не работает» превращается в вечер поисков.
     */
    if (adres.startsWith('/robokassa/')) {
      void robokassa(l, adres, req, res).catch((e) => {
        zhurnal.oshibka('робокасса: запрос не обработан:', e);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        if (!res.writableEnded) res.end('ошибка');
      });
      return;
    }
    // Всё остальное — не наше. Ни намёка на то, что здесь бот.
    res.writeHead(404).end();
  });

  return { server, put };
}

/**
 * Сколько байт тела принимаем от Робокассы.
 *
 * Уведомление — это десяток коротких полей. Мегабайт здесь не бывает,
 * а копить в память чужой запрос без предела нельзя ни при каких
 * обстоятельствах: порт хоть и на петле, но за ним nginx, а за nginx
 * интернет.
 */
const PREDEL_TELA_OPLATY = 64 * 1024;

/** Тело запроса как пары. Пустое — это пустое, а не отказ. */
async function paryIzTela(req: IncomingMessage): Promise<Record<string, string>> {
  const kuski: Buffer[] = [];
  let dlina = 0;
  for await (const k of req) {
    const b = k as Buffer;
    dlina += b.length;
    if (dlina > PREDEL_TELA_OPLATY) throw new Error('слишком большое тело уведомления об оплате');
    kuski.push(b);
  }
  const out: Record<string, string> = {};
  if (kuski.length === 0) return out;
  for (const [k, v] of new URLSearchParams(Buffer.concat(kuski).toString('utf8'))) out[k] = v;
  return out;
}

/**
 * Пары запроса: строка запроса ПЛЮС тело.
 *
 * Робокасса шлёт и так, и так — метод выбирается галочкой в кабинете.
 * Собирать оба источника дешевле, чем однажды выяснять, почему
 * «всё настроено, а уведомления не доходят».
 */
async function paryZaprosa(req: IncomingMessage): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URL(req.url ?? '/', 'http://bot').searchParams) out[k] = v;
  if (req.method === 'POST') {
    for (const [k, v] of Object.entries(await paryIzTela(req))) out[k] = v;
  }
  return out;
}

/**
 * Страница для человека, вернувшегося из оплаты.
 *
 * Своя, а не на сайте, и это решение: сайт — витрина, он ничего
 * не обрабатывает и про платежи не знает. Скриптов на странице нет
 * вовсе — по той же причине, что и в панели.
 */
function stranicaVozvrata(zagolovok: string, text: string, botUrl: string): string {
  const ekr = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${ekr(zagolovok)} — Нейролавка</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #fdfbf9; color: #1a2518;
         font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 24px; }
  main { max-width: 26rem; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 .75rem; color: #365c30; }
  p { margin: 0 0 1.25rem; }
  a { display: inline-block; padding: .7rem 1.25rem; border-radius: .75rem;
      background: #365c30; color: #fdfbf9; text-decoration: none; font-weight: 600; }
  @media (prefers-color-scheme: dark) {
    body { background: #0c2223; color: #e8e2da; }
    h1 { color: #92af8d; }
    a { background: #92af8d; color: #0c2223; }
  }
</style></head>
<body><main>
<h1>${ekr(zagolovok)}</h1>
<p>${ekr(text)}</p>
<a href="${ekr(botUrl)}">Вернуться в бот</a>
</main></body></html>`;
}

/** Обработка трёх путей Робокассы. */
async function robokassa(
  l: Lavka,
  adres: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const botUrl = 'https://t.me/neirolavka_ai_bot';
  const html = (kod: number, zagolovok: string, text: string) => {
    res.writeHead(kod, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    });
    res.end(stranicaVozvrata(zagolovok, text, botUrl));
  };

  if (adres === '/robokassa/result') {
    const pary = await paryZaprosa(req);
    const itog = await prinyatUvedomlenie(l, pary);
    zhurnal.info(`робокасса: уведомление — ${itog.chto}`);
    res.writeHead(itog.kod, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(itog.otvet);
    return;
  }

  if (adres === '/robokassa/uspeh') {
    /* НИЧЕГО НЕ МЕНЯЕМ. Эту страницу открывает браузер человека,
       и подпись на ней считается паролем № 1 — тем, который человек
       уже видел в ссылке на оплату. Верить ей как доказательству
       оплаты нельзя; заказ засчитывает уведомление на /result. */
    const pary = await paryZaprosa(req);
    const ok = l.n.robokassa.login ? proveritVozvrat(l.n.robokassa, pary) : null;
    if (!ok) {
      html(
        200,
        'Проверьте заказ в боте',
        'Мы не смогли подтвердить возврат с платёжной страницы. ' +
          'Откройте «Мои заказы» — там видно, оплачен ли заказ.',
      );
      return;
    }
    html(
      200,
      'Оплата принята',
      'Спасибо. Деньги получены, заказ уже у помощника — доступ придёт в бот. ' +
        'Если бот ещё молчит, дайте ему минуту.',
    );
    return;
  }

  if (adres === '/robokassa/neudacha') {
    /* Отказ или закрытое окно. Заказ НИКУДА НЕ ДЕЛСЯ: он ждёт оплаты,
       и кнопка «Оплатить» в боте по-прежнему работает. Сказать об этом
       здесь важнее, чем извиниться. */
    html(
      200,
      'Оплата не прошла',
      'Ничего не списано. Заказ на месте — откройте его в боте и нажмите «Оплатить» ещё раз.',
    );
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('нет такого');
}
