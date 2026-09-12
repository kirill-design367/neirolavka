/**
 * Заказы.
 *
 * Весь путь заказа лежит в базе: создан → оплачен → взят в работу →
 * выдан. В памяти процесса не держится ничего, поэтому перезапуск
 * бота посреди работы ничего не теряет — а перезапуск случается
 * при каждом обновлении.
 */

import type { Baza } from './index.js';
import { seychasISO } from './index.js';
import * as koshelek from './koshelek.js';
import * as promokody from './promokody.js';
import type { OtkazPromo } from '../lib/promokod.js';

/**
 * Путь заказа.
 *
 *   ждёт оплаты → оплачен → взят в работу ─┬─► выдан
 *                                          └─► ждём код → код получен → выдан
 *
 * Две последние ступени бывают только у заказа со СВОИМ аккаунтом:
 * помощник входит в чужой аккаунт, и на входе спрашивают код. Заказу
 * на новый аккаунт входить некуда, он идёт напрямую.
 *
 * Из любого открытого состояния заказ можно отменить, и тогда деньги
 * возвращаются на баланс покупателя.
 */
/** Откуда заказ. */
export type Istochnik = 'bot' | 'sayt';

export type StatusZakaza =
  | 'zhdet_oplaty'
  | 'oplachen'
  | 'v_rabote'
  | 'zhdem_kod'
  | 'kod_poluchen'
  | 'vydan'
  | 'otmenen';

/** Чей аккаунт: заводим новый или входим в тот, что принёс покупатель. */
/**
 * Какой аккаунт у покупателя.
 *
 * `ne_vybran` бывает только у заказа С САЙТА и только до прихода
 * человека в бот: на сайте про аккаунт не спрашивают вовсе — там
 * выбор и деньги, а всё, что нужно для выдачи, спрашивает бот.
 * Считать такой заказ «новым аккаунтом» по умолчанию нельзя:
 * помощник взял бы в работу заказ, у которого на самом деле чужой
 * аккаунт и впереди ввод пароля.
 */
export type VidAkkaunta = 'novy' | 'svoy' | 'ne_vybran';

/**
 * Почему отменён. Хранится кодом, а не фразой: по причине считается
 * статистика и решается, что показать человеку, а фраза меняется.
 *
 * ДВА СПИСКА, И ЭТО НЕ ДУБЛИРОВАНИЕ. `PrichinaOtmeny` — всё, что
 * может лежать в базе, включая `'ruchnaya'`: в сентябре 2026 владелец
 * убрал её из предлагаемых, но заказы, отменённые раньше, никуда
 * не делись, и читать их надо. `PRICHINY_VYBORA` — то, что можно
 * выбрать СЕЙЧАС; из него `'ruchnaya'` и убрана.
 *
 * Один список на оба вопроса означал бы либо потерю истории, либо
 * возвращение снятой причины в меню при первой же правке.
 */
export type PrichinaOtmeny = 'ruchnaya' | 'net_koda' | 'nevernyy_parol' | 'net_deneg';

export const PRICHINY_VYBORA = ['nevernyy_parol', 'net_koda', 'net_deneg'] as const;
export type PrichinaVybora = (typeof PRICHINY_VYBORA)[number];

/** Разбор причины, пришедшей из формы или из кнопки. Чужое — null. */
export function razobratPrichinu(syroe: string | null | undefined): PrichinaVybora | null {
  return (PRICHINY_VYBORA as readonly string[]).includes(syroe ?? '')
    ? (syroe as PrichinaVybora)
    : null;
}

export type Zakaz = {
  id: number;
  /**
   * Чей заказ. ПУСТО — ничей: оплачен на сайте и ещё не забран
   * в боте. До оплаты на сайте такого состояния не существовало.
   */
  tg_id: number | null;
  /** Откуда пришёл: из бота или с сайта. */
  istochnik: Istochnik;
  /**
   * Секрет, по которому заказ забирают в боте. Есть только
   * у заказов с сайта и уезжает человеку ссылкой — по номеру
   * заказа чужой заказ подобрали бы перебором, по ключу нет.
   */
  klyuch: string | null;
  /** Ключ одного нажатия на сайте: второй запрос не заводит второй заказ. */
  popytka: string | null;
  /**
   * Метка канала, с которой человек пришёл на сайт. Переезжает
   * человеку при получении заказа: без неё весь трафик, покупающий
   * на сайте, считался бы «без метки».
   */
  metka: string | null;
  produkt_id: string;
  plan_id: string;
  nazvanie: string;
  /** Цена ТАРИФА снимком. Скидка в неё не входит — см. `skidka_kop`. */
  cena_kop: number;
  /**
   * Промокод, применённый к этому заказу. Снимок, как и название:
   * код могут отключить, а в истории заказа он обязан остаться.
   */
  promo_kod: string | null;
  /** Сколько скинул промокод, копейками. Снимок на момент заказа. */
  skidka_kop: number;
  mesyacev: number;
  status: StatusZakaza;
  vid_akkaunta: VidAkkaunta;
  /** Сколько денег заказ держит сейчас. Столько вернётся при отмене. */
  oplacheno_kop: number;
  /** Сколько из них пришло с баланса. */
  s_balansa_kop: number;
  kod_zapros_v: string | null;
  kod_poluchen_v: string | null;
  pismo_v: string | null;
  prichina_otmeny: PrichinaOtmeny | null;
  sozdan: string;
  oplachen: string | null;
  vzyat: string | null;
  ispolnitel: number | null;
  vydan: string | null;
  otmenen: string | null;
  srok_do: string | null;
  dostup_do: string | null;
  napominany_raz: number;
  napominanie_v: string | null;
};

