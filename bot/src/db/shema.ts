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

export type Migraciya = {
  imya: string;
  sql: string;
  /**
   * Гасить ли внешние ключи на время миграции.
   *
   * Нужно ровно для одного дела — ПЕРЕСБОРКИ таблицы. У SQLite нельзя
   * изменить объявленный CHECK, поэтому таблица со списком статусов
   * пересобирается заново: новая, перелив, DROP старой, переименование.
   * А `DROP TABLE` при включённых внешних ключах запускает каскады
   * у детей (`sobytiya`, `dostupy`, `platezhi` объявлены
   * ON DELETE CASCADE) — то есть снёс бы всю историю заказов заодно.
   *
   * Порядок — тот, что описан в документации SQLite: PRAGMA снаружи
   * транзакции, проверка `foreign_key_check` перед фиксацией,
   * возврат PRAGMA обратно.
   */
  bezVneshnihKlyuchey?: boolean;
};

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

  {
    // Кошелёк покупателя, свой аккаунт, коды двухфакторной
    // аутентификации — и новые состояния заказа под них.
    imya: '002-koshelek-i-kody',
    bezVneshnihKlyuchey: true,
    sql: `
-- КОШЕЛЁК — ЭТО ИСТОРИЯ, А НЕ ЧИСЛО.
--
-- Баланс считается суммой движений, а не хранится колонкой. Колонка
-- с числом и таблица истории — два источника правды об одних деньгах,
-- и однажды они разойдутся: любая правка мимо одного из них молча
-- сделает баланс неверным. Сумма по индексу на нашем потоке (десятки
-- записей в сутки на человека) стоит доли миллисекунды.
--
-- Знак ОДИН на все виды: плюс — деньги пришли, минус — ушли. Вид нужен
-- человеку в выписке, а не арифметике.
--
-- ВЫВОДА СРЕДСТВ НЕТ. Отдельного вида движения под него не заведено
-- намеренно: пока его нет в замысле, ему неоткуда взяться и в коде.
CREATE TABLE dvizheniya (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id    INTEGER NOT NULL REFERENCES lyudi(tg_id),
  kop      INTEGER NOT NULL,
  vid      TEXT    NOT NULL CHECK (vid IN ('popolnenie','spisanie','vozvrat')),
  zakaz_id INTEGER REFERENCES zakazy(id) ON DELETE SET NULL,
  za_chto  TEXT    NOT NULL,
  kto      INTEGER,
  kogda    TEXT    NOT NULL
);
CREATE INDEX dvizheniya_po_cheloveku ON dvizheniya(tg_id, id DESC);

-- Аккаунт, который покупатель принёс свой. Логин почты и пароль
-- от нейросети — такие же секреты, как выдаваемые доступы, и лежат
-- так же: только шифротекст, ключ в /etc.
CREATE TABLE svoi_akkaunty (
  zakaz_id  INTEGER PRIMARY KEY REFERENCES zakazy(id) ON DELETE CASCADE,
  pochta_sh TEXT    NOT NULL,
  parol_sh  TEXT    NOT NULL,
  kogda     TEXT    NOT NULL
);

-- Коды двухфакторной аутентификации. Отдельной таблицей, а не полем
-- заказа: код запрашивают по нескольку раз (первый не подошёл, письмо
-- пришло с задержкой), и история попыток — часть разбирательства.
CREATE TABLE kody (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  zakaz_id     INTEGER NOT NULL REFERENCES zakazy(id) ON DELETE CASCADE,
  kod_sh       TEXT,
  zapros_v     TEXT    NOT NULL,
  poluchen_v   TEXT,
  kto_zaprosil INTEGER
);
CREATE INDEX kody_po_zakazu ON kody(zakaz_id, id DESC);

-- ПЕРЕСБОРКА ЗАКАЗОВ. Причина одна: список статусов объявлен через
-- CHECK, а CHECK у SQLite не меняется ничем, кроме пересборки таблицы.
CREATE TABLE zakazy_novye (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id          INTEGER NOT NULL REFERENCES lyudi(tg_id),
  produkt_id     TEXT    NOT NULL,
  plan_id        TEXT    NOT NULL,
  nazvanie       TEXT    NOT NULL,
  cena_kop       INTEGER NOT NULL,
  mesyacev       INTEGER NOT NULL,
  status         TEXT    NOT NULL
                 CHECK (status IN ('zhdet_oplaty','oplachen','v_rabote',
                                   'zhdem_kod','kod_poluchen','vydan','otmenen')),
  -- 'novy' — помощник заводит почту и аккаунт сам;
  -- 'svoy' — покупатель принёс существующий аккаунт.
  vid_akkaunta   TEXT    NOT NULL DEFAULT 'novy' CHECK (vid_akkaunta IN ('novy','svoy')),
  -- Сколько денег заказ СЕЙЧАС держит. Столько и вернётся на баланс
  -- при отмене. Ноль у отменённого — деньги уже возвращены.
  oplacheno_kop  INTEGER NOT NULL DEFAULT 0,
  -- Сколько из этого пришло с баланса: нужно помощнику в карточке,
  -- чтобы понимать, чего ждать «живыми» деньгами.
  s_balansa_kop  INTEGER NOT NULL DEFAULT 0,
  kod_zapros_v   TEXT,
  kod_poluchen_v TEXT,
  -- Когда помощник отметил, что отправил письмо восстановления пароля.
  -- Без этой отметки отмена по причине «неверный пароль» не проходит.
  pismo_v        TEXT,
  prichina_otmeny TEXT,
  sozdan         TEXT    NOT NULL,
  oplachen       TEXT,
  vzyat          TEXT,
  ispolnitel     INTEGER,
  vydan          TEXT,
  otmenen        TEXT,
  srok_do        TEXT,
  dostup_do      TEXT,
  napominany_raz INTEGER NOT NULL DEFAULT 0,
  napominanie_v  TEXT
);

INSERT INTO zakazy_novye (
  id, tg_id, produkt_id, plan_id, nazvanie, cena_kop, mesyacev, status,
  sozdan, oplachen, vzyat, ispolnitel, vydan, srok_do, dostup_do,
  napominany_raz, napominanie_v,
  oplacheno_kop
)
SELECT
  id, tg_id, produkt_id, plan_id, nazvanie, cena_kop, mesyacev, status,
  sozdan, oplachen, vzyat, ispolnitel, vydan, srok_do, dostup_do,
  napominany_raz, napominanie_v,
  -- Прежние оплаченные заказы деньги держат: у них цена и есть то,
  -- что вернётся при отмене.
  CASE WHEN status IN ('oplachen','v_rabote','vydan') THEN cena_kop ELSE 0 END
FROM zakazy;

DROP TABLE zakazy;
ALTER TABLE zakazy_novye RENAME TO zakazy;

CREATE INDEX zakazy_po_cheloveku ON zakazy(tg_id, id DESC);
CREATE INDEX zakazy_po_statusu   ON zakazy(status, id);

-- Тот же уникальный индекс, что был, плюс два новых открытых статуса:
-- пока заказ живой, второй такой же не оформляется.
CREATE UNIQUE INDEX zakazy_odin_otkrytyy
  ON zakazy(tg_id, plan_id)
  WHERE status IN ('zhdet_oplaty','oplachen','v_rabote','zhdem_kod','kod_poluchen');
`,
  },

  {
    // Каталог в базе и учётки админ-панели.
    imya: '003-katalog-i-panel',
    sql: `
-- КАТАЛОГ ПЕРЕЕХАЛ В БАЗУ, и это следствие панели: прайс правит живой
-- человек из браузера, а не выкладка. Файл src/lib/catalog.ts остаётся
-- ЗАСЕВОМ (при пустых таблицах его содержимое кладётся сюда) и остаётся
-- источником для САЙТА: сайт статический и базы не видит. Расхождение
-- между витриной и ботом закрывается выгрузкой из панели.
CREATE TABLE produkty (
  id       TEXT    PRIMARY KEY,
  imya     TEXT    NOT NULL,
  tagline  TEXT    NOT NULL DEFAULT '',
  note     TEXT    NOT NULL DEFAULT '',
  -- Цена продукта БЕЗ уровней. NULL — «цена не объявлена»: то же самое,
  -- что null в каталоге сайта, и печатается словом «уточняется».
  cena_kop INTEGER,
  poryadok INTEGER NOT NULL DEFAULT 0,
  -- Спрятанный продукт не продаётся, но остаётся в базе: на него
  -- ссылаются прежние заказы, и удалять его нельзя.
  skryt    INTEGER NOT NULL DEFAULT 0,
  izmenen  TEXT    NOT NULL
);

CREATE TABLE urovni (
  id         TEXT    PRIMARY KEY,
  produkt_id TEXT    NOT NULL REFERENCES produkty(id) ON DELETE CASCADE,
  short      TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  cena_kop   INTEGER,
  poryadok   INTEGER NOT NULL DEFAULT 0,
  skryt      INTEGER NOT NULL DEFAULT 0,
  izmenen    TEXT    NOT NULL
);
CREATE INDEX urovni_po_produktu ON urovni(produkt_id, poryadok);

-- Вход в панель. Пароль лежит ХЕШЕМ (scrypt), открытого нет нигде:
-- ни в базе, ни в журнале, ни в аргументах команды заведения.
--
-- Роль здесь НЕ хранится: она берётся из komanda по tg_id, чтобы права
-- в панели и в боте не разъехались. Одно место — одна правда.
CREATE TABLE admin_uchetki (
  login          TEXT    PRIMARY KEY,
  parol_hash     TEXT    NOT NULL,
  tg_id          INTEGER NOT NULL REFERENCES komanda(tg_id),
  sozdan         TEXT    NOT NULL,
  poslednii_vhod TEXT
);

-- Сессии. В куке живёт случайный токен, в базе — только его отпечаток:
-- утёкшая база не даёт войти под чужой сессией.
CREATE TABLE admin_sessii (
  token_hash TEXT    PRIMARY KEY,
  login      TEXT    NOT NULL REFERENCES admin_uchetki(login) ON DELETE CASCADE,
  sozdana    TEXT    NOT NULL,
  do         TEXT    NOT NULL,
  -- Отдельный токен против подделки запроса с чужого сайта.
  zashchita  TEXT    NOT NULL
);
CREATE INDEX admin_sessii_po_sroku ON admin_sessii(do);

-- Счётчик неудачных входов. В базе, а не в памяти: перезапуск бота
-- не должен обнулять защиту от перебора.
CREATE TABLE admin_popytki (
  login   TEXT PRIMARY KEY,
  neudach INTEGER NOT NULL DEFAULT 0,
  do      TEXT
);
`,
  },

  {
    imya: '004-vykladka',
    sql: `
-- Выкладки прайса на сайт.
--
-- Сайт статический: цена, поставленная в панели, работает в боте сразу,
-- а на витрине появляется только после сборки. Панель кладёт новый
-- каталог в хранилище кода, выкладка собирает сайт, а здесь лежит
-- состояние этого дела — чтобы человек видел, что происходит,
-- и чтобы вторая выкладка не началась поверх первой.
CREATE TABLE vykladki (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- idet → vylozheno | ne_vyshlo. Ничего больше.
  status     TEXT    NOT NULL CHECK (status IN ('idet','vylozheno','ne_vyshlo')),
  -- Отпечаток того, ЧТО выкладывали: по нему видно, разошлись ли
  -- цены в панели и на сайте.
  otpechatok TEXT    NOT NULL,
  -- Метка изменения в хранилище: по ней ищется сборка.
  metka      TEXT,
  kto        INTEGER,
  nachata    TEXT    NOT NULL,
  proverena  TEXT,
  zavershena TEXT,
  -- Человеческим языком: что случилось. Показывается как есть.
  soobshchenie TEXT
);

-- ОДНА ВЫКЛАДКА ЗА РАЗ, и держит это база, а не проверка в коде.
-- Два нажатия подряд — обычное дело: человек не видит, что первое
-- уже сработало, и жмёт ещё. Код переживает гонку, индекс — нет.
CREATE UNIQUE INDEX vykladka_odna_idet ON vykladki(status) WHERE status = 'idet';
`,
  },
  {
    imya: '005-metki',
    sql: `
-- Откуда пришёл покупатель.
--
-- Метка едет с сайта в параметре start, бот кладёт её человеку
-- ПРИ ПЕРВОМ касании и больше не трогает: вопрос «какой канал привёл»
-- имеет один ответ, а последний клик перезаписал бы его на тот,
-- по которому человек вернулся уже своим.
ALTER TABLE lyudi ADD COLUMN metka TEXT;

-- Ссылки, размеченные в панели.
--
-- Строка здесь НЕ обязательна, чтобы метка считалась: человек,
-- пришедший по чужой ссылке с utm_source, попадёт в статистику
-- своим кодом и без записи в этой таблице. Таблица нужна затем,
-- чтобы у канала было имя и готовые ссылки, а не голый код.
CREATE TABLE metki (
  kod       TEXT PRIMARY KEY,
  nazvanie  TEXT    NOT NULL,
  istochnik TEXT    NOT NULL DEFAULT '',
  kanal     TEXT    NOT NULL DEFAULT '',
  kampaniya TEXT    NOT NULL DEFAULT '',
  sozdana   TEXT    NOT NULL,
  kto       INTEGER
);

-- Считать людей по метке приходится за период, а период режется
-- по vpervye — по первому касанию, тому же самому, что и метка.
CREATE INDEX lyudi_metka ON lyudi(metka);
`,
  },
];
