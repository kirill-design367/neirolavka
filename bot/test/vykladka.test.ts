/**
 * Выкладка цен на сайт: от нажатия до витрины.
 *
 * Хранилище кода подставное, но код к нему ходит БОЕВОЙ: подменяется
 * ровно адрес API, как у подставного Telegram. Иначе проверка
 * доказывала бы свойства своей копии.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as vykladki from '../src/db/vykladki.js';
import * as bdKatalog from '../src/db/katalog.js';
import * as komanda from '../src/db/komanda.js';
import * as adminy from '../src/db/adminy.js';
import { podstavit, rashozhdenie, telo, zapustit, proverit } from '../src/admin/vykladka.js';
import { tarif } from '../src/lib/katalog.js';
import { podnyat } from './podstavnoe-hranilishche.js';
import type { PodstavnoeHranilishche } from './podstavnoe-hranilishche.js';
import type { Stend } from './stend.js';
import { stend, VLADELEC, ZHIVOY_PLAN } from './stend.js';

const KATALOG = readFileSync(new URL('../../../../src/lib/catalog.ts', import.meta.url), 'utf8');
const UDACHA = [{ path: '.github/workflows/deploy.yml', status: 'completed', conclusion: 'success' }];

/** Стенд вместе с подставным хранилищем. */
async function svyazka(): Promise<{ s: Stend; h: PodstavnoeHranilishche; zakryt: () => Promise<void> }> {
  const h = await podnyat(KATALOG);
  const s = await stend({
    NEIROLAVKA_API_HRANILISHCHA: h.adres,
    NEIROLAVKA_KLYUCH_HRANILISHCHA: 'kluch-dlya-proverki',
  });
  return { s, h, zakryt: async () => { await s.zakryt(); await h.stop(); } };
}

// ── то, что считается без сети ───────────────────────────────────────

test('панель пишет ДАННЫЕ: круг «прочитать — собрать — подставить» сходится', async () => {
  const s = await stend();
  try {
    // Файл сайта засеял базу, база собрала кусок обратно — и файл
    // не изменился ни на байт. Значит «выложить, ничего не поменяв»
    // честно ответит «на сайте уже такие же», а не отправит пустую
    // правку.
    assert.equal(podstavit(KATALOG, telo(s.l.db)), KATALOG);
  } finally {
    await s.zakryt();
  }
});

test('кусок каталога — это JSON, и апостроф в имени его не ломает', async () => {
  const s = await stend();
  try {
    const kogo = bdKatalog.produkty(s.l.db)[0]!.id;
    bdKatalog.pravitProdukt(s.l.db, kogo, { imya: "L'Oréal \"Про\"" });
    const kusok = telo(s.l.db);
    // Строка экранирована по правилам JSON: кавычки внутри имени
    // не закрывают строку. Прежняя выгрузка складывала имя в одинарные
    // кавычки без экранирования — и такое имя роняло сборку сайта.
    assert.ok(kusok.includes('"L\'Oréal \\"Про\\""'), 'имя не экранировано');
    const novyy = podstavit(KATALOG, kusok);
    // Разбираем получившееся как выражение: JSON.parse на самом теле.
    // Режем ровно между метками. Искать первое «products: » нельзя:
    // так называется и поле в объявлении типа, оно стоит выше.
    const m1 = novyy.indexOf('// ── НАЧАЛО ДАННЫХ ПАНЕЛИ ──');
    const m2 = novyy.indexOf('// ── КОНЕЦ ДАННЫХ ПАНЕЛИ ──');
    const a0 = novyy.indexOf('products: ', m1) + 'products: '.length;
    const razobrano = JSON.parse(novyy.slice(a0, novyy.lastIndexOf(']', m2) + 1)) as { name: string }[];
    assert.equal(razobrano[0]!.name, "L'Oréal \"Про\"");
  } finally {
    await s.zakryt();
  }
});

test('файл без меток не переписывается вслепую', async () => {
  const s = await stend();
  try {
    assert.throws(
      () => podstavit('файл, который правили руками', telo(s.l.db)),
      (e: Error) => /мет/i.test(e.message),
      'подстановка в файл без меток обязана отказать',
    );
  } finally {
    await s.zakryt();
  }
});

// ── расхождение ──────────────────────────────────────────────────────

test('расхождение видно: пока не выкладывали и когда цену поменяли', async () => {
  const { s, h, zakryt } = await svyazka();
  try {
    assert.deepEqual(rashozhdenie(s.l.db), { est: true, nikogda: true }, 'ни разу не выкладывали');

    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 149000 });
    h.progony = UDACHA;
    assert.equal((await zapustit(s.l, VLADELEC)).vid, 'poshla');
    await proverit(s.l);
    assert.deepEqual(rashozhdenie(s.l.db), { est: false, nikogda: false }, 'после выкладки цены совпадают');

    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 199000 });
    assert.deepEqual(rashozhdenie(s.l.db), { est: true, nikogda: false }, 'после правки цены разошлись');
  } finally {
    await zakryt();
  }
});