/**
 * Сколько за заказ надо заплатить: цена тарифа минус скидка.
 *
 * ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ВЫЧИТАНИЕ ПО МЕСТУ. Мест, где считаются
 * деньги заказа, пять — оплата, баланс, счёт поставщику, статистика,
 * чек покупателю, — и разъехаться им нельзя ни на копейку: одно
 * забытое вычитание означает либо взятые лишние деньги, либо выдачу
 * за половину цены.
 *
 * `cena_kop` при этом остаётся ЦЕНОЙ ТАРИФА. Вычесть скидку прямо
 * из неё было бы проще и стоило бы истории: в чеке негде взять
 * строку «было столько», а в статистике исчезла бы разница между
 * «продали дёшево» и «дали скидку».
 */
export function kOplate(z: Pick<Zakaz, 'cena_kop' | 'skidka_kop'>): number {
  return Math.max(0, z.cena_kop - z.skidka_kop);
}

/** Статусы, в которых заказ ещё «живой». */
export const OTKRYTYE: StatusZakaza[] = [
  'zhdet_oplaty',
  'oplachen',
  'v_rabote',
  'zhdem_kod',
  'kod_poluchen',
];

/** Статусы, в которых заказ уже у помощника. */
export const U_POMOSHNIKA: StatusZakaza[] = ['v_rabote', 'zhdem_kod', 'kod_poluchen'];

const V_SPISKE = (spisok: StatusZakaza[]) => spisok.map((s) => `'${s}'`).join(',');

export function sobytie(db: Baza, zakazId: number | null, chto: string, kto: number | null, podrobnosti?: string): void {
  db.prepare('INSERT INTO sobytiya (zakaz_id, kogda, kto, chto, podrobnosti) VALUES (?, ?, ?, ?, ?)').run(
    zakazId,
    seychasISO(),
    kto,
    chto,
    podrobnosti ?? null,
  );
}

export function sobytiya(db: Baza, zakazId: number): { kogda: string; chto: string; kto: number | null }[] {
  return db
    .prepare('SELECT kogda, chto, kto FROM sobytiya WHERE zakaz_id = ? ORDER BY id')
    .all(zakazId) as { kogda: string; chto: string; kto: number | null }[];
}

export type Novy = {
  /** Чей заказ. `null` — заказ с сайта, хозяин появится позже. */
  tgId: number | null;
  istochnik?: Istochnik;
  /** Секрет для «забрать в боте». Обязателен у заказа с сайта. */
  klyuch?: string;
  /**
   * Ключ нажатия, придуманный сайтом. Повторный запрос с тем же
   * значением ВЕРНЁТ тот же заказ, а не заведёт второй: держит это
   * уникальный индекс, а не проверка в коде. Без него двойное
   * нажатие давало бы два заказа и две потраченные активации.
   */
  popytka?: string;
  /** Метка канала с сайта. Ложится человеку, когда заказ заберут. */
  metka?: string;
  produktId: string;
  planId: string;
  nazvanie: string;
  cenaKop: number;
  mesyacev: number;
  vidAkkaunta: VidAkkaunta;
  /**
   * Промокод, который человек принёс по ссылке с сайта.
   *
   * Пусто — без промокода. Активация тратится ЗДЕСЬ, при создании
   * заказа, а не тогда, когда код введён на сайте: код, сгоревший
   * у человека, который посмотрел и передумал, — это код, отобранный
   * у того, кто дошёл до конца.
   */
  promoKod?: string;
};

/** Что вышло с промокодом при оформлении. */
export type ItogPromoZakaza =
  /** Кода не приносили — или заказ не новый и ничего не тратилось. */
  | { vid: 'net' }
  | { vid: 'primenen'; kod: string; skidkaKop: number; skidkaProc: number }
  | { vid: 'ne_podoshel'; kod: string; pochemu: OtkazPromo };

export type Sozdanie = { zakaz: Zakaz; novy: boolean; promo: ItogPromoZakaza };

/**
 * Создать заказ — или вернуть уже существующий.
 *
 * Второе не менее важно первого. Человек жмёт кнопку дважды, Telegram
 * повторяет доставку, связь моргает — во всех этих случаях должен
 * получиться ОДИН заказ. Гарантию даёт уникальный индекс в базе:
 * попытка завести второй открытый заказ на тот же тариф не проходит,
 * и мы честно возвращаем первый, пометив, что он не новый.
 */
