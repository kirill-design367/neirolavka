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
export type Sostoyanie = { gotov: boolean; shag: string };

export type Sluzhba = {
  server: Server;
  /** Путь, который слушает вебхук (с секретом). */
  put: string;
};

export function sozdatServer(l: Lavka, vypusk: string, sostoyanie: Sostoyanie): Sluzhba {
  const put = putVebhuka(l.n);

  const obrabotchik = webhookCallback(l.bot, 'http', {
    secretToken: l.n.sekretVebhuka,
    // Долгий обработчик не должен доводить Telegram до повтора:
    // отвечаем 200 и доделываем начатое. От двойной работы спасает
    // отсев повторов по update_id.
    onTimeout: 'return',
    timeoutMilliseconds: PREDEL_OBRABOTKI_MS,
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const adres = (req.url ?? '').split('?')[0];
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
    if (adres === '/yookassa') {
      // Место под уведомления об оплате. Пока поставщик — заглушка,
      // и разбирать нечего: отвечаем «принято», чтобы никто не копил
      // очередь повторов, но ничего не делаем.
      zhurnal.vnimanie('пришло уведомление об оплате, а оплата не подключена');
      res.writeHead(200).end('ok');
      return;
    }
    // Всё остальное — не наше. Ни намёка на то, что здесь бот.
    res.writeHead(404).end();
  });

  return { server, put };
}
