/**
 * Схема базы и миграции.
 *
 * SQL лежит строками в коде, а не отдельными файлами рядом. Причина
 * приземлённая: бот собирается в dist/, и файлы, не попавшие в сборку,
 * пришлось бы отдельно копировать при выкладке — а забытый шаг выкладки
 * обнаруживается на боевом сервере в момент, когда база не создалась.
 * Строка в коде уезжает вместе с кодом всегда.
 *
 * Миграции применяются по порядку и запоминаются в таблице migracii.
 * Повторный запуск ничего не делает: это то же правило, что у скриптов
 * настройки сервера.
 */

export type Migraciya = { imya: string; sql: string };

export const MIGRACII: Migraciya[] = [
  {
    imya: '001-nachalo',
    sql: `
-- Люди, которые заходили в бота. Ни телефонов, ни почты: телеграм-
-- идентификатор и то, что Telegram сам присылает в каждом сообщении.
CREATE TABLE lyudi (
  tg_id      INTEGER PRIMARY KEY,
  imya       TEXT    NOT NULL DEFAULT '',
  username   TEXT,
  vpervye    TEXT    NOT NULL,
  poslednee  TEXT    NOT NULL
);

-- Кто в лавке работает. Роль решается здесь, а не в коде: помощник
-- добавляется строкой в таблицу, переписывать ничего не нужно.
CREATE TABLE komanda (
  tg_id     INTEGER PRIMARY KEY,
  rol       TEXT    NOT NULL CHECK (rol IN ('vladelec','pomoshnik')),
  imya      TEXT    NOT NULL DEFAULT '',
  dobavlen  TEXT    NOT NULL,
  dobavil   INTEGER
);

-- Заказы. Название и цена записаны СНИМКОМ на момент заказа: прайс
-- поменяется, а человек должен видеть в «моих заказах» то, что купил.
CREATE TABLE zakazy (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id          INTEGER NOT NULL REFERENCES lyudi(tg_id),
  produkt_id     TEXT    NOT NULL,
  plan_id        TEXT    NOT NULL,
  nazvanie       TEXT    NOT NULL,
  cena_kop       INTEGER NOT NULL,
  mesyacev       INTEGER NOT NULL,
  status         TEXT    NOT NULL
                 CHECK (status IN ('zhdet_oplaty','oplachen','v_rabote','vydan','otmenen')),
  sozdan         TEXT    NOT NULL,
  oplachen       TEXT,
  vzyat          TEXT,
  ispolnitel     INTEGER,
  vydan          TEXT,
  srok_do        TEXT,
  dostup_do      TEXT,
  napominany_raz INTEGER NOT NULL DEFAULT 0,
  napominanie_v  TEXT
);

CREATE INDEX zakazy_po_cheloveku ON zakazy(tg_id, id DESC);
CREATE INDEX zakazy_po_statusu   ON zakazy(status, id);

-- Повторное нажатие кнопки не создаёт второго заказа: вставка упрётся
-- в этот индекс, и обработчик вернёт человеку уже существующий заказ.
-- Проверка стоит в БАЗЕ, а не в коде, потому что код переживает гонку
-- двух одновременных нажатий, а уникальный индекс — нет.
--
-- Следствие намеренное: пока прошлый заказ на тот же тариф не выдан
-- и не отменён, второй такой же оформить нельзя. Выданный не мешает —
-- продлевать можно сколько угодно раз.
CREATE UNIQUE INDEX zakazy_odin_otkrytyy
  ON zakazy(tg_id, plan_id)
  WHERE status IN ('zhdet_oplaty','oplachen','v_rabote');

-- Доступы. Только шифротекст: ключ живёт в .env и в базу не попадает.
CREATE TABLE dostupy (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zakaz_id      INTEGER NOT NULL UNIQUE REFERENCES zakazy(id) ON DELETE CASCADE,
  login_sh      TEXT    NOT NULL,
  parol_sh      TEXT    NOT NULL,
  zametka_sh    TEXT,
  kto           INTEGER NOT NULL,
  kogda         TEXT    NOT NULL
);

-- Что происходило с заказом. Нужен, чтобы на вопрос «где мой доступ»
-- отвечать фактами, а не памятью.
CREATE TABLE sobytiya (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  zakaz_id    INTEGER REFERENCES zakazy(id) ON DELETE CASCADE,
  kogda       TEXT    NOT NULL,
  kto         INTEGER,
  chto        TEXT    NOT NULL,
  podrobnosti TEXT
);
CREATE INDEX sobytiya_po_zakazu ON sobytiya(zakaz_id, id);

-- Место под оплату. Таблица заводится СЕЙЧАС, хотя платежей ещё нет:
-- добавлять её потом означало бы мигрировать боевую базу с деньгами.
CREATE TABLE platezhi (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zakaz_id      INTEGER NOT NULL REFERENCES zakazy(id) ON DELETE CASCADE,
  postavshchik  TEXT    NOT NULL,
  vneshny_id    TEXT,
  summa_kop     INTEGER NOT NULL,
  valyuta       TEXT    NOT NULL DEFAULT 'RUB',
  status        TEXT    NOT NULL CHECK (status IN ('sozdan','oplachen','otmenen','vozvrat')),
  sozdan        TEXT    NOT NULL,
  podtverzhden  TEXT
);
-- Уведомление об оплате приходит по нескольку раз; второй раз тот же
-- платёж не заведётся.
CREATE UNIQUE INDEX platezhi_vneshny
  ON platezhi(postavshchik, vneshny_id) WHERE vneshny_id IS NOT NULL;

-- Настройки, которые владелец меняет из бота. Часы работы приходят
-- из окружения, но если владелец поправил их здесь — верх за базой.
CREATE TABLE nastroyki (
  klyuch    TEXT PRIMARY KEY,
  znachenie TEXT NOT NULL,
  izmenen   TEXT NOT NULL,
  kto       INTEGER
);

-- Незаконченные разговоры: администратор вводит логин, потом пароль.
-- Состояние лежит в БАЗЕ, а не в памяти процесса: перезапуск бота
-- посреди ввода не должен терять начатое.
CREATE TABLE dialogi (
  tg_id     INTEGER PRIMARY KEY,
  shag      TEXT    NOT NULL,
  zakaz_id  INTEGER,
  chernovik TEXT,
  izmenen   TEXT    NOT NULL
);

-- Telegram повторяет доставку, пока не получит 200. Повтор не должен
-- оформлять второй заказ, поэтому каждое обновление отмечается здесь.
CREATE TABLE obnovleniya (
  update_id INTEGER PRIMARY KEY,
  kogda     TEXT NOT NULL
);
`,
  },
];