export function sozdatIliVernut(db: Baza, n: Novy): Sozdanie {
  /* ПОВТОР УЗНАЁТСЯ ПО-РАЗНОМУ, и это не мелочь. У заказа из бота
     хозяин известен, и повтором считается второй открытый заказ того
     же человека на тот же уровень. У заказа с сайта хозяина нет:
     двое разных людей, покупающих один уровень, — это два разных
     заказа, и путать их нельзя. Там повтор узнаётся по ключу
     нажатия, который придумал сайт. */
  const nayti = () =>
    (n.tgId === null
      ? n.popytka
        ? (db.prepare('SELECT * FROM zakazy WHERE popytka = ?').get(n.popytka) as Zakaz | undefined)
        : undefined
      : (db
          .prepare(`SELECT * FROM zakazy WHERE tg_id = ? AND plan_id = ? AND status IN (${V_SPISKE(OTKRYTYE)})`)
          .get(n.tgId, n.planId) as Zakaz | undefined));

  const est = nayti();
  if (est) return { zakaz: est, novy: false, promo: { vid: 'net' } };

  try {
    /* ЗАКАЗ И АКТИВАЦИЯ ПРОМОКОДА — ОДНА ТРАНЗАКЦИЯ, и это то же
       правило, по которому отмена и возврат денег неразделимы.
       Раздельно они дают два одинаково плохих состояния: «заказ есть,
       активация сгорела» и «скидка в заказе есть, а у кода не занято
       ни одного места» — то есть код, который можно потратить дважды. */
    return db.transaction((): Sozdanie => {
      const r = db
        .prepare(
          `INSERT INTO zakazy (tg_id, istochnik, klyuch, popytka, metka, produkt_id, plan_id, nazvanie,
                               cena_kop, mesyacev, vid_akkaunta, status, sozdan)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'zhdet_oplaty', ?)`,
        )
        .run(
          n.tgId,
          n.istochnik ?? 'bot',
          n.klyuch ?? null,
          n.popytka ?? null,
          n.metka ?? null,
          n.produktId,
          n.planId,
          n.nazvanie,
          n.cenaKop,
          n.mesyacev,
          n.vidAkkaunta,
          seychasISO(),
        );
      const id = Number(r.lastInsertRowid);
      sobytie(db, id, 'заказ создан', n.tgId);

      let promo: ItogPromoZakaza = { vid: 'net' };
      if (n.promoKod) {
        const z = promokody.zanyat(db, n.promoKod, id, n.tgId, n.cenaKop);
        if (z.zanyali) {
          db.prepare('UPDATE zakazy SET promo_kod = ?, skidka_kop = ? WHERE id = ?').run(
            promokody.po(db, n.promoKod)?.kod ?? n.promoKod,
            z.skidkaKop,
            id,
          );
          const kod = (po(db, id) as Zakaz).promo_kod as string;
          sobytie(db, id, 'применён промокод', n.tgId, `${kod}, −${z.skidkaProc} %`);
          promo = { vid: 'primenen', kod, skidkaKop: z.skidkaKop, skidkaProc: z.skidkaProc };
        } else {
          /* Код не подошёл — заказ всё равно остаётся. Человек пришёл
             за подпиской, а не за скидкой; уронить заказ из-за кода
             значило бы наказать его за чужую ошибку. Что именно
             не вышло, ему говорят словами. */
          promo = {
            vid: 'ne_podoshel',
            kod: n.promoKod,
            pochemu: z.pochemu.godit ? 'net' : z.pochemu.pochemu,
          };
        }
      }
      return { zakaz: po(db, id) as Zakaz, novy: true, promo };
    })();
  } catch (e) {
    // Гонка: между проверкой и вставкой заказ успел появиться.
    // Индекс нас поймал — значит заказ есть, отдаём его.
    const povtor = nayti();
    if (povtor) return { zakaz: povtor, novy: false, promo: { vid: 'net' } };
    throw e;
  }
}

export type Platezh = {
  id: number;
  zakaz_id: number;
  postavshchik: string;
  vneshny_id: string | null;
  summa_kop: number;
  valyuta: string;
  status: 'sozdan' | 'oplachen' | 'otmenen' | 'vozvrat';
  sozdan: string;
  podtverzhden: string | null;
};

/**
 * Завести платёж рядом с заказом и ВЕРНУТЬ ЕГО НОМЕР.
 *
 * Номер — это `id` строки, и он же уезжает в Робокассу как `InvId`.
 * Так сделано намеренно: у колонки стоит AUTOINCREMENT, а значит
 * номер не повторяется НИКОГДА — даже после удаления строк, даже
 * после перезапуска, даже при переходе с тестового режима на боевой.
 * Повторный номер Робокасса встречает ошибкой 40, и «уникальность»
 * счётчиком в памяти процесса, который обнуляется каждой выкладкой,
 * тут не годится.
 */
export function zavestiPlatezh(
  db: Baza,
  zakazId: number,
  postavshchik: string,
  vneshnyId: string | null,
  summaKop: number,
): number {
  const r = db
    .prepare(
      `INSERT INTO platezhi (zakaz_id, postavshchik, vneshny_id, summa_kop, valyuta, status, sozdan)
       VALUES (?, ?, ?, ?, 'RUB', 'sozdan', ?)`,
    )
    .run(zakazId, postavshchik, vneshnyId, summaKop, seychasISO());
  return Number(r.lastInsertRowid);
}

export function platezhPo(db: Baza, id: number): Platezh | null {
  return (db.prepare('SELECT * FROM platezhi WHERE id = ?').get(id) as Platezh | undefined) ?? null;
}

