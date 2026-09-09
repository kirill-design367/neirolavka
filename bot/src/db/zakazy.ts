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
export type StatusZakaza =
  | 'zhdet_oplaty'
  | 'oplachen'
  | 'v_rabote'
  | 'zhdem_kod'
  | 'kod_poluchen'
  | 'vydan'
  | 'otmenen';

/** Чей аккаунт: заводим новый или входим в тот, что принёс покупатель. */
export type VidAkkaunta = 'novy' | 'svoy';

/**
 * Почему отменён. Хранится кодом, а не фразой: по причине считается
 * статистика и решается, что показать человеку, а фраза меняется.
 */
export type PrichinaOtmeny = 'ruchnaya' | 'net_koda' | 'nevernyy_parol';

export type Zakaz = {
  id: number;
  tg_id: number;
  produkt_id: string;
  plan_id: string;
  nazvanie: string;
  cena_kop: number;
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
  tgId: number;
  produktId: string;
  planId: string;
  nazvanie: string;
  cenaKop: number;
  mesyacev: number;
  vidAkkaunta: VidAkkaunta;
};

/**
 * Создать заказ — или вернуть уже существующий.
 *
 * Второе не менее важно первого. Человек жмёт кнопку дважды, Telegram
 * повторяет доставку, связь моргает — во всех этих случаях должен
 * получиться ОДИН заказ. Гарантию даёт уникальный индекс в базе:
 * попытка завести второй открытый заказ на тот же тариф не проходит,
 * и мы честно возвращаем первый, пометив, что он не новый.
 */
export function sozdatIliVernut(db: Baza, n: Novy): { zakaz: Zakaz; novy: boolean } {
  const est = db
    .prepare(`SELECT * FROM zakazy WHERE tg_id = ? AND plan_id = ? AND status IN (${V_SPISKE(OTKRYTYE)})`)
    .get(n.tgId, n.planId) as Zakaz | undefined;
  if (est) return { zakaz: est, novy: false };

  try {
    const r = db
      .prepare(
        `INSERT INTO zakazy (tg_id, produkt_id, plan_id, nazvanie, cena_kop, mesyacev, vid_akkaunta, status, sozdan)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'zhdet_oplaty', ?)`,
      )
      .run(n.tgId, n.produktId, n.planId, n.nazvanie, n.cenaKop, n.mesyacev, n.vidAkkaunta, seychasISO());
    const id = Number(r.lastInsertRowid);
    sobytie(db, id, 'заказ создан', n.tgId);
    return { zakaz: po(db, id) as Zakaz, novy: true };
  } catch (e) {
    // Гонка: между проверкой и вставкой заказ успел появиться.
    // Индекс нас поймал — значит заказ есть, отдаём его.
    const povtor = db
      .prepare(`SELECT * FROM zakazy WHERE tg_id = ? AND plan_id = ? AND status IN (${V_SPISKE(OTKRYTYE)})`)
      .get(n.tgId, n.planId) as Zakaz | undefined;
    if (povtor) return { zakaz: povtor, novy: false };
    throw e;
  }
}

/**
 * Завести платёж рядом с заказом.
 *
 * Пока поставщик — заглушка, сюда не попадает ничего. Функция есть
 * затем, чтобы следующим заходом запись платежа не пришлось изобретать
 * посреди обработчика нажатия.
 */
export function zavestiPlatezh(
  db: Baza,
  zakazId: number,
  postavshchik: string,
  vneshnyId: string | null,
  summaKop: number,
): void {
  db.prepare(
    `INSERT INTO platezhi (zakaz_id, postavshchik, vneshny_id, summa_kop, valyuta, status, sozdan)
     VALUES (?, ?, ?, ?, 'RUB', 'sozdan', ?)`,
  ).run(zakazId, postavshchik, vneshnyId, summaKop, seychasISO());
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
      `UPDATE zakazy
          SET status = 'oplachen', oplachen = ?, srok_do = ?, oplacheno_kop = cena_kop
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
    const nuzhno = z.cena_kop - z.oplacheno_kop;
    const spisano = koshelek.spisatSkolkoEst(db, z.tg_id, nuzhno, z.id, `заказ № ${z.id} · ${z.nazvanie}`);
    if (spisano <= 0) return { spisano: 0, hvatilo: false };
    const stalo = z.oplacheno_kop + spisano;
    const hvatilo = stalo >= z.cena_kop;
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
 */
export function otmenit(
  db: Baza,
  id: number,
  kto: number | null,
  prichina: PrichinaOtmeny,
  podrobnosti?: string,
): { otmenen: boolean; vernuli: number; pochemu?: 'net_pisma' | 'zakryt' } {
  return db.transaction(() => {
    const z = po(db, id);
    if (!z || !OTKRYTYE.includes(z.status)) return { otmenen: false, vernuli: 0, pochemu: 'zakryt' as const };
    if (prichina === 'nevernyy_parol' && !z.pismo_v) {
      return { otmenen: false, vernuli: 0, pochemu: 'net_pisma' as const };
    }
    db.prepare(
      `UPDATE zakazy SET status = 'otmenen', otmenen = ?, prichina_otmeny = ?, oplacheno_kop = 0 WHERE id = ?`,
    ).run(seychasISO(), prichina, id);
    const vernuli = z.oplacheno_kop;
    if (vernuli > 0) {
      koshelek.vernut(db, z.tg_id, vernuli, z.id, `возврат по заказу № ${z.id} · ${z.nazvanie}`);
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
  const vyruchka = db
    .prepare(
      `SELECT COALESCE(SUM(cena_kop), 0) s,
              COALESCE(SUM(CASE WHEN cena_kop = 0 THEN 1 ELSE 0 END), 0) bez
         FROM zakazy WHERE status = 'vydan'${po_vydan.gde}`,
    )
    .get(...po_vydan.dovody) as { s: number; bez: number };
  const poTovaram = db
    .prepare(
      `SELECT produkt_id, COUNT(*) skolko, COALESCE(SUM(cena_kop),0) summa_kop,
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
