/**
 * Панель: разбор запроса, вход, права, действия.
 *
 * Панель живёт ВНУТРИ процесса бота и работает с той же базой. Это
 * не украшение архитектуры: SQLite терпит одного пишущего, и вторая
 * служба у той же базы — это очередь блокировок и разъезд состояния
 * там, где сейчас его нет вовсе.
 *
 * Отсюда главное правило файла: **панель не повторяет логику бота,
 * а зовёт те же функции переходов**. `zakazy.otmenit` возвращает
 * деньги, `zakazy.otmenit` же держит замок на письмо; если панель
 * заведёт свою отмену, замок останется в боте, а дыра появится
 * здесь. Ниже нет ни одного `UPDATE zakazy` — только вызовы
 * `db/zakazy.ts`, `db/koshelek.ts`, `db/dostupy.ts` и уведомления
 * тем же `uvedomleniya.cheloveku`, каким пишет бот.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Lavka } from '../lavka.js';
import * as adminy from '../db/adminy.js';
import * as komanda from '../db/komanda.js';
import * as zakazy from '../db/zakazy.js';
import * as lyudi from '../db/lyudi.js';
import * as koshelek from '../db/koshelek.js';
import * as dostupy from '../db/dostupy.js';
import * as svoi from '../db/svoi.js';
import * as kody from '../db/kody.js';
import * as dialogi from '../db/dialogi.js';
import * as bdKatalog from '../db/katalog.js';
import * as bdVykladki from '../db/vykladki.js';
import * as vyk from './vykladka.js';
import { raspisanie } from '../db/nastroyki.js';
import { srokVydachi, dostupDo } from '../lib/vremya.js';
import * as t from '../lib/texty.js';
import { rubli } from '../lib/katalog.js';
import { getCatalog } from '../lib/katalog.js';
import { kodMetki } from '../lib/metka.js';
import { kodPromo } from '../lib/promokod.js';
import * as metki from '../db/metki.js';
import * as promo from '../db/promokody.js';
import * as uvedom from '../bot/uvedomleniya.js';
import { zhurnal } from '../lib/zhurnal.js';
import { SLOVAR, razobratYazyk } from './yazyk.js';
import type { Slova, Yazyk } from './yazyk.js';
import type { Obstanovka } from './vid.js';
import * as str from './stranicy.js';

/** Корень панели. Всё, что вне него, панели не касается. */
export const KOREN = '/admin';

const KUKA_SESSII = 'nl_admin';
const KUKA_YAZYKA = 'nl_yazyk';
/**
 * Какие группы очереди свёрнуты.
 *
 * В куке, а не в адресе: очередь сама обновляется раз в 30 секунд,
 * и состояние, живущее в адресе, пришлось бы тащить через каждую
 * ссылку — а забытое в одной из них оно молча развернуло бы всё
 * обратно. Это настройка вида на этом браузере, не данные.
 */
const KUKA_GRUPP = 'nl_svernuto';
/**
 * Как часто очередь обновляет себя сама.
 *
 * В куке по той же причине, что и свёрнутые группы: это настройка
 * вида на этом браузере. И это ЕДИНСТВЕННОЕ место, где интервал
 * живёт, — раньше 30 секунд стояли числом прямо в странице, и выбрать
 * другую частоту было нельзя, а выключить нельзя тем более.
 */
const KUKA_OBNOVLENIYA = 'nl_obnovlenie';

/** Больше этого в форме панели быть не может — значит это не форма. */
const PREDEL_TELA = 64 * 1024;

/**
 * Заголовки, с которыми уходит КАЖДЫЙ ответ панели.
 *
 * `no-store` — потому что на страницах лежат чужие логины и пароли:
 * им нечего делать в кеше браузера и в кеше промежуточного узла.
 * Политика содержимого запрещает скрипты целиком: панель собирается
 * строками на сервере, ни одного скрипта на ней нет, и внедрить
 * чужой невозможно даже при ошибке экранирования.
 */
const ZAGOLOVKI: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, no-cache, must-revalidate',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; " +
    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function otdat(res: ServerResponse, kod: number, telo: string, eshcho: Record<string, string> = {}): void {
  res.writeHead(kod, { ...ZAGOLOVKI, ...eshcho });
  res.end(telo);
}

function kuda(res: ServerResponse, adres: string, eshcho: Record<string, string> = {}): void {
  // 303: после POST браузер обязан перейти на GET, иначе обновление
  // страницы повторяет действие — а действия здесь необратимые.
  res.writeHead(303, { ...ZAGOLOVKI, location: adres, ...eshcho });
  res.end();
}