/**
 * Неоплаченный счёт того же заказа НА ТУ ЖЕ СУММУ.
 *
 * Нужен, чтобы повторное нажатие «Оплатить» не плодило счета.
 * Сумма в условии обязательна: человек мог за это время пополнить
 * баланс, и тогда платить он должен меньше — старый счёт стал
 * неверным, и переиспользовать его нельзя.
 */
export function otkrytyPlatezh(
  db: Baza,
  zakazId: number,
  postavshchik: string,
  summaKop: number,
): Platezh | null {
  return (
    (db
      .prepare(
        `SELECT * FROM platezhi
          WHERE zakaz_id = ? AND postavshchik = ? AND summa_kop = ? AND status = 'sozdan'
          ORDER BY id DESC LIMIT 1`,
      )
      .get(zakazId, postavshchik, summaKop) as Platezh | undefined) ?? null
  );
}

/**
 * Отметить платёж оплаченным. `false` — если он уже отмечен.
 *
 * ЭТО И ЕСТЬ ЗАЩИТА ОТ ДВОЙНОГО УВЕДОМЛЕНИЯ, и держит её база,
 * а не проверка в коде. Робокасса повторяет уведомление, пока
 * не получит «OK»; два повтора могут прийти одновременно, и между
 * «прочитали статус» и «записали новый» помещается второй. Условие
 * `status = 'sozdan'` прямо в UPDATE такого зазора не оставляет.
 */
export function otmetitPlatezhOplachennym(db: Baza, id: number): boolean {
  const r = db
    .prepare("UPDATE platezhi SET status = 'oplachen', podtverzhden = ? WHERE id = ? AND status = 'sozdan'")
    .run(seychasISO(), id);
  return r.changes > 0;
}

/**
 * Заказ по секретному ключу. Только для заказов с сайта.
 *
 * Возвращается ЛЮБОЙ заказ с таким ключом, в том числе уже забранный:
 * человеку, открывшему свою же ссылку второй раз, надо сказать «это
 * ваш заказ», а не «ссылка не годится». Кто забрал — видно по `tg_id`.
 */
export function poKlyuchu(db: Baza, klyuch: string): Zakaz | null {
  if (!klyuch) return null;
  return (db.prepare('SELECT * FROM zakazy WHERE klyuch = ?').get(klyuch) as Zakaz | undefined) ?? null;
}

/**
 * Забрать ничейный заказ себе.
 *
 * ДВОИХ НА ОДНУ ССЫЛКУ РАЗНИМАЕТ БАЗА, а не проверка в коде: условие
 * `tg_id IS NULL` стоит прямо в UPDATE. Между «прочитали, что заказ
 * ничей» и «записали хозяина» помещается второй человек — ссылку
 * могли переслать, — и тогда заказ достался бы обоим по очереди,
 * а последний записанный стёр бы первого. Ноль изменённых строк
 * значит ровно «заказ уже не ничей».
 *
 * Активации промокода получают того же хозяина той же транзакцией:
 * раздельно бывает состояние «заказ забран, а скидка числится
 * ничьей», и заметить его можно только руками.
 */
export function zabrat(db: Baza, klyuch: string, tgId: number): boolean {
  if (!klyuch) return false;
  return db.transaction(() => {
    const r = db
      .prepare('UPDATE zakazy SET tg_id = ? WHERE klyuch = ? AND tg_id IS NULL')
      .run(tgId, klyuch);
    if (r.changes === 0) return false;
    const z = poKlyuchu(db, klyuch) as Zakaz;
    promokody.proustavitCheloveka(db, z.id, tgId);
    sobytie(db, z.id, 'покупатель забрал заказ с сайта', tgId);
    return true;
  })();
}

/**
 * Ничейные заказы: оплачены на сайте, но человек до бота не дошёл.
 *
 * Их обязана видеть команда. Деньги настоящие, доступ не выдан,
 * и написать человеку первыми мы не можем — Telegram не знает, кому
 * писать. Поэтому единственное, что тут работает, — чтобы такой
 * заказ было ВИДНО, а не чтобы он тихо лежал в общей очереди.
 */
export function nichi(db: Baza): Zakaz[] {
  return db
    .prepare(
      `SELECT * FROM zakazy
        WHERE tg_id IS NULL AND status IN (${V_SPISKE(OTKRYTYE)})
        ORDER BY id DESC`,
    )
    .all() as Zakaz[];
}

/**
 * Выбрать вид аккаунта у заказа, который уже существует.
 *
 * Нужно ровно для заказов с сайта: там заказ создаётся до того, как
 * человека спросили про аккаунт. Ставится один раз — перезаписывать
 * уже выбранное нельзя, иначе нажатие из старого сообщения переводило
 * бы заказ со «своего» аккаунта на «новый», а введённый пароль
 * оставался бы висеть.
 */
export function postavitVidAkkaunta(db: Baza, id: number, vid: VidAkkaunta): boolean {
  return (
    db
      .prepare("UPDATE zakazy SET vid_akkaunta = ? WHERE id = ? AND vid_akkaunta = 'ne_vybran'")
      .run(vid, id).changes > 0
  );
}

