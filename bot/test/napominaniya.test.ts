import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { otkrytBazu } from '../src/db/index.js';
import * as zakazy from '../src/db/zakazy.js';
import * as lyudi from '../src/db/lyudi.js';
import * as komanda from '../src/db/komanda.js';
import { prochitat } from '../src/config.js';
import { proverit } from '../src/jobs/napominaniya.js';
import type { Lavka } from '../src/lavka.js';
import { zaglushka } from '../src/oplata/zaglushka.js';

const OKRUZHENIE = {
  NEIROLAVKA_TOKEN_BOTA: '123456:proba',
  NEIROLAVKA_SEKRET_VEBHUKA: 'sekret-dlinnyy-dostatochno',
  NEIROLAVKA_KLYUCH_DOSTUPOV: randomBytes(32).toString('base64'),
  NEIROLAVKA_VLADELCY: '1',
  NEIROLAVKA_POMOSHNIKI: '2',
};

/** Подставной Telegram: собирает всё, что бот пытается отправить. */
function lavka(): { l: Lavka; ushlo: { komu: number; text: string }[] } {
  const db = otkrytBazu(':memory:');
  const n = prochitat({ ...OKRUZHENIE });
  komanda.zaseyat(db, n.vladelcy, n.pomoshniki);
  lyudi.zapomnit(db, 42, 'Покупатель', 'pokupatel');
  const ushlo: { komu: number; text: string }[] = [];
  const bot = {
    api: {
      sendMessage: async (komu: number, text: string) => {
        ushlo.push({ komu, text });
      },
    },
  } as unknown as Lavka['bot'];
  return { l: { db, n, bot, oplata: zaglushka }, ushlo };
}

const OBRAZEC = {
  tgId: 42,
  produktId: 'claude',
  planId: 'claude-pro-1m',
  nazvanie: 'Claude Pro, 1 месяц',
  cenaKop: 199000,
  mesyacev: 1,
};

test('пока срок не вышел, никто никого не будит', async () => {
  const { l, ushlo } = lavka();
  const { zakaz } = zakazy.sozdatIliVernut(l.db, OBRAZEC);
  zakazy.otmetitOplachennym(l.db, zakaz.id, new Date('2026-09-01T10:00:00Z'), 1);
  assert.equal(await proverit(l, new Date('2026-09-01T09:30:00Z')), 0);
  assert.equal(ushlo.length, 0);
});

test('просроченный заказ будит ВСЮ команду, а не только владельца', async () => {
  const { l, ushlo } = lavka();
  const { zakaz } = zakazy.sozdatIliVernut(l.db, OBRAZEC);
  zakazy.otmetitOplachennym(l.db, zakaz.id, new Date('2026-09-01T10:00:00Z'), 1);
  assert.equal(await proverit(l, new Date('2026-09-01T10:30:00Z')), 1);
  assert.deepEqual(ushlo.map((u) => u.komu).sort(), [1, 2]);
  assert.equal(ushlo[0]?.text.includes('просрочен'), true);
  assert.equal(ushlo[0]?.text.includes(`№ ${zakaz.id}`), true);
});

test('второй раз подряд не повторяется: пауза считается по базе', async () => {
  const { l, ushlo } = lavka();
  const { zakaz } = zakazy.sozdatIliVernut(l.db, OBRAZEC);
  zakazy.otmetitOplachennym(l.db, zakaz.id, new Date('2026-09-01T10:00:00Z'), 1);
  await proverit(l, new Date('2026-09-01T10:30:00Z'));
  const bylo = ushlo.length;
  await proverit(l, new Date('2026-09-01T10:31:00Z'));
  assert.equal(ushlo.length, bylo);
  // А через паузу — повторяется.
  await proverit(l, new Date('2026-09-01T10:45:00Z'));
  assert.equal(ushlo.length > bylo, true);
});

test('напоминания умолкают после предела, а не идут вечно', async () => {
  const { l, ushlo } = lavka();
  const { zakaz } = zakazy.sozdatIliVernut(l.db, OBRAZEC);
  zakazy.otmetitOplachennym(l.db, zakaz.id, new Date('2026-09-01T10:00:00Z'), 1);
  for (let i = 1; i <= 10; i += 1) {
    await proverit(l, new Date(Date.UTC(2026, 8, 1, 10, 30 + i * 30)));
  }
  // Пять раз на двоих — десять сообщений, и ни одним больше.
  assert.equal(ushlo.length, l.n.napominatRaz * 2);
});

test('выданный заказ из просроченных выпадает', async () => {
  const { l, ushlo } = lavka();
  const { zakaz } = zakazy.sozdatIliVernut(l.db, OBRAZEC);
  zakazy.otmetitOplachennym(l.db, zakaz.id, new Date('2026-09-01T10:00:00Z'), 1);
  zakazy.otmetitVydannym(l.db, zakaz.id, new Date('2026-10-01'), 1);
  assert.equal(await proverit(l, new Date('2026-09-01T12:00:00Z')), 0);
  assert.equal(ushlo.length, 0);
});
