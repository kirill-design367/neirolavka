/**
 * Подставное хранилище кода: тот же разговор, что с GitHub, но на петле.
 *
 * Нужно затем, чтобы проверки гоняли БОЕВОЙ `hranilishche.ts`, а не
 * копию его логики: адрес API — обычная настройка, и подменяется
 * ровно она.
 */

import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Progon = { path: string; status: string; conclusion: string | null };

export type PodstavnoeHranilishche = {
  adres: string;
  /** Содержимое файла, которое отдаём и в которое пишем. */
  fayl: string;
  metkaFayla: string;
  /** Что отвечать на прогоны сборки. */
  progony: Progon[];
  /** Коды, которыми отвечать вместо обычного: для проверки отказов. */
  otvechat: { chtenie?: number; zapis?: number };
  /** Что записали: по нему видно, что ушло в хранилище. */
  zapisi: { text: string; metka: string; opisanie: string }[];
  stop: () => Promise<void>;
};

export async function podnyat(fayl: string): Promise<PodstavnoeHranilishche> {
  const h: PodstavnoeHranilishche = {
    adres: '',
    fayl,
    metkaFayla: 'metka-fayla-1',
    progony: [],
    otvechat: {},
    zapisi: [],
    stop: async () => {},
  };

  const server: Server = createServer((req, res) => {
    const adres = req.url ?? '';
    const otvetit = (kod: number, telo: unknown) => {
      res.writeHead(kod, { 'content-type': 'application/json' });
      res.end(JSON.stringify(telo));
    };

    if (adres.includes('/actions/runs')) {
      return otvetit(200, { workflow_runs: h.progony });
    }
    if (req.method === 'GET' && adres.includes('/contents/')) {
      if (h.otvechat.chtenie) return otvetit(h.otvechat.chtenie, { message: 'нет' });
      return otvetit(200, { content: Buffer.from(h.fayl, 'utf8').toString('base64'), sha: h.metkaFayla });
    }
    if (req.method === 'PUT' && adres.includes('/contents/')) {
      if (h.otvechat.zapis) return otvetit(h.otvechat.zapis, { message: 'нет' });
      const kuski: Buffer[] = [];
      req.on('data', (k) => kuski.push(k as Buffer));
      req.on('end', () => {
        const telo = JSON.parse(Buffer.concat(kuski).toString('utf8')) as Record<string, string>;
        h.fayl = Buffer.from(telo['content'] ?? '', 'base64').toString('utf8');
        h.metkaFayla = `metka-fayla-${h.zapisi.length + 2}`;
        h.zapisi.push({ text: h.fayl, metka: telo['sha'] ?? '', opisanie: telo['message'] ?? '' });
        otvetit(200, { commit: { sha: `metka-izmeneniya-${h.zapisi.length}` } });
      });
      return;
    }
    otvetit(404, { message: 'нет такого' });
  });

  await new Promise<void>((gotovo) => server.listen(0, '127.0.0.1', gotovo));
  h.adres = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  h.stop = () =>
    new Promise<void>((gotovo) => {
      server.closeAllConnections?.();
      server.close(() => gotovo());
    });
  return h;
}