export function po(db: Baza, id: number): Zakaz | null {
  return (db.prepare('SELECT * FROM zakazy WHERE id = ?').get(id) as Zakaz | undefined) ?? null;
}

export function cheloveka(db: Baza, tgId: number, skolko = 20): Zakaz[] {
  return db.prepare('SELECT * FROM zakazy WHERE tg_id = ? ORDER BY id DESC LIMIT ?').all(tgId, skolko) as Zakaz[];
}

/** Очередь на выдачу: всё оплаченное и незакрытое, старые сверху. */
export function ochered(db: Baza): Zakaz[] {
  return db
    .prepare(`SELECT * FROM zakazy WHERE status IN (${V_SPISKE(['oplachen', ...U_POMOSHNIKA])}) ORDER BY id`)
    .all() as Zakaz[];
}

/** Заказы одного помощника: он ведёт несколько разом. */
export function vRabote(db: Baza, kto: number): Zakaz[] {
  return db
    .prepare(`SELECT * FROM zakazy WHERE ispolnitel = ? AND status IN (${V_SPISKE(U_POMOSHNIKA)}) ORDER BY id`)
    .all(kto) as Zakaz[];
}

/** Заказы человека, по которым сейчас ждут код. */
export function zhdutKodaOt(db: Baza, tgId: number): Zakaz[] {
  return db
    .prepare("SELECT * FROM zakazy WHERE tg_id = ? AND status = 'zhdem_kod' ORDER BY id")
    .all(tgId) as Zakaz[];
}

/**
 * Кого пора отменять: код просили давно, а он так и не пришёл.
 *
 * Порог приходит числом снаружи, а не считается здесь: он равен
 * обещанному сроку выдачи, а тот живёт в настройках.
 */
export function prosrochennyeKody(db: Baza, seychas: Date, minut: number): Zakaz[] {
  const porog = new Date(seychas.getTime() - minut * 60_000).toISOString();
  return db
    .prepare("SELECT * FROM zakazy WHERE status = 'zhdem_kod' AND kod_zapros_v IS NOT NULL AND kod_zapros_v < ? ORDER BY id")
    .all(porog) as Zakaz[];
}

export function neoplachennye(db: Baza): Zakaz[] {
  return db.prepare("SELECT * FROM zakazy WHERE status = 'zhdet_oplaty' ORDER BY id").all() as Zakaz[];
}

/**
 * Отметить оплаченным.
 *
 * Единственная дверь, через которую заказ становится оплаченным.
 * Сейчас в неё стучится администратор кнопкой, следующим заходом
 * будет стучаться уведомление от платёжной системы — и больше
 * ничего менять не придётся.
 *
 * Возвращает false, если заказ уже оплачен: повторное уведомление
 * от платёжной системы не должно поднимать вторую волну сообщений.
 */
export function otmetitOplachennym(db: Baza, id: number, srokDo: Date, kto: number | null): boolean {
  const r = db
    .prepare(
      // Заказ держит СТОЛЬКО, СКОЛЬКО С ЧЕЛОВЕКА ВЗЯЛИ, то есть цену
      // за вычетом скидки. Записать сюда цену тарифа значило бы
      // вернуть при отмене больше, чем получено, — то есть печатать
      // деньги промокодом.
      `UPDATE zakazy
          SET status = 'oplachen', oplachen = ?, srok_do = ?,
              oplacheno_kop = MAX(0, cena_kop - skidka_kop)
        WHERE id = ? AND status = 'zhdet_oplaty'`,
    )
    .run(seychasISO(), srokDo.toISOString(), id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'оплата подтверждена', kto);
  return true;
}

/**
 * Оплата с баланса при оформлении.
 *
 * Списывает СКОЛЬКО ЕСТЬ, но не больше цены: балансом можно закрыть
 * заказ целиком или частично. Если закрылось целиком — заказ сразу
 * оплачен, и администратору ничего подтверждать не нужно.
 *
 * Всё одной транзакцией: списание, отметка на заказе и смена статуса.
 * Списанные деньги, не дошедшие до заказа, — это потерянные деньги
 * покупателя, и разбираться с ними пришлось бы вручную.
 */
