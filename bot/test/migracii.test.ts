/**
 * Миграции на ЖИВОЙ базе, а не на пустой.
 *
 * Опасность здесь одна и она молчаливая: вторая миграция пересобирает
 * таблицу заказов (у SQLite нельзя изменить объявленный CHECK), а
 * у заказов есть дети с ON DELETE CASCADE — события, доступы, платежи.
 * Пересборка при включённых внешних ключах унесла бы их каскадом,
 * и заметить это можно было бы только по пустой истории через месяц.
 *
 * Поэтому проба делает то же, что случится на боевом сервере: строит
 * базу ПЕРВОЙ миграции, кладёт в неё заказ с историей, доступом
 * и платежом — и применяет остальные.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MIGRACII } from '../src/db/shema.js';
import { primenitMigracii } from '../src/db/index.js';

function bazaPervoyMigracii() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS migracii (imya TEXT PRIMARY KEY, kogda TEXT NOT NULL)');
  db.exec(MIGRACII[0]!.sql);
  db.prepare('INSERT INTO migracii (imya, kogda) VALUES (?, ?)').run(
    MIGRACII[0]!.imya,
    new Date().toISOString(),
  );
  return db;
}

test('пересборка заказов не теряет ни заказы, ни их историю', () => {
  const db = bazaPervoyMigracii();
  const seychas = new Date().toISOString();

  db.prepare('INSERT INTO lyudi (tg_id, imya, username, vpervye, poslednee) VALUES (?, ?, ?, ?, ?)').run(
    42,
    'Покупатель',
    null,
    seychas,
    seychas,
  );
  db.prepare(
    `INSERT INTO zakazy (tg_id, produkt_id, plan_id, nazvanie, cena_kop, mesyacev, status, sozdan, oplachen)
     VALUES (42, 'kling', 'kling-pro', 'Kling AI, Pro', 199000, 0, 'oplachen', ?, ?)`,
  ).run(seychas, seychas);
  db.prepare(
    `INSERT INTO zakazy (tg_id, produkt_id, plan_id, nazvanie, cena_kop, mesyacev, status, sozdan)
     VALUES (42, 'suno', 'suno-pro', 'Suno AI, Pro', 0, 0, 'zhdet_oplaty', ?)`,
  ).run(seychas);
  db.prepare('INSERT INTO sobytiya (zakaz_id, kogda, kto, chto) VALUES (1, ?, 42, ?)').run(seychas, 'заказ создан');
  db.prepare(
    'INSERT INTO dostupy (zakaz_id, login_sh, parol_sh, zametka_sh, kto, kogda) VALUES (1, ?, ?, NULL, 1, ?)',
  ).run('v1.a.b.c', 'v1.d.e.f', seychas);
  db.prepare(
    `INSERT INTO platezhi (zakaz_id, postavshchik, vneshny_id, summa_kop, valyuta, status, sozdan)
     VALUES (1, 'proba', 'x1', 199000, 'RUB', 'sozdan', ?)`,
  ).run(seychas);

  primenitMigracii(db);

  const zakazov = (db.prepare('SELECT COUNT(*) n FROM zakazy').get() as { n: number }).n;
  const sobytiy = (db.prepare('SELECT COUNT(*) n FROM sobytiya').get() as { n: number }).n;
  const dostupov = (db.prepare('SELECT COUNT(*) n FROM dostupy').get() as { n: number }).n;
  const platezhey = (db.prepare('SELECT COUNT(*) n FROM platezhi').get() as { n: number }).n;
  assert.equal(zakazov, 2, 'заказы на месте');
  assert.equal(sobytiy, 1, 'история заказа не унесена каскадом');
  assert.equal(dostupov, 1, 'доступ не унесён каскадом');
  assert.equal(platezhey, 1, 'платёж не унесён каскадом');

  // Ссылки не разъехались: внешние ключи гасились только на время
  // пересборки, и проверка целостности идёт до фиксации.
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal((db.pragma('foreign_keys', { simple: true }) as number), 1, 'ключи включены обратно');

  // Новые поля у старых заказов заполнены осмысленно, а не как придётся.
  const oplachen = db.prepare('SELECT * FROM zakazy WHERE id = 1').get() as {
    vid_akkaunta: string;
    oplacheno_kop: number;
    status: string;
  };
  assert.equal(oplachen.vid_akkaunta, 'novy', 'прежние заказы — на новый аккаунт');
  assert.equal(oplachen.oplacheno_kop, 199000, 'оплаченный заказ держит свои деньги');
  const zhdet = db.prepare('SELECT oplacheno_kop FROM zakazy WHERE id = 2').get() as { oplacheno_kop: number };
  assert.equal(zhdet.oplacheno_kop, 0, 'неоплаченный не держит ничего');

  // И новые статусы теперь проходят проверку CHECK — ради этого всё
  // и затевалось.
  db.prepare("UPDATE zakazy SET status = 'zhdem_kod' WHERE id = 1").run();
  assert.equal((db.prepare('SELECT status FROM zakazy WHERE id = 1').get() as { status: string }).status, 'zhdem_kod');
  assert.throws(() => db.prepare("UPDATE zakazy SET status = 'vydumannyy' WHERE id = 1").run());

  db.close();
});

test('повторное применение миграций ничего не делает', () => {
  const db = bazaPervoyMigracii();
  primenitMigracii(db);
  const bylo = db.prepare('SELECT COUNT(*) n FROM migracii').get() as { n: number };
  primenitMigracii(db);
  const stalo = db.prepare('SELECT COUNT(*) n FROM migracii').get() as { n: number };
  assert.equal(stalo.n, bylo.n);
  assert.equal(stalo.n, MIGRACII.length);
  db.close();
});

/**
 * ПОСЛЕДНЯЯ МИГРАЦИЯ НА БАЗЕ С ДАННЫМИ — ВКЛЮЧАЯ ПРОМОКОДЫ.
 *
 * Проба выше строит базу ПЕРВОЙ миграции, и активации промокода
 * в ней завестись не могут: их таблица появляется только в шестой.
 * А седьмая пересобирает и заказы, И активации — то есть ровно то,
 * что проба выше не видит.
 *
 * Поэтому здесь применяется всё, КРОМЕ последней, кладутся данные,
 * и только потом идёт последняя. Написано через `slice(-1)`, а не
 * по имени: так проба сама собой начнёт стеречь ту миграцию, которую
 * допишут следующей, — а имя, вписанное строкой, устареет молча.
 */
