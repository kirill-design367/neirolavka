/**
 * Подставной Telegram для проверок.
 *
 * Настоящий бот ходит в api.telegram.org. Чтобы проверять поведение
 * при ОТКАЗАХ этого сервера — «chat not found», зависший запрос,
 * сетевая ошибка, — нужен свой, которым можно управлять.
 *
 * grammY умеет ходить не на официальный адрес: `client.apiRoot`.
 * Поэтому проверка поднимает и подставной Telegram, и настоящий
 * вебхук-сервер бота, и стучится в него так же, как это делает
 * Telegram, — POST с телом обновления.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Vyzov = { metod: string; telo: Record<string, unknown> };

export type Otvet =
  | { vid: 'ok'; rezultat?: unknown }
  | { vid: 'oshibka'; kod: number; opisanie: string }
  | { vid: 'zavisnet' };

export type PodstavnoyTelegram = {
  adres: string;
  vyzovy: Vyzov[];
  /** Что отвечать на метод. По умолчанию — ok. */
  otvechat: (metod: string, telo: Record<string, unknown>) => Otvet;
  stop: () => Promise<void>;
};

export async function podnyat(): Promise<PodstavnoyTelegram> {
  const vyzovy: Vyzov[] = [];
  const podstavnoy: PodstavnoyTelegram = {
    adres: '',
    vyzovy,
    otvechat: () => ({ vid: 'ok' }),
    stop: async () => {},
  };

  const server: Server = createServer((req, res) => {
    const kuski: Buffer[] = [];
    req.on('data', (k: Buffer) => kuski.push(k));
    req.on('end', () => {
      const metod = (req.url ?? '').split('/').pop() ?? '';
      let telo: Record<string, unknown> = {};
      try {
        telo = JSON.parse(Buffer.concat(kuski).toString('utf8') || '{}');
      } catch {
        telo = {};
      }
      vyzovy.push({ metod, telo });

      if (metod === 'getMe') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            result: { id: 1, is_bot: true, first_name: 'Проба', username: 'proba_bot' },
          }),
        );
        return;
      }

      const otvet = podstavnoy.otvechat(metod, telo);
      if (otvet.vid === 'zavisnet') {
        // Ничего не отвечаем вовсе: так ведёт себя сервер, до которого
        // дошёл запрос и не вернулся ответ.
        return;
      }
      if (otvet.vid === 'oshibka') {
        res.writeHead(otvet.kod, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ ok: false, error_code: otvet.kod, description: otvet.opisanie }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: otvet.rezultat ?? true }));
    });
  });

  await new Promise<void>((gotovo) => server.listen(0, '127.0.0.1', gotovo));
  const port = (server.address() as AddressInfo).port;
  podstavnoy.adres = `http://127.0.0.1:${port}`;
  podstavnoy.stop = () =>
    new Promise<void>((gotovo) => {
      server.closeAllConnections?.();
      server.close(() => gotovo());
    });
  return podstavnoy;
}

/** POST обновления так же, как это делает Telegram. */
export async function poslat(
  adres: string,
  sekret: string,
  obnovlenie: unknown,
): Promise<{ kod: number; ms: number }> {
  const nachalo = Date.now();
  const otvet = await fetch(adres, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': sekret,
    },
    body: JSON.stringify(obnovlenie),
  });
  await otvet.text();
  return { kod: otvet.status, ms: Date.now() - nachalo };
}