export function oplatitSBalansa(
  db: Baza,
  id: number,
  srokDo: Date,
): { spisano: number; hvatilo: boolean } {
  return db.transaction(() => {
    const z = po(db, id);
    if (!z || z.status !== 'zhdet_oplaty' || z.cena_kop <= 0) return { spisano: 0, hvatilo: false };
    /* У НИЧЕЙНОГО ЗАКАЗА БАЛАНСА НЕТ. Заказ с сайта оплачивается
       деньгами и только ими: входа на сайте нет, и чей это баланс —
       неизвестно. Списывать «с кого-нибудь» тут нечего и не с кого. */
    if (z.tg_id === null) return { spisano: 0, hvatilo: false };
    const nuzhno = kOplate(z) - z.oplacheno_kop;
    /* СКИДКА ЗАКРЫЛА ВЕСЬ ЗАКАЗ. Такое бывает при ста процентах,
       и оставлять заказ висеть в «ждёт оплаты» нельзя: платить
       нечего, а администратору нечего подтверждать. Отмечаем
       оплаченным на ноль — деньги не списаны, и при отмене
       возвращать тоже нечего. */
    if (nuzhno <= 0) {
      db.prepare(
        "UPDATE zakazy SET status = 'oplachen', oplachen = ?, srok_do = ? WHERE id = ? AND status = 'zhdet_oplaty'",
      ).run(seychasISO(), srokDo.toISOString(), id);
      sobytie(db, id, 'оплачен промокодом целиком', z.tg_id);
      return { spisano: 0, hvatilo: true };
    }
    const spisano = koshelek.spisatSkolkoEst(db, z.tg_id, nuzhno, z.id, `заказ № ${z.id} · ${z.nazvanie}`);
    if (spisano <= 0) return { spisano: 0, hvatilo: false };
    const stalo = z.oplacheno_kop + spisano;
    const hvatilo = stalo >= kOplate(z);
    db.prepare(
      `UPDATE zakazy
          SET oplacheno_kop = ?, s_balansa_kop = s_balansa_kop + ?,
              status = CASE WHEN ? THEN 'oplachen' ELSE status END,
              oplachen = CASE WHEN ? THEN ? ELSE oplachen END,
              srok_do = CASE WHEN ? THEN ? ELSE srok_do END
        WHERE id = ?`,
    ).run(
      stalo,
      spisano,
      hvatilo ? 1 : 0,
      hvatilo ? 1 : 0,
      seychasISO(),
      hvatilo ? 1 : 0,
      srokDo.toISOString(),
      id,
    );
    sobytie(db, id, hvatilo ? 'оплачен с баланса' : 'частично оплачен с баланса', z.tg_id, `${spisano} коп.`);
    return { spisano, hvatilo };
  })();
}

/** Взять в работу. false — если кто-то уже взял. */
export function vzyat(db: Baza, id: number, kto: number): boolean {
  const r = db
    .prepare("UPDATE zakazy SET status = 'v_rabote', vzyat = ?, ispolnitel = ? WHERE id = ? AND status = 'oplachen'")
    .run(seychasISO(), kto, id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'взят в работу', kto);
  return true;
}

/**
 * Вернуть в очередь: взял и передумал.
 *
 * Ожидание кода при этом СНИМАЕТСЯ. Иначе час на ответ продолжал бы
 * идти у заказа, которым никто не занимается, и покупателя отменили бы
 * за то, что помощник ушёл.
 */
export function vernutVOchered(db: Baza, id: number, kto: number): boolean {
  const r = db
    .prepare(
      `UPDATE zakazy
          SET status = 'oplachen', vzyat = NULL, ispolnitel = NULL, kod_zapros_v = NULL
        WHERE id = ? AND status IN (${V_SPISKE(U_POMOSHNIKA)})`,
    )
    .run(id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'возвращён в очередь', kto);
  return true;
}

/**
 * Помощник дошёл до входа в аккаунт и просит код.
 *
 * Только у заказа со своим аккаунтом: в новый аккаунт входить некуда.
 * Час на ответ отсчитывается от `kod_zapros_v`, и это единственное
 * место, где он ставится.
 */
export function zaprositKod(db: Baza, id: number, kto: number): boolean {
  const r = db
    .prepare(
      `UPDATE zakazy SET status = 'zhdem_kod', kod_zapros_v = ?
        WHERE id = ? AND vid_akkaunta = 'svoy' AND status IN ('v_rabote','kod_poluchen')`,
    )
    .run(seychasISO(), id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'запрошен код двухфакторной аутентификации', kto);
  return true;
}

/** Код пришёл. Час перестаёт идти. */
export function prinyatKod(db: Baza, id: number): boolean {
  const r = db
    .prepare("UPDATE zakazy SET status = 'kod_poluchen', kod_poluchen_v = ? WHERE id = ? AND status = 'zhdem_kod'")
    .run(seychasISO(), id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'код получен', null);
  return true;
}

/**
 * Отметка «письмо с восстановлением пароля отправлено».
 *
 * Это ЗАМОК, а не заметка: отмена по причине «неверный пароль» без неё
 * не проходит. Порядок строгий — сначала человеку уходит письмо,
 * которым он вернёт себе доступ, и только потом отменяется заказ.
 * Наоборот нельзя: отменённый заказ закрывает переписку, и человек
 * остаётся и без подписки, и без пароля.
 */
export function otmetitPismo(db: Baza, id: number, kto: number): boolean {
  const r = db
    .prepare(`UPDATE zakazy SET pismo_v = ? WHERE id = ? AND status IN (${V_SPISKE(U_POMOSHNIKA)})`)
    .run(seychasISO(), id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'отправлено письмо с восстановлением пароля', kto);
  return true;
}

/** `dostupDo` = null, когда срок не объявлен: у уровня подписки его нет. */
export function otmetitVydannym(db: Baza, id: number, dostupDo: Date | null, kto: number): boolean {
  const r = db
    .prepare(
      `UPDATE zakazy SET status = 'vydan', vydan = ?, dostup_do = ?, ispolnitel = ?
        WHERE id = ? AND status IN (${V_SPISKE(['oplachen', ...U_POMOSHNIKA])})`,
    )
    .run(seychasISO(), dostupDo ? dostupDo.toISOString() : null, kto, id);
  if (r.changes === 0) return false;
  sobytie(db, id, 'доступ выдан', kto);
  return true;
}