function kuki(req: IncomingMessage): Record<string, string> {
  const stroka = req.headers.cookie ?? '';
  const itog: Record<string, string> = {};
  for (const kus of stroka.split(';')) {
    const i = kus.indexOf('=');
    if (i < 0) continue;
    itog[kus.slice(0, i).trim()] = decodeURIComponent(kus.slice(i + 1).trim());
  }
  return itog;
}

/**
 * Кука сессии.
 *
 * `HttpOnly` — скрипту её не прочитать (скриптов у нас нет, но кука
 * уходит и на страницы, которых ещё нет). `SameSite=Strict` —
 * запрос, пришедший с чужого сайта, куку не несёт вовсе, и подделка
 * запроса ломается ещё до проверки токена. `Secure` — панель живёт
 * только на https.
 */
function pechenka(token: string, srokMs: number): string {
  const chasti = [
    `${KUKA_SESSII}=${token}`,
    `Path=${KOREN}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${Math.round(srokMs / 1000)}`,
  ];
  return chasti.join('; ');
}

async function telo(req: IncomingMessage): Promise<URLSearchParams> {
  const kuski: Buffer[] = [];
  let dlina = 0;
  for await (const k of req) {
    const b = k as Buffer;
    dlina += b.length;
    // Обрываем, а не копим: форма панели не бывает больше страницы
    // текста, а память процесса одна на бота и на панель.
    if (dlina > PREDEL_TELA) throw new Error('слишком большое тело запроса');
    kuski.push(b);
  }
  return new URLSearchParams(Buffer.concat(kuski).toString('utf8'));
}