// ── удачный путь ─────────────────────────────────────────────────────

test('нажали — цены ушли в хранилище, сборка прошла, статус «выложено»', async () => {
  const { s, h, zakryt } = await svyazka();
  try {
    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 199000 });
    h.progony = [{ path: '.github/workflows/deploy.yml', status: 'in_progress', conclusion: null }];

    const itog = await zapustit(s.l, VLADELEC);
    assert.equal(itog.vid, 'poshla');
    assert.equal(h.zapisi.length, 1, 'в хранилище ушла ровно одна правка');
    assert.ok(h.zapisi[0]!.text.includes('1990'), 'новая цена не попала в файл');
    // Пока сборка идёт, выкладка не закрывается.
    await proverit(s.l);
    assert.equal(vykladki.idushchaya(s.l.db)?.status, 'idet');

    h.progony = UDACHA;
    await proverit(s.l);
    const v = vykladki.poslednyaya(s.l.db)!;
    assert.equal(v.status, 'vylozheno');
    assert.equal(v.kto, VLADELEC);
    assert.ok(v.zavershena, 'не отмечено время окончания');
    // И цена, которую увидит сайт, — та же, что в боте.
    assert.equal(tarif(s.l.db, ZHIVOY_PLAN)!.plan.priceRub, 1990);
  } finally {
    await zakryt();
  }
});

test('вторая выкладка поверх первой не начинается', async () => {
  const { s, h, zakryt } = await svyazka();
  try {
    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 100000 });
    h.progony = [{ path: '.github/workflows/deploy.yml', status: 'queued', conclusion: null }];
    assert.equal((await zapustit(s.l, VLADELEC)).vid, 'poshla');

    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 200000 });
    const vtoraya = await zapustit(s.l, VLADELEC);
    assert.equal(vtoraya.vid, 'uzhe_idet', 'вторая выкладка началась поверх первой');
    assert.equal(h.zapisi.length, 1, 'в хранилище ушла вторая правка');

    // И база держит это сама, а не только проверка в коде.
    assert.throws(
      () => s.l.db.prepare("INSERT INTO vykladki (status, otpechatok, nachata) VALUES ('idet','x','y')").run(),
      'индекс пустил вторую идущую выкладку',
    );
  } finally {
    await zakryt();
  }
});

test('ничего не менялось — отправлять нечего', async () => {
  const { s, h, zakryt } = await svyazka();
  try {
    const itog = await zapustit(s.l, VLADELEC);
    assert.equal(itog.vid, 'sovpadaet');
    assert.equal(h.zapisi.length, 0, 'ушла пустая правка');
    // Пустой правки не ушло, но совпадение записано: иначе указатель
    // расхождения и кнопка отвечали бы по-разному на один вопрос.
    assert.equal(vykladki.poslednyaya(s.l.db)!.status, 'vylozheno');
    assert.deepEqual(rashozhdenie(s.l.db), { est: false, nikogda: false });
  } finally {
    await zakryt();
  }
});

// ── отказы: человеческим языком ──────────────────────────────────────

const MASHINNOE = /pipeline|commit|workflow|repository|sha\b|api|token|http|\b4\d\d\b|\b5\d\d\b/i;

test('сборка не прошла — сказано по-человечески, без машинных слов', async () => {
  const { s, h, zakryt } = await svyazka();
  try {
    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 100000 });
    h.progony = [{ path: '.github/workflows/deploy.yml', status: 'completed', conclusion: 'failure' }];
    await zapustit(s.l, VLADELEC);
    await proverit(s.l);
    const v = vykladki.poslednyaya(s.l.db)!;
    assert.equal(v.status, 'ne_vyshlo');
    assert.ok(v.soobshchenie && v.soobshchenie.length > 10, 'сообщение пустое');
    assert.ok(!MASHINNOE.test(v.soobshchenie!), `в сообщении машинное слово: ${v.soobshchenie}`);
  } finally {
    await zakryt();
  }
});

test('нет ключа доступа — отказ понятный, и ничего не начато', async () => {
  const h = await podnyat(KATALOG);
  const s = await stend({ NEIROLAVKA_API_HRANILISHCHA: h.adres });
  try {
    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 100000 });
    const itog = await zapustit(s.l, VLADELEC);
    assert.equal(itog.vid, 'otkaz');
    const pochemu = itog.vid === 'otkaz' ? itog.pochemu : '';
    assert.ok(/ключ/i.test(pochemu), `ожидалось про ключ, а вышло: ${pochemu}`);
    assert.ok(!MASHINNOE.test(pochemu), `в отказе машинное слово: ${pochemu}`);
    assert.equal(vykladki.poslednyaya(s.l.db), null, 'выкладка завелась при отсутствии ключа');
  } finally {
    await s.zakryt();
    await h.stop();
  }
});

