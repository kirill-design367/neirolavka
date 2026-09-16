/**
 * Переименование уровня подписки из панели.
 *
 * Владелец меняет подпись и полное название уровня; цена правится
 * той же формой. Главное требование здесь одно и оно про ИСТОРИЮ:
 * на уровень ссылаются заказы, и переименование не имеет права
 * их порвать.
 *
 * Держится это двумя разными вещами, и проверять надо обе:
 *
 *   • `urovni.id` при переименовании НЕ МЕНЯЕТСЯ — иначе
 *     `zakazy.plan_id` прошлых заказов ссылался бы в пустоту;
 *   • название уезжает в заказ СНИМКОМ (`zakazy.nazvanie`) — человек
 *     видит в «Моих заказах» то, что покупал, а не сегодняшнее имя.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adminy from '../src/db/adminy.js';
import * as zakazy from '../src/db/zakazy.js';
import * as lyudi from '../src/db/lyudi.js';
import * as bdKatalog from '../src/db/katalog.js';
import { tarif, vybor, nazvanieVybora } from '../src/lib/katalog.js';
import type { Stend } from './stend.js';
import { stend, POKUPATEL, VLADELEC, ZHIVOY_PLAN } from './stend.js';

const PAROL = 'ochen-dlinnyy-parol-1';

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
  async zashchita(put = '/admin/katalog'): Promise<string> {
    return (await this.get(put)).telo.match(/name="zashchita" value="([^"]+)"/)?.[1] ?? '';
  }
}

async function voyti(s: Stend): Promise<Klient> {
  adminy.zavesti(s.l.db, 'hozyain', PAROL, VLADELEC);
  const k = new Klient(s.koren);
  assert.equal((await k.post('/admin/vhod', { login: 'hozyain', parol: PAROL })).kod, 303);
  return k;
}

test('ПУТЬ ЦЕЛИКОМ: уровень переименован, а прошлый заказ цел', async () => {
  const s = await stend();
  try {
    lyudi.zapomnit(s.l.db, POKUPATEL, 'Pokupatel', null);
    const bylo = tarif(s.l.db, ZHIVOY_PLAN);
    assert.ok(bylo, 'живого уровня нет в каталоге');
    const staroeNazvanie = bylo!.plan.title;

    // Покупка ДО переименования: название уезжает в заказ снимком.
    const { zakaz } = zakazy.sozdatIliVernut(s.l.db, {
      tgId: POKUPATEL,
      produktId: bylo!.product.id,
      planId: ZHIVOY_PLAN,
      nazvanie: staroeNazvanie,
      cenaKop: 139900,
      mesyacev: 0,
      vidAkkaunta: 'novy',
    });

    const k = await voyti(s);
    const zashchita = await k.zashchita();
    const otvet = await k.post(`/admin/katalog/uroven/${ZHIVOY_PLAN}`, {
      zashchita,
      short: 'Premier',
      title: 'Ново назван, Premier',
      cena: '2490',
    });
    assert.equal(otvet.kod, 303);

    // Уровень переименован — и цена той же формой.
    const stalo = tarif(s.l.db, ZHIVOY_PLAN);
    assert.ok(stalo, 'уровень потерялся после переименования');
    assert.equal(stalo!.plan.short, 'Premier', 'короткая подпись не поменялась');
    assert.equal(stalo!.plan.title, 'Ново назван, Premier', 'полное название не поменялось');
    assert.equal(stalo!.plan.priceRub, 2490, 'цена той же формой не сохранилась');

    // ИДЕНТИФИКАТОР НЕ ТРОНУТ — на нём держится история.
    assert.equal(stalo!.plan.id, ZHIVOY_PLAN, 'идентификатор уровня поехал вслед за подписью');

    // Прошлый заказ ссылается туда же и помнит своё название.
    const z = zakazy.po(s.l.db, zakaz.id) as zakazy.Zakaz;
    assert.equal(z.plan_id, ZHIVOY_PLAN, 'заказ стал ссылаться в пустоту');
    assert.equal(z.nazvanie, staroeNazvanie, 'переименование переписало прошлый заказ');

    // И покупка по этому же идентификатору по-прежнему разбирается —
    // уже под новым именем.
    const v = vybor(s.l.db, ZHIVOY_PLAN);
    assert.ok(v, 'по идентификатору заказа уровень больше не находится');
    assert.equal(nazvanieVybora(v!), 'Ново назван, Premier');

    // Карточка заказа в панели открывается и показывает СНИМОК.
    const kart = await k.get(`/admin/zakaz/${zakaz.id}`);
    assert.equal(kart.kod, 200);
    assert.ok(kart.telo.includes(staroeNazvanie), `в карточке нет названия на момент покупки: ${kart.telo.slice(0, 400)}`);
  } finally {
    await s.zakryt();
  }
});

test('пустое название не сохраняется, и отказ виден на странице', async () => {
  const s = await stend();
  try {
    const k = await voyti(s);
    const zashchita = await k.zashchita();
    const bylo = tarif(s.l.db, ZHIVOY_PLAN)!.plan;

    const otvet = await k.post(`/admin/katalog/uroven/${ZHIVOY_PLAN}`, {
      zashchita,
      short: '  ',
      title: bylo.title,
      cena: '',
    });
    assert.equal(otvet.kod, 303);
    assert.match(otvet.mesto, /err=nazvaniePusto/, `отказ не назван: ${otvet.mesto}`);
    assert.equal(tarif(s.l.db, ZHIVOY_PLAN)!.plan.short, bylo.short, 'пустое название всё-таки записалось');

    /* ОТКАЗ ОБЯЗАН БЫТЬ ВИДЕН. Страница каталога не читала ни `ok`,
       ни `err` вовсе: панель отвечала переходом, а сообщение
       на экран не выводилось — отказ выглядел бы как сохранение. */
    const stranica = await k.get(otvet.mesto.replace('/admin', '/admin'));
    assert.ok(
      stranica.telo.includes('Название уровня не может быть пустым'),
      'страница каталога молчит об отказе',
    );
  } finally {
    await s.zakryt();
  }
});