/** Сравнение токена защиты постоянным временем. */
function sovpadaet(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Itog = {
  ok?: keyof Slova;
  oshibka?: keyof Slova;
  /** Число к сообщению: «…по заказу № 12». */
  n?: number;
  /** Куда вернуться. По умолчанию туда же, откуда пришли. */
  kuda?: string;
};

function sSoobshcheniem(put: string, i: Itog): string {
  const q = new URLSearchParams();
  if (i.ok) q.set('ok', i.ok);
  if (i.oshibka) q.set('err', i.oshibka);
  if (i.n !== undefined) q.set('n', String(i.n));
  const s = q.toString();
  return s ? `${i.kuda ?? put}?${s}` : (i.kuda ?? put);
}

/**
 * Разбор сообщения из адреса.
 *
 * Ключ проверяется по словарю, а не подставляется как есть: иначе
 * ссылка вида `?err=<что угодно>` печатала бы на странице панели
 * чужой текст — маленькая, но настоящая дверь для обмана помощника.
 */
function soobshchenie(s: Slova, poisk: URLSearchParams): { horosho?: string; oshibka?: string } {
  const vzyat = (imya: string): string | undefined => {
    const k = poisk.get(imya);
    if (!k || !Object.prototype.hasOwnProperty.call(s, k)) return undefined;
    const text = s[k as keyof Slova];
    const n = poisk.get('n');
    return n && /^\d{1,12}$/.test(n) ? `${text} № ${n}` : text;
  };
  return { horosho: vzyat('ok'), oshibka: vzyat('err') };
}

// ── сам разбор запроса ───────────────────────────────────────────────

export type Panel = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function sozdatPanel(l: Lavka): Panel {
  const db = l.db;

  return async function panel(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const adresPolny = new URL(req.url ?? '/', 'http://panel');
    const put = adresPolny.pathname.replace(/\/+$/, '') || KOREN;
    const poisk = adresPolny.searchParams;
    const k = kuki(req);
    const yazyk: Yazyk = razobratYazyk(k[KUKA_YAZYKA]);
    const s = SLOVAR[yazyk];

    // Смена языка — до всякой проверки входа: переключатель есть
    // и на странице входа, а помощнику, который не читает по-русски,
    // иначе некуда нажать.
    if (put === `${KOREN}/yazyk`) {
      const na = razobratYazyk(poisk.get('na') ?? undefined);
      const nazad = poisk.get('nazad') ?? `${KOREN}/ochered`;
      // Возврат ТОЛЬКО внутрь панели: открытый переход по чужому
      // адресу из нашей ссылки — это готовая приманка для человека,
      // который доверяет ссылке на свою панель.
      const kudaNazad = nazad.startsWith(`${KOREN}/`) || nazad === KOREN ? nazad : `${KOREN}/ochered`;
      kuda(res, kudaNazad, {
        'set-cookie': `${KUKA_YAZYKA}=${na}; Path=${KOREN}; SameSite=Strict; Secure; Max-Age=31536000`,
      });
      return;
    }

    const token = k[KUKA_SESSII];
    const sess = token ? adminy.sessiya(db, token) : null;
    const rol = sess ? komanda.rol(db, sess.tgId) : null;

    const o: Obstanovka = {
      yazyk,
      s,
      put,
      ...(sess && rol ? { login: sess.login, rol, zashchita: sess.zashchita } : {}),
    };

    // ── вход ──────────────────────────────────────────────────────────

    if (put === `${KOREN}/vhod` && req.method === 'POST') {
      const f = await telo(req).catch(() => null);
      if (!f) return otdat(res, 400, str.vhod(o, s.nevernyyVhod));
      const login = (f.get('login') ?? '').trim().slice(0, 64);
      const parol = f.get('parol') ?? '';
      adminy.ubratStarye(db);
      const zamok = adminy.zamok(db, login);
      if (zamok.zaperto) return otdat(res, 429, str.vhod(o, s.zaperto));
      const u = adminy.uchetka(db, login);
      // Пароль проверяется ДАЖЕ у несуществующего логина — иначе
      // по времени ответа видно, какие логины заведены.
      const podoshlo = u
        ? adminy.parolPodhodit(parol, u.parol_hash)
        : adminy.parolPodhodit(parol, adminy.zashifrovatParol('nikto'));
      if (!u || !podoshlo || !komanda.rol(db, u.tg_id)) {
        adminy.otmetitNeudachu(db, login);
        zhurnal.vnimanie(`панель: неудачный вход «${login}»`);
        return otdat(res, 401, str.vhod(o, s.nevernyyVhod));
      }
      adminy.zabytNeudachi(db, login);
      const nachalo = adminy.nachatSessiyu(db, login);
      zhurnal.info(`панель: вошёл ${login}`);
      kuda(res, `${KOREN}/ochered`, { 'set-cookie': pechenka(nachalo.token, adminy.SROK_SESSII_MS) });
      return;
    }

    if (!sess || !rol) {
      // Ни намёка на то, что здесь панель, для тех, кто не вошёл:
      // страница входа и есть весь ответ.
      if (req.method === 'POST') return kuda(res, KOREN);
      return otdat(res, put === KOREN || put === `${KOREN}/` ? 200 : 401, str.vhod(o));
    }

    if (put === `${KOREN}/vyhod` && req.method === 'POST') {
      const f = await telo(req).catch(() => null);
      if (!f || !sovpadaet(f.get('zashchita') ?? '', sess.zashchita)) {
        return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'ustarelaForma' }));
      }
      if (token) adminy.zakonchitSessiyu(db, token);
      kuda(res, KOREN, { 'set-cookie': `${KUKA_SESSII}=; Path=${KOREN}; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
      return;
    }

    const vladelec = rol === 'vladelec';
    const r = () => raspisanie(db, l.n);
    const poyas = r().poyas;
    const klyuch = l.n.klyuchDostupov;
    const pokaz = soobshchenie(s, poisk);

    // ── страницы ──────────────────────────────────────────────────────

    // Вид очереди: сортировка живёт в адресе (её видно и можно
    // оставить в закладке), свёрнутые группы — в куке.
    const poryadok = str.razobratPoryadok(poisk);
    const svernuto = new Set(
      (k[KUKA_GRUPP] ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => (str.GRUPPY as string[]).includes(x)),
    );
    const obnovlyat = str.razobratObnovlenie(k[KUKA_OBNOVLENIYA]);
    const ocheredStranica = () =>
      str.ochered(o, db, klyuch, poyas, poryadok, svernuto, obnovlyat, pokaz);

    if (req.method === 'GET') {
      if (put === KOREN) return kuda(res, `${KOREN}/ochered`);
      if (put === `${KOREN}/ochered`) return otdat(res, 200, ocheredStranica());

      if (put === `${KOREN}/ochered/obnovlenie`) {
        /* Выбор частоты и возврат на ЧИСТЫЙ адрес — тот же порядок,
           что у свёртывания групп: без 303 самообновление повторило бы
           переход и человек не смог бы уйти со страницы. */
        const t = str.razobratObnovlenie(poisk.get('t'));
        return kuda(res, `${KOREN}/ochered?sort=${poryadok.po}&napr=${poryadok.napr}`, {
          'set-cookie':
            `${KUKA_OBNOVLENIYA}=${t}; Path=${KOREN}; HttpOnly; Secure; ` +
            'SameSite=Strict; Max-Age=31536000',
        });
      }

      if (put === `${KOREN}/ochered/svernut`) {
        // Свернуть или развернуть — и вернуться на чистый адрес.
        // Без возврата 303 самообновление страницы через 30 секунд
        // повторило бы переключение и раскрыло группу обратно.
        const g = poisk.get('g') ?? '';
        if ((str.GRUPPY as string[]).includes(g)) {
          if (svernuto.has(g)) svernuto.delete(g);
          else svernuto.add(g);
        }
        return kuda(res, `${KOREN}/ochered?sort=${poryadok.po}&napr=${poryadok.napr}`, {
          'set-cookie':
            `${KUKA_GRUPP}=${[...svernuto].join(',')}; Path=${KOREN}; HttpOnly; Secure; ` +
            'SameSite=Strict; Max-Age=31536000',
        });
      }
      const zak = put.match(/^\/admin\/zakaz\/(\d+)$/);
      if (zak) {
        const z = zakazy.po(db, Number(zak[1]));
        if (!z) return otdat(res, 404, ocheredStranica());
        return otdat(res, 200, str.zakaz(o, db, z, klyuch, poyas, pokaz));
      }
      if (put === `${KOREN}/pokupateli`) {
        if (!vladelec) return otdat(res, 403, ocheredStranica());
        const otbor = poisk.get('otbor') ?? 'vse';
        return otdat(
          res,
          200,
          str.pokupateli(o, db, {
            q: (poisk.get('q') ?? '').slice(0, 64),
            otbor: (['vse', 's_zakazami', 'bez_zakazov', 's_balansom'] as const).find((x) => x === otbor) ?? 'vse',
          }),
        );
      }
      const pok = put.match(/^\/admin\/pokupatel\/(\d+)$/);
      if (pok) {
        if (!vladelec) return otdat(res, 403, ocheredStranica());
        return otdat(res, 200, str.pokupatel(o, db, Number(pok[1]), poyas));
      }
      if (put === `${KOREN}/katalog`) {
        if (!vladelec) return otdat(res, 403, ocheredStranica());
        return otdat(res, 200, str.katalog(o, db));
      }
      if (put === `${KOREN}/vykladka`) {
        if (!vladelec) return otdat(res, 403, ocheredStranica());
        // Спрашиваем хранилище не чаще раза в восемь секунд: страница
        // сама обновляется каждые пятнадцать, а открытых вкладок может
        // быть несколько.
        const idet = bdVykladki.idushchaya(db);
        if (idet && (!idet.proverena || Date.now() - Date.parse(idet.proverena) > 8_000)) {
          await vyk.proverit(l);
        }
        return otdat(res, 200, str.vykladka(o, db, poyas, l.n.adresSayta, pokaz));
      }
      if (put === `${KOREN}/promokody`) {
        /* ПРАВА ПРОВЕРЯЮТСЯ И ЗДЕСЬ, И НА ДЕЙСТВИИ. Скидка на чужой
           заказ — это деньги, а деньги помощнику не поручены нигде;
           спрятанный пункт меню — удобство, а не защита. */
        if (!vladelec) return otdat(res, 403, ocheredStranica());
        return otdat(res, 200, str.promokody(o, db, poyas, getCatalog().botUrl, pokaz));
      }
      if (put === `${KOREN}/statistika`) {
        if (!vladelec) return otdat(res, 403, ocheredStranica());
        return otdat(
          res,
          200,
          str.statistika(
            o,
            db,
            poyas,
            str.razobratPeriod(poisk.get('za')),
            l.n.adresSayta,
            getCatalog().botUrl,
            pokaz,
          ),
        );
      }
      return otdat(res, 404, ocheredStranica());
    }

    if (req.method !== 'POST') return otdat(res, 405, ocheredStranica());

    const f = await telo(req).catch(() => null);
    if (!f) return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'ustarelaForma' }));
    // ЗАЩИТА ОТ ПОДДЕЛКИ ЗАПРОСА. Кука уже не уйдёт с чужого сайта
    // (SameSite=Strict), но полагаться на одну линию нельзя: браузеры
    // разные, а цена ошибки — чужой рукой отменённый заказ.
    if (!sovpadaet(f.get('zashchita') ?? '', sess.zashchita)) {
      return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'ustarelaForma' }));
    }

    const kto = sess.tgId;

    // ── действия по заказу ────────────────────────────────────────────

    const dey = put.match(/^\/admin\/zakaz\/(\d+)\/([a-z-]+)$/);
    if (dey) {
      const id = Number(dey[1]);
      const chto = dey[2] as string;
      const stranicaZakaza = `${KOREN}/zakaz/${id}`;
      const z = zakazy.po(db, id);
      if (!z) return kuda(res, sSoobshcheniem(stranicaZakaza, { oshibka: 'netZakaza', kuda: `${KOREN}/ochered` }));

      // Показ секретов ничего не меняет и никуда не уводит: секрет
      // в адресе строки остался бы в истории браузера и в журнале
      // промежуточного узла. Поэтому страница рисуется прямо здесь.
      if (chto === 'akkaunt') {
        const a = svoi.vzyat(db, id, klyuch);
        if (!a) return kuda(res, sSoobshcheniem(stranicaZakaza, { oshibka: 'dannyhNet' }));
        zakazy.sobytie(db, id, 'смотрели данные аккаунта покупателя', kto);
        return otdat(res, 200, str.zakaz(o, db, z, klyuch, poyas, { akkaunt: { pochta: a.pochta, parol: a.parol } }));
      }
      if (chto === 'kod-pokazat') {
        const kod = kody.vzyat(db, id, klyuch);
        if (!kod) return kuda(res, sSoobshcheniem(stranicaZakaza, { oshibka: 'kodaNet' }));
        /* След остаётся и здесь. Показ данных аккаунта его писал,
           а показ кода — нет: та же расшифровка чужого секрета,
           а в истории заказа пусто. Асимметрия была недосмотром. */
        zakazy.sobytie(db, id, 'смотрели код двухфакторной аутентификации', kto);
        return otdat(res, 200, str.zakaz(o, db, z, klyuch, poyas, { kod: kod.kod }));
      }

      /* ОТМЕТКА ОПЛАТЫ — ТОЛЬКО ВЛАДЕЛЬЦУ, и это не педантизм.
         `otmetitOplachennym` ставит `oplacheno_kop = cena_kop`, ничего
         при этом не получив, а отмена возвращает эту сумму НА БАЛАНС
         покупателя — балансом же закрываются заказы. Связка «отметил
         оплату → отменил» печатала деньги, и повторять её можно было
         сколько угодно: уникальный индекс держит только открытые
         статусы, а отменённый заказ оформляется заново. Пока цен нет,
         начислялся ноль, — то есть дыра заряжалась в тот день, когда
         владелец впишет первую цену.
         Таблица ролей в CLAUDE.md говорит ровно это: помощнику —
         заказы и выдача, деньги — владельцу. */
      if (chto === 'oplata' && !vladelec) {
        return kuda(res, sSoobshcheniem(stranicaZakaza, { oshibka: 'netPrav' }));
      }

      const itog = await deystvieZakaza(l, o, z, chto, f, kto);
      return kuda(res, sSoobshcheniem(stranicaZakaza, itog));
    }

    // ── размеченные ссылки: только владельцу ─────────────────────────

    if (put === `${KOREN}/metka`) {
      if (!vladelec) return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'netPrav' }));
      const kod = kodMetki(f.get('kod') ?? '');
      /* Пустой код — это НЕ «метка без кода», а «в присланном не
         осталось ни одного знака, который переживёт ссылку». Молча
         записать такую метку значило бы завести канал, который
         никогда никого не приведёт. */
      if (!kod) return kuda(res, sSoobshcheniem(`${KOREN}/statistika`, { oshibka: 'kodNeGoditsya' }));
      metki.zavesti(
        db,
        {
          kod,
          nazvanie: (f.get('nazvanie') ?? '').slice(0, 80),
          istochnik: (f.get('istochnik') ?? '').slice(0, 40),
          kanal: (f.get('kanal') ?? '').slice(0, 40),
          kampaniya: (f.get('kampaniya') ?? '').slice(0, 40),
        },
        kto,
      );
      return kuda(res, sSoobshcheniem(`${KOREN}/statistika`, { ok: 'metkaZavedena' }));
    }

    const metkaUbrat = put.match(/^\/admin\/metka\/([^/]+)\/ubrat$/);
    if (metkaUbrat) {
      if (!vladelec) return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'netPrav' }));
      metki.ubrat(db, decodeURIComponent(metkaUbrat[1] as string));
      return kuda(res, sSoobshcheniem(`${KOREN}/statistika`, { ok: 'metkaUbrana' }));
    }

    // ── промокоды: только владельцу ─────────────────────────────────

    if (put === `${KOREN}/promokod`) {
      if (!vladelec) return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'netPrav' }));
      /* Пустое поле кода — это «придумай сам», а не отказ: владелец
         чаще всего не хочет сочинять буквы, ему нужна скидка. Код
         из непустого поля при этом чистится теми же правилами, что
         на сайте, — иначе введённый кириллицей он молча стал бы
         другим кодом. */
      const vvedeno = kodPromo(f.get('kod') ?? '');
      const kod = vvedeno || promo.pridumatKod();
      const skidka = Number((f.get('skidka') ?? '').trim());
      const aktivaciy = Number((f.get('aktivaciy') ?? '').trim());
      /* Дата из формы — это ДЕНЬ, а «до 30 сентября» человек читает
         как «тридцатое ещё работает». Поэтому берётся конец этого
         дня, а не его полночь: иначе код умирал бы на сутки раньше
         обещанного. */
      const den = (f.get('do') ?? '').trim();
      const doDaty = /^\d{4}-\d{2}-\d{2}$/.test(den) ? `${den}T23:59:59.999Z` : '';
      const itog = promo.zavesti(db, { kod, skidkaProc: skidka, doDaty, aktivaciy }, kto);
      if ('oshibka' in itog) {
        const slovo =
          itog.oshibka === 'zanyat'
            ? 'promoKodZanyat'
            : itog.oshibka === 'nevernaya_skidka'
              ? 'promoSkidkaNeverna'
              : itog.oshibka === 'net_sroka'
                ? 'promoSrokNeveren'
                : itog.oshibka === 'nevernye_aktivacii'
                  ? 'promoAktivaciiNeverny'
                  : 'promoKodNeGoditsya';
        return kuda(res, sSoobshcheniem(`${KOREN}/promokody`, { oshibka: slovo as keyof Slova }));
      }
      zhurnal.info(`панель: заведён промокод ${itog.promokod.kod}`);
      return kuda(res, sSoobshcheniem(`${KOREN}/promokody`, { ok: 'promoZaveden' }));
    }

    const promoOtkl = put.match(/^\/admin\/promokod\/([^/]+)\/otklyuchit$/);
    if (promoOtkl) {
      if (!vladelec) return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'netPrav' }));
      /* Отключение, а НЕ удаление: на код ссылаются заказы, и стереть
         его значило бы переписать их историю. Тот же закон, что
         у спрятанного продукта в каталоге. */
      const vyklyuchaem = (f.get('kak') ?? '1') === '1';
      const nashli = promo.otklyuchit(db, decodeURIComponent(promoOtkl[1] as string), vyklyuchaem);
      if (!nashli) return kuda(res, sSoobshcheniem(`${KOREN}/promokody`, { oshibka: 'nelzyaSeychas' }));
      return kuda(
        res,
        sSoobshcheniem(`${KOREN}/promokody`, { ok: vyklyuchaem ? 'promoOtklyuchen2' : 'promoVklyuchen' }),
      );
    }

    // ── деньги покупателя: только владельцу ──────────────────────────

    const popolnenie = put.match(/^\/admin\/pokupatel\/(\d+)\/popolnit$/);
    if (popolnenie) {
      if (!vladelec) return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'netPrav' }));
      const tgId = Number(popolnenie[1]);
      const stranicaLica = `${KOREN}/pokupatel/${tgId}`;
      if (!lyudi.chelovek(db, tgId)) {
        return kuda(res, sSoobshcheniem(stranicaLica, { oshibka: 'netTakogoCheloveka' }));
      }
      const rublei = Number((f.get('rubli') ?? '').replace(',', '.'));
      if (!Number.isFinite(rublei) || rublei <= 0) {
        return kuda(res, sSoobshcheniem(stranicaLica, { oshibka: 'summaNeverna' }));
      }
      const kop = Math.round(rublei * 100);
      const stalo = koshelek.popolnit(db, tgId, kop, 'пополнение из панели', kto);
      await uvedom.cheloveku(
        l,
        tgId,
        [
          `Баланс пополнен на ${rubli(kop)}.`,
          '',
          `Сейчас на балансе ${rubli(stalo)}. Балансом оплачивается заказ — ` +
            'целиком или частично, при оформлении он спишется сам.',
        ].join('\n'),
      );
      return kuda(res, sSoobshcheniem(stranicaLica, { ok: 'popolnili' }));
    }

    // ── выкладка на сайт: только владельцу ───────────────────────────

    if (put === `${KOREN}/vykladka/vylozhit`) {
      if (!vladelec) return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'netPrav' }));
      const itog = await vyk.zapustit(l, kto);
      if (itog.vid === 'poshla') {
        return kuda(res, sSoobshcheniem(`${KOREN}/vykladka`, { ok: 'vykladkaPoshla' }));
      }
      if (itog.vid === 'sovpadaet') {
        return kuda(res, sSoobshcheniem(`${KOREN}/vykladka`, { ok: 'vykladkaSovpadaet' }));
      }
      if (itog.vid === 'uzhe_idet') {
        return kuda(res, sSoobshcheniem(`${KOREN}/vykladka`, { oshibka: 'vykladkaUzheIdet' }));
      }
      // Отказ приходит уже человеческой фразой — её и показываем,
      // а не ключ из словаря: причин много, и каждая своя.
      return otdat(res, 200, str.vykladka(o, db, poyas, l.n.adresSayta, { oshibka: itog.pochemu }));
    }

    // ── каталог: только владельцу ────────────────────────────────────

    if (put.startsWith(`${KOREN}/katalog/`)) {
      if (!vladelec) return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'netPrav' }));
      const itog = deystvieKataloga(db, put, f);
      return kuda(res, sSoobshcheniem(`${KOREN}/katalog`, itog));
    }

    return kuda(res, sSoobshcheniem(`${KOREN}/ochered`, { oshibka: 'nelzyaSeychas' }));
  };
}

// ── действия по заказу ───────────────────────────────────────────────

/**
 * Одна дверь на все переходы заказа.
 *
 * Каждая ветка зовёт ту же функцию `db/zakazy.ts`, что и бот, и то же
 * уведомление покупателю. Ничего своего здесь нет и быть не должно:
 * правила (замок на письмо, возврат денег при отмене, один открытый
 * заказ на уровень) живут в базе и в переходах, а не в интерфейсе.
 */
async function deystvieZakaza(
  l: Lavka,
  o: Obstanovka,
  z: zakazy.Zakaz,
  chto: string,
  f: URLSearchParams,
  kto: number,
): Promise<Itog> {
  const db = l.db;
  const id = z.id;
  const r = raspisanie(db, l.n);

  if (chto === 'oplata') {
    const srok = srokVydachi(new Date(), r);
    if (!zakazy.otmetitOplachennym(db, id, srok.do, kto)) return { oshibka: 'nelzyaSeychas' };
    const svezhy = zakazy.po(db, id) as zakazy.Zakaz;
    await uvedom.cheloveku(l, z.tg_id, t.oplataPodtverzhdena(svezhy, srok, r));
    return { ok: 'otmetilOplatu' };
  }

  if (chto === 'vzyat') {
    if (!zakazy.vzyat(db, id, kto)) return { oshibka: 'nelzyaSeychas' };
    await uvedom.cheloveku(l, z.tg_id, t.vzyatVRabotu(z));
    return { ok: 'vzyalVRabotu' };
  }

  if (chto === 'vernut') {
    if (!zakazy.vernutVOchered(db, id, kto)) return { oshibka: 'nelzyaSeychas' };
    return { ok: 'vernulVOchered' };
  }

  if (chto === 'kod') {
    if (z.vid_akkaunta !== 'svoy') return { oshibka: 'kodNeNuzhen' };
    // Разговор о коде ОДИН на человека: второй запрос затёр бы
    // первый, код пришёл бы не к тому заказу, а час на ответ шёл бы
    // у обоих.
    const drugoy = zakazy.zhdutKodaOt(db, z.tg_id).find((x) => x.id !== id);
    if (drugoy) return { oshibka: 'uzheVvoditKod', n: drugoy.id };
    if (!zakazy.zaprositKod(db, id, kto)) return { oshibka: 'nelzyaSeychas' };
    kody.zaprosit(db, id, kto);
    dialogi.postavit(db, z.tg_id, 'zhdem_kod', id, {}, l.n.klyuchDostupov);
    const svezhy = zakazy.po(db, id) as zakazy.Zakaz;
    const doshlo = await uvedom.cheloveku(l, z.tg_id, t.prosimKod(svezhy, r.obeshchanieMinut));
    if (!doshlo.doshlo) {
      zakazy.sobytie(db, id, 'просьба о коде не доставлена', kto, doshlo.pochemu);
      return { oshibka: 'neDoshlo' };
    }
    return { ok: 'sprosiliKod' };
  }

  if (chto === 'pismo') {
    if (!zakazy.otmetitPismo(db, id, kto)) return { oshibka: 'nelzyaSeychas' };
    return { ok: 'otmetilPismo' };
  }

  if (chto === 'dostup') {
    const login = (f.get('login') ?? '').trim();
    const parol = (f.get('parol') ?? '').trim();
    const zametka = (f.get('zametka') ?? '').trim() || null;
    if (!login || !parol) return { oshibka: 'nuzhenLoginParol' };
    dostupy.polozhit(db, id, { login, parol, zametka }, kto, l.n.klyuchDostupov);
    zakazy.sobytie(db, id, 'доступ записан', kto);
    return { ok: 'sohraneno' };
  }

  if (chto === 'otpravit') {
    if (!dostupy.est(db, id)) return { oshibka: 'dostupNeZapisan' };
    let d: dostupy.Dostup | null = null;
    try {
      d = dostupy.vzyat(db, id, l.n.klyuchDostupov);
    } catch (e) {
      // Пароль в журнал не попадает НИКОГДА: пишем, что не читается,
      // и ничего больше.
      zhurnal.oshibka(`панель: не читается доступ по заказу ${id}:`, e);
      return { oshibka: 'neChitaetsyaDostup' };
    }
    if (!d) return { oshibka: 'dostupNeZapisan' };
    // Сначала доставка, потом отметка. Обратный порядок оставил бы
    // заказ закрытым при неотправленном доступе.
    const dostupDoDaty = z.dostup_do
      ? new Date(z.dostup_do)
      : z.mesyacev > 0
        ? dostupDo(new Date(), z.mesyacev)
        : null;
    const dlyaPokupatelya = { ...z, dostup_do: dostupDoDaty ? dostupDoDaty.toISOString() : null };
    const otpravka = await uvedom.cheloveku(
      l,
      z.tg_id,
      t.dostupVydan(dlyaPokupatelya, d.login, d.parol, d.zametka, r),
    );
    if (!otpravka.doshlo) {
      zakazy.sobytie(db, id, 'доступ не доставлен покупателю', kto, otpravka.pochemu);
      return { oshibka: 'ostavilNevydannym' };
    }
    zakazy.otmetitVydannym(db, id, dostupDoDaty, kto);
    return { ok: 'otpravleno' };
  }

  if (chto === 'otmena') {
    /* Разбор по БЕЛОМУ СПИСКУ с отказом. Здесь стояло «всё, что
       не nevernyy_parol, — это ruchnaya», и такая строка молча
       проглатывала и мусор, и любую новую причину, которую забыли
       сюда вписать: заказ отменялся, а причина в истории оказывалась
       чужой. */
    const prichina = zakazy.razobratPrichinu(f.get('prichina'));
    if (!prichina) return { oshibka: 'nelzyaSeychas' };
    const itog = zakazy.otmenit(db, id, kto, prichina);
    if (!itog.otmenen) {
      return { oshibka: itog.pochemu === 'net_pisma' ? 'nuzhnoPismo' : 'zakazZakryt' };
    }
    const svezhy = zakazy.po(db, id) as zakazy.Zakaz;
    await uvedom.cheloveku(
      l,
      z.tg_id,
      t.zakazOtmenen(svezhy, prichina, itog.vernuli, koshelek.balans(db, z.tg_id)),
    );
    return { ok: itog.vernuli > 0 ? 'otmenilDengi' : 'otmenil' };
  }

  void o;
  return { oshibka: 'nelzyaSeychas' };
}

// ── каталог ──────────────────────────────────────────────────────────

/** Цена: пустое поле — это «цены нет» (`null`), а не ноль. */
function cenaIzFormy(f: URLSearchParams, imya = 'cena'): number | null {
  const syroe = (f.get(imya) ?? '').trim().replace(',', '.');
  if (!syroe) return null;
  const rublei = Number(syroe);
  if (!Number.isFinite(rublei) || rublei < 0) return null;
  return Math.round(rublei * 100);
}

function deystvieKataloga(db: Lavka['db'], put: string, f: URLSearchParams): Itog {
  const prod = put.match(/^\/admin\/katalog\/produkt\/([A-Za-z0-9-]+)$/);
  if (prod) {
    const id = prod[1] as string;
    const skryt = f.get('skryt');
    if (skryt !== null) {
      bdKatalog.pravitProdukt(db, id, { skryt: skryt === '1' });
      return { ok: 'sohraneno' };
    }
    bdKatalog.pravitProdukt(db, id, {
      imya: (f.get('imya') ?? '').trim() || undefined,
      tagline: f.get('tagline') ?? undefined,
      note: f.get('note') ?? undefined,
      ...(f.has('cena') ? { cenaKop: cenaIzFormy(f) } : {}),
    });
    return { ok: 'sohraneno' };
  }

  if (put === `${KOREN}/katalog/produkt-novyy`) {
    const id = (f.get('id') ?? '').trim();
    const imya = (f.get('imya') ?? '').trim();
    if (!/^[a-z0-9-]{2,40}$/.test(id) || !imya) return { oshibka: 'neverniyId' };
    bdKatalog.sozdatProdukt(db, id, imya);
    return { ok: 'sohraneno' };
  }

  const ur = put.match(/^\/admin\/katalog\/uroven\/([A-Za-z0-9-]+)$/);
  if (ur) {
    bdKatalog.pravitUroven(db, ur[1] as string, { cenaKop: cenaIzFormy(f) });
    return { ok: 'sohraneno' };
  }

  const novy = put.match(/^\/admin\/katalog\/uroven-novyy\/([A-Za-z0-9-]+)$/);
  if (novy) {
    const short = (f.get('short') ?? '').trim();
    if (!short) return { oshibka: 'neverniyId' };
    bdKatalog.sozdatUroven(db, novy[1] as string, short);
    return { ok: 'sohraneno' };
  }

  return { oshibka: 'nelzyaSeychas' };
}