/**
 * Отмена — и возврат денег на баланс одной транзакцией.
 *
 * Возвращается ровно то, что заказ держит (`oplacheno_kop`), после чего
 * держать ему больше нечего. Раздельные «отменить» и «вернуть» дали бы
 * состояние «заказ отменён, деньги нигде»: между двумя записями бот
 * перезапускается, и разбираться пришлось бы вручную с чужими деньгами.
 *
 * Причина «неверный пароль» под замком: без отметки об отправленном
 * письме она не проходит — см. `otmetitPismo`.
 *
 * НИЧЕЙНЫЙ ОПЛАЧЕННЫЙ ЗАКАЗ НЕ ОТМЕНЯЕТСЯ, и это тоже замок в базе.
 * Возврат идёт НА БАЛАНС покупателя, а у заказа, оплаченного на сайте
 * и ещё не забранного в боте, покупателя нет: отмена вернула бы
 * настоящие деньги в никуда и стёрла бы единственный след того, что
 * их кто-то платил. Сначала человек забирает заказ по своей ссылке —
 * потом отмена работает как обычно. Неоплаченный ничейный заказ
 * отменяется свободно: возвращать нечего.
 */
export function otmenit(
  db: Baza,
  id: number,
  kto: number | null,
  prichina: PrichinaOtmeny,
  podrobnosti?: string,
): { otmenen: boolean; vernuli: number; pochemu?: 'net_pisma' | 'zakryt' | 'nichey' } {
  return db.transaction(() => {
    const z = po(db, id);
    if (!z || !OTKRYTYE.includes(z.status)) return { otmenen: false, vernuli: 0, pochemu: 'zakryt' as const };
    if (prichina === 'nevernyy_parol' && !z.pismo_v) {
      return { otmenen: false, vernuli: 0, pochemu: 'net_pisma' as const };
    }
    if (z.tg_id === null && z.oplacheno_kop > 0) {
      return { otmenen: false, vernuli: 0, pochemu: 'nichey' as const };
    }
    db.prepare(
      `UPDATE zakazy SET status = 'otmenen', otmenen = ?, prichina_otmeny = ?, oplacheno_kop = 0 WHERE id = ?`,
    ).run(seychasISO(), prichina, id);
    const vernuli = z.oplacheno_kop;
    if (vernuli > 0 && z.tg_id !== null) {
      koshelek.vernut(db, z.tg_id, vernuli, z.id, `возврат по заказу № ${z.id} · ${z.nazvanie}`);
    }
    /* АКТИВАЦИЯ ПРОМОКОДА ВОЗВРАЩАЕТСЯ ТОЙ ЖЕ ТРАНЗАКЦИЕЙ, что
       и деньги, и по той же причине: отдельными шагами бывает
       состояние «заказ отменён, активация сгорела». Строка в истории
       применений остаётся — освобождается только место. */
    if (promokody.vernut(db, id) > 0) {
      sobytie(db, id, 'активация промокода возвращена', kto, z.promo_kod ?? undefined);
    }
    sobytie(db, id, 'заказ отменён', kto, podrobnosti ?? prichina);
    return { otmenen: true, vernuli };
  })();
}

/**
 * Просроченные: обещали выдать раньше, а всё ещё не выдали.
 *
 * Второе условие — «давно не напоминали»: напоминание не должно
 * приходить каждую минуту, иначе на него перестанут смотреть.
 */
export function prosrochennye(db: Baza, seychas: Date, pauzaMinut: number, predelRaz: number): Zakaz[] {
  const porog = new Date(seychas.getTime() - pauzaMinut * 60_000).toISOString();
  return db
    .prepare(
      `SELECT * FROM zakazy
        WHERE status IN (${V_SPISKE(['oplachen', ...U_POMOSHNIKA])})
          AND srok_do IS NOT NULL
          AND srok_do < ?
          AND napominany_raz < ?
          AND (napominanie_v IS NULL OR napominanie_v < ?)
        ORDER BY id`,
    )
    .all(seychas.toISOString(), predelRaz, porog) as Zakaz[];
}

export function otmetitNapominanie(db: Baza, id: number, kogda = new Date()): void {
  db.prepare('UPDATE zakazy SET napominany_raz = napominany_raz + 1, napominanie_v = ? WHERE id = ?').run(
    kogda.toISOString(),
    id,
  );
}

export type Statistika = {
  vsego: number;
  poStatusam: Record<string, number>;
  vyruchkaKop: number;
  /**
   * Сколько выданных заказов записаны БЕЗ цены (`cena_kop = 0`).
   *
   * Считается отдельно, потому что одна сумма врёт молча: пока прайса
   * нет, каждый заказ пишется нулём, `SUM` даёт ноль — и выходит
   * «продано на 0 ₽» вместо «цена не объявлена». Отличить одно
   * от другого по самой сумме нельзя.
   */
  bezCeny: number;
  poTovaram: { produkt_id: string; skolko: number; summa_kop: number; bez_ceny: number }[];
  zaSutki: number;
  srednyayaVydachaMinut: number | null;
};