test('последняя миграция не теряет заказы, активации промокода и их связь', () => {
  const db = bazaPervoyMigracii();
  const seychas = new Date().toISOString();
  const krome = MIGRACII.slice(1, -1);
  for (const m of krome) {
    if (m.bezVneshnihKlyuchey) db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    db.exec(m.sql);
    db.prepare('INSERT INTO migracii (imya, kogda) VALUES (?, ?)').run(m.imya, seychas);
    db.exec('COMMIT');
    if (m.bezVneshnihKlyuchey) db.pragma('foreign_keys = ON');
  }

  db.prepare('INSERT INTO lyudi (tg_id, imya, username, vpervye, poslednee) VALUES (?, ?, ?, ?, ?)').run(
    77, 'Покупатель', null, seychas, seychas,
  );
  db.prepare(
    `INSERT INTO zakazy (id, tg_id, produkt_id, plan_id, nazvanie, cena_kop, mesyacev, status,
                         vid_akkaunta, oplacheno_kop, promo_kod, skidka_kop, sozdan)
     VALUES (5, 77, 'kling', 'kling-pro', 'Kling AI, Pro', 139900, 0, 'oplachen', 'svoy', 125910, 'LETO25', 13990, ?)`,
  ).run(seychas);
  db.prepare(
    `INSERT INTO promokody (kod, skidka_proc, do_daty, aktivaciy, otklyuchen, sozdan, kto)
     VALUES ('LETO25', 10, ?, 5, 0, ?, NULL)`,
  ).run(seychas, seychas);
  db.prepare(
    `INSERT INTO promo_aktivacii (kod, mesto, zakaz_id, tg_id, skidka_kop, kogda)
     VALUES ('LETO25', 1, 5, 77, 13990, ?)`,
  ).run(seychas);

  primenitMigracii(db);

  const z = db.prepare('SELECT * FROM zakazy WHERE id = 5').get() as {
    tg_id: number | null;
    istochnik: string;
    klyuch: string | null;
    popytka: string | null;
    vid_akkaunta: string;
    promo_kod: string | null;
    skidka_kop: number;
    oplacheno_kop: number;
  };
  assert.equal(z.tg_id, 77, 'у прежнего заказа отняли хозяина');
  assert.equal(z.istochnik, 'bot', 'прежние заказы пришли из бота, а не с сайта');
  assert.equal(z.klyuch, null, 'у заказа из бота секретного ключа быть не должно');
  assert.equal(z.popytka, null);
  assert.equal(z.vid_akkaunta, 'svoy', 'вид аккаунта перепутали при пересборке');
  assert.equal(z.promo_kod, 'LETO25', 'потеряли промокод заказа');
  assert.equal(z.skidka_kop, 13990, 'потеряли скидку');
  assert.equal(z.oplacheno_kop, 125910, 'потеряли деньги заказа');

  const a = db.prepare('SELECT * FROM promo_aktivacii WHERE zakaz_id = 5').get() as
    | { kod: string; mesto: number; tg_id: number | null; skidka_kop: number }
    | undefined;
  assert.ok(a, 'активация промокода унесена пересборкой');
  assert.equal(a.kod, 'LETO25');
  assert.equal(a.mesto, 1);
  assert.equal(a.tg_id, 77, 'у активации отняли хозяина');

  assert.deepEqual(db.pragma('foreign_key_check'), [], 'ссылки разъехались');
  assert.equal(db.pragma('foreign_keys', { simple: true }) as number, 1, 'ключи не включены обратно');

  // И новое, ради чего пересборка затевалась: ничейный заказ теперь
  // заводится, а место в уникальном индексе на него не жалуется.
  db.prepare(
    `INSERT INTO zakazy (tg_id, istochnik, klyuch, popytka, produkt_id, plan_id, nazvanie,
                         cena_kop, mesyacev, status, vid_akkaunta, sozdan)
     VALUES (NULL, 'sayt', 'k1', 'p1', 'kling', 'kling-pro', 'Kling AI, Pro', 139900, 0,
             'zhdet_oplaty', 'ne_vybran', ?)`,
  ).run(seychas);
  db.prepare(
    `INSERT INTO zakazy (tg_id, istochnik, klyuch, popytka, produkt_id, plan_id, nazvanie,
                         cena_kop, mesyacev, status, vid_akkaunta, sozdan)
     VALUES (NULL, 'sayt', 'k2', 'p2', 'kling', 'kling-pro', 'Kling AI, Pro', 139900, 0,
             'zhdet_oplaty', 'ne_vybran', ?)`,
  ).run(seychas);
  const nichih = db
    .prepare("SELECT COUNT(*) n FROM zakazy WHERE tg_id IS NULL")
    .get() as { n: number };
  assert.equal(nichih.n, 2, 'двое с сайта не смогли купить один уровень');

  // А два одинаковых ключа нажатия — по-прежнему нельзя.
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO zakazy (tg_id, istochnik, klyuch, popytka, produkt_id, plan_id, nazvanie,
                               cena_kop, mesyacev, status, vid_akkaunta, sozdan)
           VALUES (NULL, 'sayt', 'k3', 'p1', 'kling', 'kling-pro', 'Kling AI, Pro', 139900, 0,
                   'zhdet_oplaty', 'ne_vybran', ?)`,
        )
        .run(seychas),
    'повтор нажатия завёл второй заказ',
  );

  db.close();
});