test('переименование не мешает завести уровень с прежней подписью', async () => {
  const s = await stend();
  try {
    const k = await voyti(s);
    const zashchita = await k.zashchita();
    const produkt = tarif(s.l.db, ZHIVOY_PLAN)!.product.id;

    /* Идентификатор выводится из подписи, а при переименовании
       не меняется — значит подпись освобождается, а идентификатор
       нет. Заведение «Pro» после переименования «Pro» в «Premier»
       упиралось бы в первичный ключ и роняло бы панель пятисотым. */
    const podpis = tarif(s.l.db, ZHIVOY_PLAN)!.plan.short;
    await k.post(`/admin/katalog/uroven/${ZHIVOY_PLAN}`, {
      zashchita,
      short: 'Premier',
      title: 'Premier',
      cena: '',
    });
    const otvet = await k.post(`/admin/katalog/uroven-novyy/${produkt}`, { zashchita, short: podpis });
    assert.equal(otvet.kod, 303);
    assert.match(otvet.mesto, /ok=sohraneno/, `заведение уровня не прошло: ${otvet.mesto}`);

    const urovni = bdKatalog.produkt(s.l.db, produkt, true)!.plans;
    const svezhie = urovni.filter((u) => u.short === podpis);
    assert.equal(svezhie.length, 1, 'новый уровень не завёлся');
    assert.notEqual(svezhie[0]!.id, ZHIVOY_PLAN, 'новый уровень занял чужой идентификатор');
    assert.equal(new Set(urovni.map((u) => u.id)).size, urovni.length, 'идентификаторы уровней задвоились');
  } finally {
    await s.zakryt();
  }
});

test('подпись без латиницы даёт годный идентификатор, а не обрубок', async () => {
  const s = await stend();
  try {
    const produkt = tarif(s.l.db, ZHIVOY_PLAN)!.product.id;
    bdKatalog.sozdatUroven(s.l.db, produkt, 'Про');
    bdKatalog.sozdatUroven(s.l.db, produkt, 'Премьер');

    const urovni = bdKatalog.produkt(s.l.db, produkt, true)!.plans;
    const novye = urovni.filter((u) => u.short === 'Про' || u.short === 'Премьер');
    assert.equal(novye.length, 2, 'кириллические уровни не завелись');
    for (const u of novye) {
      assert.ok(!u.id.endsWith('-'), `идентификатор обрублен: ${u.id}`);
      assert.match(u.id, /^[a-z0-9-]+$/, `в идентификатор попала кириллица: ${u.id}`);
    }
    assert.equal(new Set(urovni.map((u) => u.id)).size, urovni.length, 'идентификаторы задвоились');
  } finally {
    await s.zakryt();
  }
});