/**
 * Окно времени для статистики.
 *
 * `null` с обеих сторон — «за всё время». Границы приходят ISO-строками
 * (`>= ot`, `< do`), потому что в базе время лежит именно так и
 * сравнение строк здесь — это сравнение времени.
 */
export type Okno = { ot: string | null; do: string | null };

const VSE_VREMYA: Okno = { ot: null, do: null };

/**
 * ОКНО ПРИКЛАДЫВАЕТСЯ К РАЗНЫМ ПОЛЯМ, и это не небрежность.
 *
 * Заказы считаются по `sozdan`: «сколько заказов за неделю» — это про
 * то, сколько их оформили. А деньги — по `vydan`: выручка засчитывается
 * в тот день, когда доступ ушёл человеку, а не когда заказ создан.
 * Иначе заказ, оформленный вчера и выданный сегодня, попадал бы
 * во вчерашнюю выручку — то есть в день, когда денег ещё не было.
 *
 * Одно окно на оба поля выглядело бы стройнее и врало бы каждый раз,
 * когда выдача переезжает через полночь.
 */
function ramka(pole: string, okno: Okno): { gde: string; dovody: string[] } {
  const usloviya: string[] = [];
  const dovody: string[] = [];
  if (okno.ot) {
    usloviya.push(`${pole} >= ?`);
    dovody.push(okno.ot);
  }
  if (okno.do) {
    usloviya.push(`${pole} < ?`);
    dovody.push(okno.do);
  }
  return { gde: usloviya.length ? ` AND ${usloviya.join(' AND ')}` : '', dovody };
}

export function statistika(db: Baza, okno: Okno = VSE_VREMYA): Statistika {
  // `WHERE 1=1` — чтобы окно приклеивалось к запросу одинаково
  // и там, где условий больше нет.
  const po_sozdan = ramka('sozdan', okno);
  const po_vydan = ramka('vydan', okno);

  const poStatusam: Record<string, number> = {};
  for (const r of db
    .prepare(`SELECT status, COUNT(*) n FROM zakazy WHERE 1=1${po_sozdan.gde} GROUP BY status`)
    .all(...po_sozdan.dovody) as {
    status: string;
    n: number;
  }[]) {
    poStatusam[r.status] = r.n;
  }
  const vsego = (
    db.prepare(`SELECT COUNT(*) n FROM zakazy WHERE 1=1${po_sozdan.gde}`).get(...po_sozdan.dovody) as { n: number }
  ).n;
  /* ВЫРУЧКА — ЭТО ТО, ЧТО ВЗЯЛИ, а не цена по прайсу: заказ со скидкой
     принёс меньше, и считать его полной ценой значило бы приписать
     лавке деньги, которых никто не платил. `bez_ceny` при этом
     по-прежнему считается по `cena_kop`: ноль там значит «цена
     не объявлена», а не «отдали даром». */
  const vyruchka = db
    .prepare(
      `SELECT COALESCE(SUM(MAX(0, cena_kop - skidka_kop)), 0) s,
              COALESCE(SUM(CASE WHEN cena_kop = 0 THEN 1 ELSE 0 END), 0) bez
         FROM zakazy WHERE status = 'vydan'${po_vydan.gde}`,
    )
    .get(...po_vydan.dovody) as { s: number; bez: number };
  const poTovaram = db
    .prepare(
      `SELECT produkt_id, COUNT(*) skolko, COALESCE(SUM(MAX(0, cena_kop - skidka_kop)),0) summa_kop,
              COALESCE(SUM(CASE WHEN cena_kop = 0 THEN 1 ELSE 0 END), 0) bez_ceny
         FROM zakazy WHERE status = 'vydan'${po_vydan.gde} GROUP BY produkt_id ORDER BY skolko DESC`,
    )
    .all(...po_vydan.dovody) as { produkt_id: string; skolko: number; summa_kop: number; bez_ceny: number }[];
  // «За сутки» окну НЕ подчиняется намеренно: это отдельный факт
  // для сводки владельца в боте, и он про последние 24 часа всегда.
  const sutki = new Date(Date.now() - 24 * 3600_000).toISOString();
  const zaSutki = (db.prepare('SELECT COUNT(*) n FROM zakazy WHERE sozdan > ?').get(sutki) as { n: number }).n;
  const sredn = db
    .prepare(
      // `vydan >= oplachen` — не придирка: невозможная пара дат даёт
      // отрицательное среднее, и на экран уезжает «−960 мин». Такую
      // строку человек не может ни понять, ни проверить; лучше
      // не считать её вовсе, чем печатать бессмыслицу.
      `SELECT AVG((julianday(vydan) - julianday(oplachen)) * 24 * 60) m
         FROM zakazy WHERE status = 'vydan' AND oplachen IS NOT NULL AND vydan IS NOT NULL
                       AND vydan >= oplachen${po_vydan.gde}`,
    )
    .get(...po_vydan.dovody) as { m: number | null };
  return {
    vsego,
    poStatusam,
    vyruchkaKop: vyruchka.s,
    bezCeny: vyruchka.bez,
    poTovaram,
    zaSutki,
    srednyayaVydachaMinut: sredn.m === null ? null : Math.round(sredn.m),
  };
}
