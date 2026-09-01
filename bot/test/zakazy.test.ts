import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { otkrytBazu } from '../src/db/index.js';
import * as zakazy from '../src/db/zakazy.js';
import * as lyudi from '../src/db/lyudi.js';
import * as dostupy from '../src/db/dostupy.js';
import * as komanda from '../src/db/komanda.js';
import * as dialogi from '../src/db/dialogi.js';

const KLYUCH = randomBytes(32);

function baza() {
  const db = otkrytBazu(':memory:');
  lyudi.zapomnit(db, 42, 'Проба', 'proba');
  return db;
}

const OBRAZEC = {
  tgId: 42,
  produktId: 'claude',
  planId: 'claude-pro-1m',
  nazvanie: 'Claude Pro, 1 месяц',
  cenaKop: 199000,
  mesyacev: 1,
};

test('заказ создаётся и находится по номеру', () => {
  const db = baza();
  const { zakaz, novy } = zakazy.sozdatIliVernut(db, OBRAZEC);
  assert.equal(novy, true);
  assert.equal(zakaz.status, 'zhdet_oplaty');
  assert.equal(zakazy.po(db, zakaz.id)?.nazvanie, OBRAZEC.nazvanie);
});

test('повторное нажатие кнопки не создаёт второго заказа', () => {
  const db = baza();
  const a = zakazy.sozdatIliVernut(db, OBRAZEC);
  const b = zakazy.sozdatIliVernut(db, OBRAZEC);
  assert.equal(b.novy, false);
  assert.equal(b.zakaz.id, a.zakaz.id);
  assert.equal(zakazy.cheloveka(db, 42).length, 1);
});

test('после выдачи такой же тариф можно купить снова', () => {
  const db = baza();
  const a = zakazy.sozdatIliVernut(db, OBRAZEC);
  zakazy.otmetitOplachennym(db, a.zakaz.id, new Date(), 1);
  zakazy.otmetitVydannym(db, a.zakaz.id, new Date('2026-10-01'), 1);
  const b = zakazy.sozdatIliVernut(db, OBRAZEC);
  assert.equal(b.novy, true);
  assert.notEqual(b.zakaz.id, a.zakaz.id);
});

test('запрет на второй открытый заказ держит сама база, а не код', () => {
  const db = baza();
  const a = zakazy.sozdatIliVernut(db, OBRAZEC);
  assert.throws(() =>
    db
      .prepare(
        `INSERT INTO zakazy (tg_id, produkt_id, plan_id, nazvanie, cena_kop, mesyacev, status, sozdan)
         VALUES (?, ?, ?, ?, ?, ?, 'zhdet_oplaty', ?)`,
      )
      .run(42, 'claude', 'claude-pro-1m', 'x', 1, 1, new Date().toISOString()),
  );
  assert.equal(zakazy.cheloveka(db, 42).length, 1);
  assert.ok(a.zakaz.id);
});

test('оплата подтверждается ровно один раз', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  assert.equal(zakazy.otmetitOplachennym(db, zakaz.id, new Date(), 1), true);
  // Повторное уведомление от платёжной системы не должно поднимать
  // вторую волну сообщений.
  assert.equal(zakazy.otmetitOplachennym(db, zakaz.id, new Date(), 1), false);
  assert.equal(zakazy.po(db, zakaz.id)?.status, 'oplachen');
});

test('двое не могут взять один заказ', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  zakazy.otmetitOplachennym(db, zakaz.id, new Date(), 1);
  assert.equal(zakazy.vzyat(db, zakaz.id, 1), true);
  assert.equal(zakazy.vzyat(db, zakaz.id, 2), false);
  assert.equal(zakazy.po(db, zakaz.id)?.ispolnitel, 1);
});

test('выданный заказ отменить нельзя', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  zakazy.otmetitOplachennym(db, zakaz.id, new Date(), 1);
  zakazy.otmetitVydannym(db, zakaz.id, new Date('2026-10-01'), 1);
  assert.equal(zakazy.otmenit(db, zakaz.id, 1, 'проба'), false);
});

test('очередь на выдачу — только оплаченные и взятые', () => {
  const db = baza();
  lyudi.zapomnit(db, 43, 'Второй', null);
  const a = zakazy.sozdatIliVernut(db, OBRAZEC);
  const b = zakazy.sozdatIliVernut(db, { ...OBRAZEC, tgId: 43 });
  zakazy.otmetitOplachennym(db, b.zakaz.id, new Date(), 1);
  const och = zakazy.ochered(db);
  assert.deepEqual(
    och.map((z) => z.id),
    [b.zakaz.id],
  );
  assert.deepEqual(
    zakazy.neoplachennye(db).map((z) => z.id),
    [a.zakaz.id],
  );
});

test('просроченным считается тот, у кого срок прошёл', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  const srok = new Date('2026-09-01T10:00:00Z');
  zakazy.otmetitOplachennym(db, zakaz.id, srok, 1);
  assert.equal(zakazy.prosrochennye(db, new Date('2026-09-01T09:00:00Z'), 10, 5).length, 0);
  assert.equal(zakazy.prosrochennye(db, new Date('2026-09-01T11:00:00Z'), 10, 5).length, 1);
});

