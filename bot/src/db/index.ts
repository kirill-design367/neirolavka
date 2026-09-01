/**
 * Открытие базы и миграции.
 *
 * SQLite, а не PostgreSQL. Причины по порядку важности:
 *
 * 1. Сохранность. База — один файл. Резервная копия делается вызовом
 *    VACUUM INTO прямо из процесса: получается согласованный снимок
 *    без остановки бота и без внешних утилит. У PostgreSQL это
 *    pg_dump, роль для него, и ещё одна служба, которая может
 *    не подняться после перезагрузки.
 * 2. Нагрузка. Лавка ручная: между оплатой и доступом стоит человек,
 *    значит поток заказов ограничен скоростью этого человека. Речь
 *    о десятках записей в сутки. Сетевой сервер баз данных здесь
 *    решает задачу, которой нет.
 * 3. Машина. Два ядра и 4 ГБ, и на них уже стоит nginx с сайтом.
 *    PostgreSQL забрал бы память под shared_buffers ради того же
 *    результата.
 *
 * Расплата за выбор известна и принята: один пишущий процесс.
 * Бот — один процесс, второго не предвидится; появится — переезд
 * на PostgreSQL меняет этот файл и запросы, но не устройство.
 *
 * Настройки долговечности выкручены в сторону сохранности:
 * synchronous = FULL означает, что подтверждённая запись пережила
 * выключение питания. Это медленнее, и на нашем потоке заказов
 * разницы не видно.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRACII } from './shema.js';
import { zhurnal } from '../lib/zhurnal.js';

export type Baza = Database.Database;

export function otkrytBazu(put: string): Baza {
  if (put !== ':memory:') mkdirSync(dirname(put), { recursive: true });
  const db = new Database(put);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  // Если вдруг кто-то держит запись — ждём, а не падаем.
  db.pragma('busy_timeout = 5000');
  primenitMigracii(db);
  return db;
}

export function primenitMigracii(db: Baza): void {
  db.exec('CREATE TABLE IF NOT EXISTS migracii (imya TEXT PRIMARY KEY, kogda TEXT NOT NULL)');
  const est = new Set(
    db.prepare('SELECT imya FROM migracii').all().map((r) => (r as { imya: string }).imya),
  );
  for (const m of MIGRACII) {
    if (est.has(m.imya)) continue;
    // Вся миграция и отметка о ней — одной транзакцией: половина
    // применённой миграции хуже, чем неприменённая.
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO migracii (imya, kogda) VALUES (?, ?)').run(m.imya, seychasISO());
    })();
    zhurnal.info(`миграция применена: ${m.imya}`);
  }
}

/** Единый вид времени в базе: ISO 8601 в UTC. */
export function seychasISO(): string {
  return new Date().toISOString();
}

export function vDatu(s: string | null): Date | null {
  return s ? new Date(s) : null;
}