test('ключ не подошёл — отказ про ключ, а не про коды ответа', async () => {
  const { s, h, zakryt } = await svyazka();
  try {
    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 100000 });
    h.otvechat.chtenie = 401;
    const itog = await zapustit(s.l, VLADELEC);
    assert.equal(itog.vid, 'otkaz');
    const pochemu = itog.vid === 'otkaz' ? itog.pochemu : '';
    assert.ok(/ключ/i.test(pochemu), pochemu);
    assert.ok(!MASHINNOE.test(pochemu), `в отказе машинное слово: ${pochemu}`);
  } finally {
    await zakryt();
  }
});

test('файл успели изменить — просим нажать ещё раз, а не затираем чужое', async () => {
  const { s, h, zakryt } = await svyazka();
  try {
    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 100000 });
    h.otvechat.zapis = 409;
    const itog = await zapustit(s.l, VLADELEC);
    assert.equal(itog.vid, 'otkaz');
    const pochemu = itog.vid === 'otkaz' ? itog.pochemu : '';
    assert.ok(/ещё раз/i.test(pochemu), pochemu);
    // Строка выкладки при этом закрыта, а не висит «идёт».
    assert.equal(vykladki.idushchaya(s.l.db), null, 'выкладка осталась висеть');
    assert.equal(vykladki.poslednyaya(s.l.db)!.status, 'ne_vyshlo');
  } finally {
    await zakryt();
  }
});

test('сборка не отвечает слишком долго — выкладка закрывается сама', async () => {
  const { s, h, zakryt } = await svyazka();
  try {
    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 100000 });
    h.progony = [];
    await zapustit(s.l, VLADELEC);
    // Отматываем начало назад: человек не должен смотреть на вечное
    // «идёт», если сборка не появилась вовсе.
    const v = vykladki.idushchaya(s.l.db)!;
    s.l.db
      .prepare('UPDATE vykladki SET nachata = ? WHERE id = ?')
      .run(new Date(Date.now() - (vykladki.PREDEL_MINUT + 1) * 60_000).toISOString(), v.id);
    await proverit(s.l);
    const posle = vykladki.poslednyaya(s.l.db)!;
    assert.equal(posle.status, 'ne_vyshlo');
    assert.ok(!MASHINNOE.test(posle.soobshchenie ?? ''), posle.soobshchenie ?? '');
  } finally {
    await zakryt();
  }
});

// ── права ────────────────────────────────────────────────────────────

test('выкладку запускает только владелец: помощнику ни страницы, ни кнопки', async () => {
  const { s, h, zakryt } = await svyazka();
  try {
    const POMOSHNIK = 909;
    komanda.dobavit(s.l.db, POMOSHNIK, 'pomoshnik', 'Помощник', VLADELEC);
    adminy.zavesti(s.l.db, 'pom', 'ochen-dlinnyy-parol-1', POMOSHNIK);

    const kuki = new Map<string, string>();
    const zapros = async (put: string, dannye?: Record<string, string>) => {
      const o = await fetch(s.koren + put, {
        method: dannye ? 'POST' : 'GET',
        redirect: 'manual',
        headers: {
          ...(kuki.size ? { cookie: [...kuki].map(([a, b]) => `${a}=${b}`).join('; ') } : {}),
          ...(dannye ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: dannye ? new URLSearchParams(dannye).toString() : undefined,
      });
      for (const stroka of o.headers.getSetCookie()) {
        const [para] = stroka.split(';');
        const i = (para ?? '').indexOf('=');
        if (i > 0) kuki.set((para as string).slice(0, i), (para as string).slice(i + 1));
      }
      return { kod: o.status, telo: await o.text() };
    };

    assert.equal((await zapros('/admin/vhod', { login: 'pom', parol: 'ochen-dlinnyy-parol-1' })).kod, 303);
    const stranica = await zapros('/admin/vykladka');
    assert.equal(stranica.kod, 403, 'помощника пустили на страницу выкладки');

    const ochered = await zapros('/admin/ochered');
    assert.ok(!ochered.telo.includes('/admin/vykladka'), 'помощнику показали ссылку на выкладку');

    const zashchita = ochered.telo.match(/name="zashchita" value="([^"]+)"/)?.[1] ?? '';
    bdKatalog.pravitUroven(s.l.db, ZHIVOY_PLAN, { cenaKop: 100000 });
    await zapros('/admin/vykladka/vylozhit', { zashchita });
    assert.equal(h.zapisi.length, 0, 'помощник выложил цены на сайт');
    assert.equal(vykladki.poslednyaya(s.l.db), null, 'помощник завёл выкладку');
  } finally {
    await zakryt();
  }
});