test('напоминание не повторяется чаще паузы и умолкает после предела', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  zakazy.otmetitOplachennym(db, zakaz.id, new Date('2026-09-01T10:00:00Z'), 1);
  const pozdno = new Date('2026-09-01T11:00:00Z');
  zakazy.otmetitNapominanie(db, zakaz.id, new Date('2026-09-01T10:55:00Z'));
  // Только что напомнили — второй раз в ту же минуту не напоминаем.
  assert.equal(zakazy.prosrochennye(db, pozdno, 10, 5).length, 0);
  // Предел напоминаний исчерпан — молчим совсем.
  for (let i = 0; i < 5; i += 1) zakazy.otmetitNapominanie(db, zakaz.id, new Date('2026-09-01T10:55:00Z'));
  assert.equal(zakazy.prosrochennye(db, new Date('2026-09-02T00:00:00Z'), 10, 5).length, 0);
});

test('доступ ложится в базу только шифротекстом', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  dostupy.polozhit(db, zakaz.id, { login: 'pochta@primer.ru', parol: 'ochen-sekretno' }, 1, KLYUCH);
  const syroe = db.prepare('SELECT login_sh, parol_sh FROM dostupy WHERE zakaz_id = ?').get(zakaz.id) as {
    login_sh: string;
    parol_sh: string;
  };
  assert.equal(syroe.parol_sh.includes('ochen-sekretno'), false);
  assert.equal(syroe.login_sh.includes('pochta@primer.ru'), false);
  const d = dostupy.vzyat(db, zakaz.id, KLYUCH);
  assert.equal(d?.parol, 'ochen-sekretno');
});

test('доступ переписывается, а не задваивается', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  dostupy.polozhit(db, zakaz.id, { login: 'a', parol: '1' }, 1, KLYUCH);
  dostupy.polozhit(db, zakaz.id, { login: 'b', parol: '2' }, 1, KLYUCH);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM dostupy').get() as { n: number }).n, 1);
  assert.equal(dostupy.vzyat(db, zakaz.id, KLYUCH)?.login, 'b');
});

test('черновик разговора тоже шифруется', () => {
  const db = baza();
  dialogi.postavit(db, 1, 'zhdem_parol', 7, { login: 'pochta@primer.ru' }, KLYUCH);
  const syroe = db.prepare('SELECT chernovik FROM dialogi WHERE tg_id = 1').get() as { chernovik: string };
  assert.equal(syroe.chernovik.includes('pochta@primer.ru'), false);
  assert.equal(dialogi.vzyat(db, 1, KLYUCH)?.chernovik['login'], 'pochta@primer.ru');
});

test('события заказа записываются по порядку', () => {
  const db = baza();
  const { zakaz } = zakazy.sozdatIliVernut(db, OBRAZEC);
  zakazy.otmetitOplachennym(db, zakaz.id, new Date(), 1);
  zakazy.vzyat(db, zakaz.id, 1);
  assert.deepEqual(
    zakazy.sobytiya(db, zakaz.id).map((s) => s.chto),
    ['заказ создан', 'оплата подтверждена', 'взят в работу'],
  );
});

test('статистика считает только выданные заказы', () => {
  const db = baza();
  lyudi.zapomnit(db, 43, 'Второй', null);
  const a = zakazy.sozdatIliVernut(db, OBRAZEC);
  zakazy.otmetitOplachennym(db, a.zakaz.id, new Date(), 1);
  zakazy.otmetitVydannym(db, a.zakaz.id, new Date('2026-10-01'), 1);
  zakazy.sozdatIliVernut(db, { ...OBRAZEC, tgId: 43 });
  const s = zakazy.statistika(db);
  assert.equal(s.vsego, 2);
  assert.equal(s.vyruchkaKop, 199000);
  assert.equal(s.poStatusam['vydan'], 1);
});

test('роли: владелец видит всё, помощник — своё, чужой — ничего', () => {
  const db = baza();
  komanda.zaseyat(db, [1369202079], [777]);
  assert.equal(komanda.rol(db, 1369202079), 'vladelec');
  assert.equal(komanda.rol(db, 777), 'pomoshnik');
  assert.equal(komanda.rol(db, 42), null);
  assert.equal(komanda.svoy(db, 777), true);
  assert.equal(komanda.vladelec(db, 777), false);
});

test('владелец, попавший в оба списка, остаётся владельцем', () => {
  const db = baza();
  komanda.zaseyat(db, [1], [1]);
  assert.equal(komanda.rol(db, 1), 'vladelec');
});

test('засев повторяется без последствий', () => {
  const db = baza();
  komanda.zaseyat(db, [1], [2]);
  komanda.zaseyat(db, [1], [2]);
  assert.equal(komanda.vsya(db).length, 2);
});

test('последнего владельца убрать нельзя', () => {
  const db = baza();
  komanda.zaseyat(db, [1], [2]);
  assert.equal(komanda.ubrat(db, 1).ok, false);
  assert.equal(komanda.ubrat(db, 2).ok, true);
});

test('уведомления уходят всей команде', () => {
  const db = baza();
  komanda.zaseyat(db, [1], [2, 3]);
  assert.deepEqual(komanda.komuSoobshchat(db).sort(), [1, 2, 3]);
});

test('миграции применяются один раз', () => {
  const db = otkrytBazu(':memory:');
  const bylo = (db.prepare('SELECT COUNT(*) n FROM migracii').get() as { n: number }).n;
  assert.equal(bylo > 0, true);
});
