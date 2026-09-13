/**
 * Отзывы: база, раздел панели и дорога на сайт.
 *
 * Проверяется не «страница открылась», а четыре разных утверждения:
 *   1. отзывы засеялись из файла сайта и читаются в том же порядке;
 *   2. владелец их заводит, правит, переставляет и удаляет — НАСТОЯЩИМ
 *      http-запросом к тому же серверу, что работает в бою;
 *   3. помощнику раздел не отдаётся ни страницей, ни действием;
 *   4. правка отзыва разводит панель и сайт, а выкладка пишет отзывы
 *      в файл тем же куском, между теми же метками.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as adminy from '../src/db/adminy.js';
import * as komanda from '../src/db/komanda.js';
import * as bdOtzyvy from '../src/db/otzyvy.js';
import { podstavit, rashozhdenie, teloOtzyvov } from '../src/admin/vykladka.js';
import { getCatalog } from '../../src/lib/catalog.js';
import type { Stend } from './stend.js';
import { stend, VLADELEC } from './stend.js';

const PAROL = 'ochen-dlinnyy-parol-1';
const POMOSHNIK = 777;
const KATALOG = readFileSync(new URL('../../../../src/lib/catalog.ts', import.meta.url), 'utf8');

type Otvet = { kod: number; telo: string; mesto: string };

class Klient {
  private kuki = new Map<string, string>();
  constructor(private koren: string) {}
  private zapomnit(o: Response): void {
    for (const stroka of o.headers.getSetCookie()) {
      const [para] = stroka.split(';');
      const i = (para ?? '').indexOf('=');
      if (i > 0) this.kuki.set((para as string).slice(0, i), (para as string).slice(i + 1));
    }
  }
  private zagolovki(): Record<string, string> {
    const k = [...this.kuki].map(([a, b]) => `${a}=${b}`).join('; ');
    return k ? { cookie: k } : {};
  }
  async get(put: string): Promise<Otvet> {
    const o = await fetch(this.koren + put, { redirect: 'manual', headers: this.zagolovki() });
    this.zapomnit(o);
    return { kod: o.status, telo: await o.text(), mesto: o.headers.get('location') ?? '' };
  }
  async post(put: string, dannye: Record<string, string>): Promise<Otvet> {
    const o = await fetch(this.koren + put, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...this.zagolovki(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(dannye).toString(),
    });
    this.zapomnit(o);
    return { kod: o.status, telo: await o.text(), mesto: o.headers.get('location') ?? '' };
  }
  async zashchita(put = '/admin/ochered'): Promise<string> {
    const s = await this.get(put);
    return s.telo.match(/name="zashchita" value="([^"]+)"/)?.[1] ?? '';
  }
}

async function voyti(s: Stend, login = 'hozyain', tgId = VLADELEC): Promise<Klient> {
  adminy.zavesti(s.l.db, login, PAROL, tgId);
  const k = new Klient(s.koren);
  const o = await k.post('/admin/vhod', { login, parol: PAROL });
  assert.equal(o.kod, 303, 'вход не удался');
  return k;
}

test('отзывы засеяны из файла сайта — и в том же порядке', async () => {
  const s = await stend();
  try {
    const iz_fayla = getCatalog().reviews;
    assert.ok(iz_fayla.length > 0, 'в файле сайта не осталось ни одного отзыва');
    assert.deepEqual(bdOtzyvy.vse(s.l.db), iz_fayla, 'база и файл разошлись');
  } finally {
    await s.zakryt();
  }
});

test('владелец заводит, правит, переставляет и удаляет отзыв', async () => {
  const s = await stend();
  try {
    const k = await voyti(s);
    const bylo = bdOtzyvy.vse(s.l.db).length;
    const z = await k.zashchita('/admin/otzyvy');
    assert.ok(z, 'на странице отзывов нет токена защиты');

    // ── завести ──
    let o = await k.post('/admin/otzyv-novyy', {
      zashchita: z,
      avtor: 'Пробный',
      tovar: 'ChatGPT, Plus',
      text: 'Проба пера',
    });
    assert.equal(o.kod, 303);
    let spisok = bdOtzyvy.vse(s.l.db);
    assert.equal(spisok.length, bylo + 1, 'отзыв не завёлся');
    const novy = spisok[spisok.length - 1]!;
    assert.equal(novy.author, 'Пробный');
    assert.equal(novy.text, 'Проба пера');

    // Пустое имя или пустой текст — отказ, а не пустая карточка
    // на витрине.
    o = await k.post('/admin/otzyv-novyy', { zashchita: z, avtor: '  ', tovar: '', text: 'есть' });
    assert.ok(o.mesto.includes('err=otzyvPusto'), `пустое имя прошло: ${o.mesto}`);
    assert.equal(bdOtzyvy.vse(s.l.db).length, bylo + 1, 'пустой отзыв всё-таки завёлся');

    // ── поправить ──
    o = await k.post(`/admin/otzyv/${novy.id}`, {
      zashchita: z,
      avtor: 'Пробный',
      tovar: 'Claude Pro',
      text: 'Переписал',
    });
    assert.equal(o.kod, 303);
    assert.equal(bdOtzyvy.odin(s.l.db, novy.id)?.text, 'Переписал');
    assert.equal(bdOtzyvy.odin(s.l.db, novy.id)?.tovar, 'Claude Pro');

    // ── переставить: новый отзыв стоит последним, гоним его вверх ──
    const doPravki = bdOtzyvy.vse(s.l.db).map((x) => x.id);
    o = await k.post(`/admin/otzyv/${novy.id}/mesto`, { zashchita: z, kuda: 'vverh' });
    assert.equal(o.kod, 303);
    const posle = bdOtzyvy.vse(s.l.db).map((x) => x.id);
    assert.equal(posle.length, doPravki.length, 'перестановка потеряла отзыв');
    assert.equal(posle[posle.length - 2], novy.id, 'отзыв не поднялся на одно место');
    assert.equal(posle[posle.length - 1], doPravki[doPravki.length - 2], 'сосед не опустился');

    // Первый вверх не двигается, и это не отказ: кнопка у него
    // и так недоступна.
    assert.equal(bdOtzyvy.peredvinut(s.l.db, posle[0] as string, 'vverh'), false);

    // ── удалить ──
    o = await k.post(`/admin/otzyv/${novy.id}/udalit`, { zashchita: z });
    assert.ok(o.mesto.includes('ok=otzyvUdalen'), `удаление не сработало: ${o.mesto}`);
    assert.equal(bdOtzyvy.vse(s.l.db).length, bylo, 'отзыв не удалён');
    assert.equal(bdOtzyvy.odin(s.l.db, novy.id), null);
  } finally {
    await s.zakryt();
  }
});

test('помощнику отзывы не отдаются ни страницей, ни действием', async () => {
  const s = await stend();
  try {
    komanda.dobavit(s.l.db, POMOSHNIK, 'pomoshnik', 'Помощник', VLADELEC);
    const k = await voyti(s, 'pomoshnik', POMOSHNIK);
    const bylo = bdOtzyvy.vse(s.l.db).length;

    const stranica = await k.get('/admin/otzyvy');
    assert.equal(stranica.kod, 403, 'помощнику показали раздел отзывов');

    // СПРЯТАННАЯ СТРАНИЦА — ЭТО УДОБСТВО, защита — отказ на ДЕЙСТВИИ.
    const z = await k.zashchita();
    const o = await k.post('/admin/otzyv-novyy', {
      zashchita: z,
      avtor: 'Помощник',
      tovar: '',
      text: 'от себя',
    });
    assert.ok(o.mesto.includes('err=netPrav'), `действие прошло у помощника: ${o.mesto}`);
    assert.equal(bdOtzyvy.vse(s.l.db).length, bylo, 'помощник завёл отзыв');
  } finally {
    await s.zakryt();
  }
});

test('правка отзыва разводит панель и сайт, а выкладка пишет его в файл', async () => {
  const s = await stend();
  try {
    // Круг «файл → база → файл» сходится байт в байт и по отзывам:
    // это проверяется общей пробой в vykladka.test.ts, здесь — что
    // именно ОТЗЫВ попадает в файл и что его правка видна.
    const pervyy = bdOtzyvy.vse(s.l.db)[0]!;
    bdOtzyvy.pravit(s.l.db, pervyy.id, {
      avtor: 'Совсем другой человек',
      tovar: pervyy.bought,
      text: pervyy.text,
    });

    const kusok = teloOtzyvov(s.l.db);
    assert.ok(kusok.includes('НАЧАЛО ОТЗЫВОВ ПАНЕЛИ'), 'кусок без метки начала');
    assert.ok(kusok.includes('КОНЕЦ ОТЗЫВОВ ПАНЕЛИ'), 'кусок без метки конца');
    assert.ok(kusok.includes('"Совсем другой человек"'), 'правка не попала в кусок');

    const novyy = podstavit(KATALOG, s.l.db);
    assert.ok(novyy.includes('"Совсем другой человек"'), 'правка не попала в файл');
    assert.notEqual(novyy, KATALOG, 'файл не изменился, хотя отзыв поправили');

    // И расхождение видно на той же кнопке, что и по ценам.
    assert.equal(rashozhdenie(s.l.db).est, true, 'расхождение по отзывам не замечено');
  } finally {
    await s.zakryt();
  }
});
