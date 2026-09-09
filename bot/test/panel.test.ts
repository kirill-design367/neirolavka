/**
 * Панель: вход, права, защита от подделки запроса — и главное:
 * действия панели идут теми же переходами, что и действия бота.
 *
 * Проверка ходит НАСТОЯЩИМ http-запросом на тот же сервер, который
 * поднимается в бою: панель смонтирована внутри `sozdatServer`,
 * и проверять её мимо сервера значило бы проверять копию.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adminy from '../src/db/adminy.js';
import * as komanda from '../src/db/komanda.js';
import * as zakazy from '../src/db/zakazy.js';
import * as koshelek from '../src/db/koshelek.js';
import * as lyudi from '../src/db/lyudi.js';
import * as svoi from '../src/db/svoi.js';
import * as kody from '../src/db/kody.js';
import * as dostupy from '../src/db/dostupy.js';
import { tovary, tarif } from '../src/lib/katalog.js';
import { sleduyushchiyShag } from '../src/admin/stranicy.js';
import * as str from '../src/admin/stranicy.js';
import type { Stend } from './stend.js';
import { stend, POKUPATEL, VLADELEC, ZHIVOY_PLAN } from './stend.js';

const PAROL = 'ochen-dlinnyy-parol-1';
const POMOSHNIK = 777;

type Otvet = { kod: number; telo: string; mesto: string };

/** Клиент с памятью о куках — иначе сессии не бывает. */
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

  /** Токен защиты со страницы: без него панель форму не принимает. */
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

/** Заказ на новый аккаунт, оплаченный, в очереди. */
function zakaz(s: Stend, vid: 'novy' | 'svoy' = 'novy'): zakazy.Zakaz {
  lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
  const t = tarif(s.l.db, ZHIVOY_PLAN);
  assert.ok(t, 'уровень подписки из каталога');
  const { zakaz: z } = zakazy.sozdatIliVernut(s.l.db, {
    tgId: POKUPATEL,
    produktId: t!.product.id,
    planId: t!.plan.id,
    nazvanie: `${t!.product.name} · ${t!.plan.title}`,
    cenaKop: 100_000,
    mesyacev: 0,
    vidAkkaunta: vid,
  });
  return z;
}

// ── пароли и перебор ─────────────────────────────────────────────────

test('пароль в базе не лежит открытым, а сравнение переживает подмену', async () => {
  const s = await stend();
  try {
    adminy.zavesti(s.l.db, 'hozyain', PAROL, VLADELEC);
    const zapis = JSON.stringify(s.l.db.prepare('SELECT * FROM admin_uchetki').all());
    assert.ok(!zapis.includes(PAROL), 'пароль лежит в базе открытым');
    const u = adminy.uchetka(s.l.db, 'hozyain');
    assert.ok(adminy.parolPodhodit(PAROL, u!.parol_hash), 'верный пароль не подошёл');
    assert.ok(!adminy.parolPodhodit(PAROL + 'x', u!.parol_hash), 'подошёл неверный пароль');
    // Один и тот же пароль даёт разные записи: соль своя у каждой.
    assert.notEqual(adminy.zashifrovatParol(PAROL), adminy.zashifrovatParol(PAROL));
  } finally {
    await s.zakryt();
  }
});

test('перебор запирается, и верный пароль в запертую минуту тоже не пускает', async () => {
  const s = await stend();
  try {
    adminy.zavesti(s.l.db, 'hozyain', PAROL, VLADELEC);
    const k = new Klient(s.koren);
    for (let i = 0; i < adminy.NEUDACH_DO_ZAMKA; i++) {
      const o = await k.post('/admin/vhod', { login: 'hozyain', parol: 'ne-tot' });
      assert.equal(o.kod, 401);
    }
    const posle = await k.post('/admin/vhod', { login: 'hozyain', parol: PAROL });
    assert.equal(posle.kod, 429, 'запертая учётка пустила по верному паролю');

    // Пауза удваивается, а не стоит на месте.
    const pervaya = adminy.zamok(s.l.db, 'hozyain').doMs;
    const vtoraya = adminy.otmetitNeudachu(s.l.db, 'hozyain').doMs;
    assert.ok(vtoraya > pervaya, 'пауза после лишней неудачи не выросла');
  } finally {
    await s.zakryt();
  }
});

test('сессия живёт от последнего действия и протухает', async () => {
  const s = await stend();
  try {
    adminy.zavesti(s.l.db, 'hozyain', PAROL, VLADELEC);
    const nachalo = Date.now();
    const { token } = adminy.nachatSessiyu(s.l.db, 'hozyain', nachalo);
    // В базе — отпечаток, а не токен: утёкшая база не даёт войти.
    const syroe = JSON.stringify(s.l.db.prepare('SELECT * FROM admin_sessii').all());
    assert.ok(!syroe.includes(token), 'токен сессии лежит в базе как есть');

    const cherezChas = nachalo + 3_600_000;
    assert.ok(adminy.sessiya(s.l.db, token, cherezChas), 'живая сессия не нашлась');
    // Действие через час продлило срок: следующие семь часов ещё наши.
    assert.ok(
      adminy.sessiya(s.l.db, token, cherezChas + adminy.SROK_SESSII_MS - 1000),
      'скользящий срок не продлился',
    );
    assert.equal(
      adminy.sessiya(s.l.db, token, cherezChas + adminy.SROK_SESSII_MS * 2),
      null,
      'протухшая сессия всё ещё пускает',
    );
  } finally {
    await s.zakryt();
  }
});

// ── вход и права ─────────────────────────────────────────────────────

test('без входа панели не видно, а вход открывает очередь', async () => {
  const s = await stend();
  try {
    const z = zakaz(s);
    const chuzhoy = new Klient(s.koren);
    const zakryto = await chuzhoy.get('/admin/ochered');
    assert.equal(zakryto.kod, 401);
    assert.ok(!zakryto.telo.includes(`№ ${z.id}`), 'заказ виден без входа');
    assert.ok(zakryto.telo.includes('name="parol"'), 'вместо панели должна быть страница входа');

    const k = await voyti(s);
    const ochered = await k.get('/admin/ochered');
    assert.equal(ochered.kod, 200);
    assert.ok(ochered.telo.includes(`№ ${z.id}`), 'заказа нет в очереди');
    assert.ok(ochered.telo.includes('Ждут оплаты'), 'заказ не попал в группу своего шага');
  } finally {
    await s.zakryt();
  }
});

test('помощник видит заказы и не видит людей, каталог и статистику', async () => {
  const s = await stend();
  try {
    komanda.dobavit(s.l.db, POMOSHNIK, 'pomoshnik', 'Помощник', VLADELEC);
    const k = await voyti(s, 'pomoshnik', POMOSHNIK);
    const ochered = await k.get('/admin/ochered');
    assert.equal(ochered.kod, 200, 'помощника не пустили в очередь');
    assert.ok(!ochered.telo.includes('/admin/katalog'), 'помощнику показали ссылку на каталог');

    for (const put of ['/admin/pokupateli', '/admin/katalog', '/admin/statistika', `/admin/pokupatel/${POKUPATEL}`]) {
      assert.equal((await k.get(put)).kod, 403, `помощника пустили в ${put}`);
    }
    // И действие с деньгами ему тоже недоступно — не только страница.
    lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
    await k.post(`/admin/pokupatel/${POKUPATEL}/popolnit`, {
      zashchita: await k.zashchita(),
      rubli: '1000',
    });
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 0, 'помощник пополнил чужой баланс');
  } finally {
    await s.zakryt();
  }
});

test('форма без токена защиты ничего не делает', async () => {
  const s = await stend();
  try {
    const z = zakaz(s);
    const k = await voyti(s);
    const bez = await k.post(`/admin/zakaz/${z.id}/oplata`, {});
    assert.equal(bez.kod, 303);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'zhdet_oplaty', 'подделанная форма прошла');

    const chuzhoy = await k.post(`/admin/zakaz/${z.id}/oplata`, { zashchita: 'ne-tot-token' });
    assert.equal(chuzhoy.kod, 303);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'zhdet_oplaty', 'чужой токен прошёл');

    const svoy = await k.post(`/admin/zakaz/${z.id}/oplata`, { zashchita: await k.zashchita() });
    assert.equal(svoy.kod, 303);
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'oplachen', 'своя форма не сработала');
  } finally {
    await s.zakryt();
  }
});

// ── действия идут теми же переходами, что у бота ──────────────────────

test('оплата, работа, выдача — переходы те же, покупателю пишут', async () => {
  const s = await stend();
  try {
    const z = zakaz(s);
    const k = await voyti(s);
    const zashchita = await k.zashchita();

    await k.post(`/admin/zakaz/${z.id}/oplata`, { zashchita });
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'oplachen');
    assert.ok(zakazy.po(s.l.db, z.id)!.srok_do, 'обещанный срок не поставлен');

    await k.post(`/admin/zakaz/${z.id}/vzyat`, { zashchita });
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'v_rabote');
    assert.equal(zakazy.po(s.l.db, z.id)!.ispolnitel, VLADELEC);

    await k.post(`/admin/zakaz/${z.id}/dostup`, {
      zashchita,
      login: 'vydannyy@example.com',
      parol: 'parol-dostupa-999',
      zametka: 'Не меняйте пароль сутки.',
    });
    assert.ok(dostupy.est(s.l.db, z.id), 'доступ не записан');
    const syroe = JSON.stringify(s.l.db.prepare('SELECT * FROM dostupy').all());
    assert.ok(!syroe.includes('parol-dostupa-999'), 'пароль доступа лежит открытым');
    assert.notEqual(zakazy.po(s.l.db, z.id)!.status, 'vydan', 'запись доступа сама выдала заказ');

    const bylo = s.tg.vyzovy.length;
    await k.post(`/admin/zakaz/${z.id}/otpravit`, { zashchita });
    assert.equal(zakazy.po(s.l.db, z.id)!.status, 'vydan');
    const pokupatelyu = s.tg.vyzovy
      .slice(bylo)
      .filter((v) => v.metod === 'sendMessage' && v.telo['chat_id'] === POKUPATEL)
      .map((v) => String(v.telo['text'] ?? ''))
      .join('\n');
    assert.ok(pokupatelyu.includes('parol-dostupa-999'), 'покупателю не ушёл пароль');
  } finally {
    await s.zakryt();
  }
});

test('недоставленный доступ не отмечается выданным', async () => {
  const s = await stend();
  try {
    const z = zakaz(s);
    const k = await voyti(s);
    const zashchita = await k.zashchita();
    await k.post(`/admin/zakaz/${z.id}/oplata`, { zashchita });
    await k.post(`/admin/zakaz/${z.id}/vzyat`, { zashchita });
    await k.post(`/admin/zakaz/${z.id}/dostup`, { zashchita, login: 'a@b.c', parol: 'parol-dostupa-999' });

    // Покупатель заблокировал бота ровно между записью и отправкой.
    s.tg.otvechat = (metod, telo) =>
      metod === 'sendMessage' && telo['chat_id'] === POKUPATEL
        ? { vid: 'oshibka', kod: 403, opisanie: 'Forbidden: bot was blocked by the user' }
        : { vid: 'ok' };

    await k.post(`/admin/zakaz/${z.id}/otpravit`, { zashchita });
    assert.notEqual(zakazy.po(s.l.db, z.id)!.status, 'vydan', 'заказ закрыт при недоставленном доступе');
    const sobytiya = zakazy.sobytiya(s.l.db, z.id).map((e) => e.chto).join('\n');
    assert.ok(sobytiya.includes('не доставлен'), 'недоставка не записана в события');
  } finally {
    await s.zakryt();
  }
});

test('код: один разговор на человека, и код виден только по нажатию', async () => {
  const s = await stend();
  try {
    const pervyy = zakaz(s, 'svoy');
    const k = await voyti(s);
    const zashchita = await k.zashchita();
    svoi.polozhit(s.l.db, pervyy.id, 'pochta@example.com', 'parol-pokupatelya', s.l.n.klyuchDostupov);
    await k.post(`/admin/zakaz/${pervyy.id}/oplata`, { zashchita });
    await k.post(`/admin/zakaz/${pervyy.id}/vzyat`, { zashchita });
    await k.post(`/admin/zakaz/${pervyy.id}/kod`, { zashchita });
    assert.equal(zakazy.po(s.l.db, pervyy.id)!.status, 'zhdem_kod');

    // Второй заказ того же человека код запросить не может.
    const vtoroy = zakazy.sozdatIliVernut(s.l.db, {
      tgId: POKUPATEL,
      produktId: 'proba',
      planId: 'proba-vtoroy',
      nazvanie: 'Второй заказ',
      cenaKop: 100,
      mesyacev: 0,
      vidAkkaunta: 'svoy',
    }).zakaz;
    zakazy.otmetitOplachennym(s.l.db, vtoroy.id, new Date(Date.now() + 3_600_000), VLADELEC);
    zakazy.vzyat(s.l.db, vtoroy.id, VLADELEC);
    const otkaz = await k.post(`/admin/zakaz/${vtoroy.id}/kod`, { zashchita });
    assert.ok(otkaz.mesto.includes('uzheVvoditKod'), `ожидался отказ, а вышло ${otkaz.mesto}`);
    assert.notEqual(zakazy.po(s.l.db, vtoroy.id)!.status, 'zhdem_kod', 'второй разговор о коде начался');

    // Код пришёл — панель показывает его только по нажатию.
    kody.zapisat(s.l.db, pervyy.id, '314159', s.l.n.klyuchDostupov);
    const karta = await k.get(`/admin/zakaz/${pervyy.id}`);
    assert.ok(!karta.telo.includes('314159'), 'код виден на странице без нажатия');
    const pokaz = await k.post(`/admin/zakaz/${pervyy.id}/kod-pokazat`, { zashchita });
    assert.ok(pokaz.telo.includes('314159'), 'код не показался по нажатию');
    assert.ok(!pokaz.telo.includes('parol-pokupatelya'), 'вместе с кодом показался пароль аккаунта');
  } finally {
    await s.zakryt();
  }
});

test('замок на письмо работает и из панели', async () => {
  const s = await stend();
  try {
    const z = zakaz(s, 'svoy');
    const k = await voyti(s);
    const zashchita = await k.zashchita();
    await k.post(`/admin/zakaz/${z.id}/oplata`, { zashchita });
    await k.post(`/admin/zakaz/${z.id}/vzyat`, { zashchita });

    const rano = await k.post(`/admin/zakaz/${z.id}/otmena`, { zashchita, prichina: 'nevernyy_parol' });
    assert.ok(rano.mesto.includes('nuzhnoPismo'), `ожидался отказ по письму, а вышло ${rano.mesto}`);
    assert.notEqual(zakazy.po(s.l.db, z.id)!.status, 'otmenen', 'отменили до письма');

    // У заказа на НОВЫЙ аккаунт этой причины нет вовсе: пароля
    // покупателя там не существует, и письмо восстановления посылать
    // нечему.
    const novyy = zakazy.sozdatIliVernut(s.l.db, {
      tgId: POKUPATEL,
      produktId: 'proba',
      planId: 'proba-novyy',
      nazvanie: 'Заказ на новый аккаунт',
      cenaKop: 100,
      mesyacev: 0,
      vidAkkaunta: 'novy',
    }).zakaz;
    const kartochkaNovogo = await k.get(`/admin/zakaz/${novyy.id}`);
    assert.ok(
      !kartochkaNovogo.telo.includes('nevernyy_parol'),
      'у заказа на новый аккаунт предлагают отмену по неверному паролю',
    );

    await k.post(`/admin/zakaz/${z.id}/pismo`, { zashchita });
    assert.ok(zakazy.po(s.l.db, z.id)!.pismo_v, 'письмо не отмечено');
    const posle = await k.post(`/admin/zakaz/${z.id}/otmena`, { zashchita, prichina: 'nevernyy_parol' });
    assert.equal(posle.kod, 303);
    const itog = zakazy.po(s.l.db, z.id)!;
    assert.equal(itog.status, 'otmenen');
    assert.equal(itog.prichina_otmeny, 'nevernyy_parol');
    // Деньги вернулись на баланс той же транзакцией, что и отмена.
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 100_000, 'деньги не вернулись на баланс');
  } finally {
    await s.zakryt();
  }
});

test('владелец пополняет баланс, и покупателю об этом пишут', async () => {
  const s = await stend();
  try {
    lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
    const k = await voyti(s);
    const bylo = s.tg.vyzovy.length;
    await k.post(`/admin/pokupatel/${POKUPATEL}/popolnit`, {
      zashchita: await k.zashchita(`/admin/pokupatel/${POKUPATEL}`),
      rubli: '1500',
    });
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 150_000);
    const emu = s.tg.vyzovy
      .slice(bylo)
      .filter((v) => v.metod === 'sendMessage' && v.telo['chat_id'] === POKUPATEL);
    assert.equal(emu.length, 1, 'покупателю не сообщили о пополнении');
  } finally {
    await s.zakryt();
  }
});

// ── каталог ──────────────────────────────────────────────────────────

test('цена, поставленная в панели, тут же видна боту', async () => {
  const s = await stend();
  try {
    const k = await voyti(s);
    const zashchita = await k.zashchita('/admin/katalog');
    const do_ = tarif(s.l.db, ZHIVOY_PLAN);
    assert.equal(do_!.plan.priceRub, null, 'у уровня уже стоит цена — проверка мерит не то');

    await k.post(`/admin/katalog/uroven/${ZHIVOY_PLAN}`, { zashchita, cena: '1990' });
    assert.equal(tarif(s.l.db, ZHIVOY_PLAN)!.plan.priceRub, 1990, 'бот не увидел новую цену');

    // Пустое поле — это «цены нет», а не ноль: ноль читался бы
    // как «бесплатно».
    await k.post(`/admin/katalog/uroven/${ZHIVOY_PLAN}`, { zashchita, cena: '' });
    assert.equal(tarif(s.l.db, ZHIVOY_PLAN)!.plan.priceRub, null, 'пустая цена стала нулём');

    // Спрятанный продукт исчезает из витрины бота, но не из базы.
    const bylo = tovary(s.l.db).length;
    const kogo = tovary(s.l.db)[0]!.id;
    await k.post(`/admin/katalog/produkt/${kogo}`, { zashchita, skryt: '1' });
    assert.equal(tovary(s.l.db).length, bylo - 1, 'продукт не спрятался');
    await k.post(`/admin/katalog/produkt/${kogo}`, { zashchita, skryt: '0' });
    assert.equal(tovary(s.l.db).length, bylo, 'продукт не вернулся');
  } finally {
    await s.zakryt();
  }
});

// ── мелочи, которые дороже, чем кажутся ──────────────────────────────

test('следующий шаг считается один раз и не выдумывает работу', async () => {
  const pusto = { estDostup: false, estKod: false, estAkkaunt: false };
  const osnova = { status: 'zhdet_oplaty', vid_akkaunta: 'novy' } as zakazy.Zakaz;
  assert.equal(sleduyushchiyShag(osnova, pusto), 'oplata');
  assert.equal(sleduyushchiyShag({ ...osnova, status: 'oplachen' }, pusto), 'vzyat');
  assert.equal(sleduyushchiyShag({ ...osnova, status: 'v_rabote' }, pusto), 'dostup');
  assert.equal(
    sleduyushchiyShag({ ...osnova, status: 'v_rabote', vid_akkaunta: 'svoy' }, pusto),
    'kod',
    'у своего аккаунта сначала код',
  );
  assert.equal(
    sleduyushchiyShag({ ...osnova, status: 'kod_poluchen', vid_akkaunta: 'svoy' }, { ...pusto, estKod: true }),
    'dostup',
  );
  assert.equal(
    sleduyushchiyShag({ ...osnova, status: 'v_rabote' }, { ...pusto, estDostup: true }),
    'otpravit',
  );
  assert.equal(sleduyushchiyShag({ ...osnova, status: 'vydan' }, { ...pusto, estDostup: true }), 'nichego');
  assert.equal(sleduyushchiyShag({ ...osnova, status: 'otmenen' }, pusto), 'nichego');
});

test('чужое имя не становится разметкой на странице панели', async () => {
  const s = await stend();
  try {
    zakaz(s);
    // Имя ставим ПОСЛЕ заказа: заготовка заказа зовёт `zapomnit` сама
    // и затёрла бы подставленное.
    lyudi.zapomnit(s.l.db, POKUPATEL, '<img src=x onerror=alert(1)>', null);
    const k = await voyti(s);
    const o = await k.get('/admin/ochered');
    assert.ok(!o.telo.includes('<img src=x'), 'имя ушло на страницу как разметка');
    assert.ok(o.telo.includes('&lt;img src=x'), 'имя не показалось вовсе — экранирование съело строку');
  } finally {
    await s.zakryt();
  }
});

test('панель отвечает на двух языках и помнит выбор', async () => {
  const s = await stend();
  try {
    // Заказ нужен: у пустой очереди нет шапки таблицы, и проверка
    // перевода мерила бы отсутствие строки, а не перевод.
    zakaz(s);
    const k = await voyti(s);
    const ru = await k.get('/admin/ochered');
    assert.ok(ru.telo.includes('Очередь'), 'по умолчанию не русский');

    const smena = await k.get('/admin/yazyk?na=en&nazad=%2Fadmin%2Fochered');
    assert.equal(smena.kod, 303);
    const en = await k.get('/admin/ochered');
    assert.ok(en.telo.includes('Queue'), 'английский не включился');
    assert.ok(en.telo.includes('Awaiting payment'), 'название группы осталось непереведённым');
    assert.ok(en.telo.includes('lang="en"'), 'язык страницы не объявлен');

    // Дата в английской панели не остаётся русской: «9 сентября»
    // посреди английской страницы — это недоделка, а не перевод.
    const nomer = zakazy.ochered(s.l.db)[0] ?? zakazy.neoplachennye(s.l.db)[0];
    const kartochka = await k.get(`/admin/zakaz/${nomer!.id}`);
    assert.ok(!/сентября|января|мая/.test(kartochka.telo), 'дата осталась по-русски');
    assert.ok(/\d{1,2}\s[A-Z][a-z]{2}/.test(kartochka.telo), 'дата не отформатирована по-английски');

    // Возврат уводит только внутрь панели: чужой адрес в «nazad»
    // сделал бы из ссылки на панель приманку.
    const chuzhoy = await k.get('/admin/yazyk?na=ru&nazad=https%3A%2F%2Fzloy.example');
    assert.ok(!chuzhoy.mesto.startsWith('http'), `увели наружу: ${chuzhoy.mesto}`);
  } finally {
    await s.zakryt();
  }
});

test('страницы панели не кешируются и не встают в чужую рамку', async () => {
  const s = await stend();
  try {
    const k = await voyti(s);
    const o = await fetch(`${s.koren}/admin/vhod`, { method: 'POST', redirect: 'manual', body: '' });
    assert.equal(o.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
    assert.equal(o.headers.get('x-frame-options'), 'DENY');
    assert.ok((o.headers.get('content-security-policy') ?? '').includes("script-src 'none'"));
    await o.text();
    void k;
  } finally {
    await s.zakryt();
  }
});

// ── очередь: группы, свёртывание, сортировка ─────────────────────────

/** Заказ с заданным товаром, ценой и возрастом — для рядов и групп. */
function zakazNa(
  s: Stend,
  tgId: number,
  planId: string,
  cenaKop: number,
  minutNazad = 0,
  vid: 'novy' | 'svoy' = 'novy',
): zakazy.Zakaz {
  lyudi.zapomnit(s.l.db, tgId, `Человек ${tgId}`, null);
  const { zakaz: z } = zakazy.sozdatIliVernut(s.l.db, {
    tgId,
    produktId: 'proba',
    planId,
    nazvanie: `Проба ${planId}`,
    cenaKop,
    mesyacev: 0,
    vidAkkaunta: vid,
  });
  if (minutNazad) {
    s.l.db
      .prepare('UPDATE zakazy SET sozdan = ? WHERE id = ?')
      .run(new Date(Date.now() - minutNazad * 60_000).toISOString(), z.id);
  }
  return zakazy.po(s.l.db, z.id) as zakazy.Zakaz;
}

/** Номера заказов в том порядке, в каком они стоят на странице. */
function poryadokNaStranice(telo: string): number[] {
  return [...telo.matchAll(/№&nbsp;(\d+)|№ (\d+)/g)].map((m) => Number(m[1] ?? m[2]));
}

test('очередь разложена по группам, и в шапке группы стоит её счёт', async () => {
  const s = await stend();
  try {
    const k = await voyti(s);
    const zashchita = await k.zashchita();

    const zhdetOplaty = zakazNa(s, 601, 'proba-a', 100_000);
    const gotovVzyat = zakazNa(s, 602, 'proba-b', 200_000);
    await k.post(`/admin/zakaz/${gotovVzyat.id}/oplata`, { zashchita });
    const nuzhenDostup = zakazNa(s, 603, 'proba-c', 300_000);
    await k.post(`/admin/zakaz/${nuzhenDostup.id}/oplata`, { zashchita });
    await k.post(`/admin/zakaz/${nuzhenDostup.id}/vzyat`, { zashchita });
    const gotovOtpravit = zakazNa(s, 604, 'proba-d', 400_000);
    await k.post(`/admin/zakaz/${gotovOtpravit.id}/oplata`, { zashchita });
    await k.post(`/admin/zakaz/${gotovOtpravit.id}/vzyat`, { zashchita });
    await k.post(`/admin/zakaz/${gotovOtpravit.id}/dostup`, { zashchita, login: 'a@b.c', parol: 'parol-999' });

    const o = await k.get('/admin/ochered');
    // Каждая группа знает своё число: четыре заказа в четырёх разных.
    for (const imya of ['Готовы к выдаче', 'Нужно записать доступ', 'Готовы взять в работу', 'Ждут оплаты']) {
      assert.ok(o.telo.includes(imya), `нет группы «${imya}»`);
    }
    assert.ok(o.telo.includes('Ждём код от покупателя'), 'пустая группа исчезла со страницы');

    // Порядок групп: сначала то, что можно доделать сейчас.
    const mesta = ['Готовы к выдаче', 'Нужно записать доступ', 'Нужно запросить код', 'Готовы взять в работу', 'Ждут оплаты']
      .map((imya) => o.telo.indexOf(imya));
    assert.deepEqual([...mesta].sort((a, b) => a - b), mesta, 'группы стоят не в том порядке');

    // И заказы разложены по группам, а не свалены в одну таблицу:
    // «готов к выдаче» стоит на странице раньше «ждёт оплаты».
    assert.ok(
      o.telo.indexOf(`№ ${gotovOtpravit.id}`) < o.telo.indexOf(`№ ${zhdetOplaty.id}`),
      'заказ к выдаче оказался ниже ждущего оплаты',
    );
  } finally {
    await s.zakryt();
  }
});

test('свёрнутая группа остаётся свёрнутой после обновления страницы', async () => {
  const s = await stend();
  try {
    const z = zakazNa(s, 605, 'proba-e', 100_000);
    const k = await voyti(s);
    assert.ok((await k.get('/admin/ochered')).telo.includes(`№ ${z.id}`), 'заказа нет в развёрнутой группе');

    const svernul = await k.get('/admin/ochered/svernut?g=oplata&sort=zhdet&napr=ubyv');
    assert.equal(svernul.kod, 303, 'переключатель не увёл обратно на очередь');

    const posle = await k.get('/admin/ochered');
    assert.ok(!posle.telo.includes(`№ ${z.id}`), 'группа не свернулась');
    assert.ok(posle.telo.includes('Ждут оплаты'), 'вместе с группой пропала её шапка');
    // Ровно то, ради чего состояние живёт в куке: страница сама
    // обновляется раз в 30 секунд, и повторный заход не должен
    // разворачивать группу обратно.
    const eshcheRaz = await k.get('/admin/ochered');
    assert.ok(!eshcheRaz.telo.includes(`№ ${z.id}`), 'при обновлении группа развернулась сама');

    const razvernul = await k.get('/admin/ochered/svernut?g=oplata&sort=zhdet&napr=ubyv');
    assert.equal(razvernul.kod, 303);
    assert.ok((await k.get('/admin/ochered')).telo.includes(`№ ${z.id}`), 'группа не развернулась обратно');
  } finally {
    await s.zakryt();
  }
});

test('сортировка очереди работает в обе стороны и по обеим меркам', async () => {
  const s = await stend();
  try {
    // Три заказа в одной группе: разный возраст и разная цена.
    const staryy = zakazNa(s, 611, 'proba-s', 100_000, 300);
    const sredniy = zakazNa(s, 612, 'proba-m', 900_000, 120);
    const svezhiy = zakazNa(s, 613, 'proba-n', 500_000, 5);
    const bezCeny = zakazNa(s, 614, 'proba-z', 0, 60);
    const k = await voyti(s);

    const dolshe = poryadokNaStranice((await k.get('/admin/ochered?sort=zhdet&napr=ubyv')).telo);
    assert.deepEqual(dolshe, [staryy.id, sredniy.id, bezCeny.id, svezhiy.id], 'по убыванию ожидания не тот ряд');

    const menshe = poryadokNaStranice((await k.get('/admin/ochered?sort=zhdet&napr=vozr')).telo);
    assert.deepEqual(menshe, [svezhiy.id, bezCeny.id, sredniy.id, staryy.id], 'по возрастанию ожидания не тот ряд');

    const dorogie = poryadokNaStranice((await k.get('/admin/ochered?sort=summa&napr=ubyv')).telo);
    assert.deepEqual(dorogie, [sredniy.id, svezhiy.id, staryy.id, bezCeny.id], 'по убыванию суммы не тот ряд');

    const deshevye = poryadokNaStranice((await k.get('/admin/ochered?sort=summa&napr=vozr')).telo);
    // Заказ без объявленной цены уезжает вниз при ОБЕИХ сторонах:
    // ноль в базе значит «неизвестно», а не «самый дешёвый».
    assert.deepEqual(deshevye, [staryy.id, svezhiy.id, sredniy.id, bezCeny.id], 'по возрастанию суммы не тот ряд');
  } finally {
    await s.zakryt();
  }
});

// ── покупатели: сводка и отбор ───────────────────────────────────────

test('сводка покупателей считает по дню появления', async () => {
  const s = await stend();
  try {
    const davno = (dney: number) => new Date(Date.now() - dney * 24 * 3600_000).toISOString();
    lyudi.zapomnit(s.l.db, 701, 'Свежий', null);
    lyudi.zapomnit(s.l.db, 702, 'Месячный', null);
    lyudi.zapomnit(s.l.db, 703, 'Годовалый', null);
    lyudi.zapomnit(s.l.db, 704, 'Древний', null);
    s.l.db.prepare('UPDATE lyudi SET vpervye = ? WHERE tg_id = ?').run(davno(20), 702);
    s.l.db.prepare('UPDATE lyudi SET vpervye = ? WHERE tg_id = ?').run(davno(200), 703);
    s.l.db.prepare('UPDATE lyudi SET vpervye = ? WHERE tg_id = ?').run(davno(800), 704);

    const sv = lyudi.svodka(s.l.db);
    assert.equal(sv.vsego, 4);
    assert.equal(sv.zaNedelyu, 1, 'за неделю');
    assert.equal(sv.zaMesyac, 2, 'за месяц');
    assert.equal(sv.zaGod, 3, 'за год');

    const k = await voyti(s);
    const o = await k.get('/admin/pokupateli');
    assert.ok(o.telo.includes('Всего покупателей'), 'сводки нет на странице');
  } finally {
    await s.zakryt();
  }
});

test('поиск находит человека по имени в другом регистре, по username и по id', async () => {
  const s = await stend();
  try {
    lyudi.zapomnit(s.l.db, 711, 'Анна', 'anna_k');
    lyudi.zapomnit(s.l.db, 712, 'Дмитрий', null);
    const k = await voyti(s);

    // Регистр кириллицы: LIKE и lower() в SQLite его не приводят,
    // ради этого поиск и вынесен в JavaScript.
    const poImeni = await k.get('/admin/pokupateli?q=' + encodeURIComponent('анна'));
    assert.ok(poImeni.telo.includes('Анна'), 'не нашлось по имени со строчной буквы');
    assert.ok(!poImeni.telo.includes('Дмитрий'), 'в выдачу попал лишний человек');

    const poNiku = await k.get('/admin/pokupateli?q=' + encodeURIComponent('@ANNA_k'));
    assert.ok(poNiku.telo.includes('Анна'), 'не нашлось по username');

    const poId = await k.get('/admin/pokupateli?q=712');
    assert.ok(poId.telo.includes('Дмитрий'), 'не нашлось по идентификатору');
    assert.ok(!poId.telo.includes('Анна'), 'по идентификатору нашлось лишнее');

    const pusto = await k.get('/admin/pokupateli?q=' + encodeURIComponent('такого нет'));
    assert.ok(pusto.telo.includes('Никто не подошёл'), 'пустая выдача молчит вместо ответа');
  } finally {
    await s.zakryt();
  }
});

test('отбор покупателей: с заказами, без заказов, с деньгами на балансе', async () => {
  const s = await stend();
  try {
    // Порядок здесь не вкусовой: у движений денег внешний ключ
    // на людей, поэтому человек заводится раньше пополнения.
    lyudi.zapomnit(s.l.db, 722, 'Пустой', null);
    lyudi.zapomnit(s.l.db, 723, 'Сденьгами', null);
    koshelek.popolnit(s.l.db, 723, 50_000, 'проба', VLADELEC);
    zakazNa(s, 721, 'proba-otb', 100_000);
    // Имя — ПОСЛЕ заказа: заготовка зовёт `zapomnit` сама и затёрла бы
    // подставленное.
    lyudi.zapomnit(s.l.db, 721, 'Сзаказом', null);
    const k = await voyti(s);

    const sZakazami = await k.get('/admin/pokupateli?otbor=s_zakazami');
    assert.ok(sZakazami.telo.includes('Сзаказом'), 'отбор потерял человека с заказом');
    assert.ok(!sZakazami.telo.includes('Пустой'), 'в «с заказами» попал человек без заказов');

    const bezZakazov = await k.get('/admin/pokupateli?otbor=bez_zakazov');
    assert.ok(bezZakazov.telo.includes('Пустой'));
    assert.ok(!bezZakazov.telo.includes('Сзаказом'), 'в «без заказов» попал человек с заказом');

    const sBalansom = await k.get('/admin/pokupateli?otbor=s_balansom');
    assert.ok(sBalansom.telo.includes('Сденьгами'));
    assert.ok(!sBalansom.telo.includes('Пустой'), 'в «с балансом» попал человек без денег');
  } finally {
    await s.zakryt();
  }
});

// ── статистика: период ───────────────────────────────────────────────

test('период режет статистику, и деньги считаются по дню ВЫДАЧИ', async () => {
  const s = await stend();
  try {
    const k = await voyti(s);
    const zashchita = await k.zashchita();

    // Заказ, оформленный три дня назад и выданный сегодня.
    const staryy = zakazNa(s, 731, 'proba-st', 700_000, 3 * 24 * 60);
    await k.post(`/admin/zakaz/${staryy.id}/oplata`, { zashchita });
    await k.post(`/admin/zakaz/${staryy.id}/vzyat`, { zashchita });
    await k.post(`/admin/zakaz/${staryy.id}/dostup`, { zashchita, login: 'a@b.c', parol: 'parol-999' });
    await k.post(`/admin/zakaz/${staryy.id}/otpravit`, { zashchita });
    assert.equal(zakazy.po(s.l.db, staryy.id)!.status, 'vydan');

    const segodnya = zakazy.statistika(s.l.db, str.oknoPerioda('segodnya', 'Europe/Moscow'));
    const vse = zakazy.statistika(s.l.db, str.oknoPerioda('vse', 'Europe/Moscow'));

    assert.equal(vse.vsego, 1, 'за всё время заказ один');
    assert.equal(segodnya.vsego, 0, 'заказ оформлен три дня назад — в «сегодня» ему не место');
    // А деньги — сегодняшние: выдан он сегодня.
    assert.equal(segodnya.vyruchkaKop, 700_000, 'выручка не засчиталась в день выдачи');
    assert.equal(vse.vyruchkaKop, 700_000);

    // «Вчера» не захватывает сегодняшний день ни тем ни другим краем.
    const vchera = zakazy.statistika(s.l.db, str.oknoPerioda('vchera', 'Europe/Moscow'));
    assert.equal(vchera.vsego, 0);
    assert.equal(vchera.vyruchkaKop, 0, 'вчерашнее окно захватило сегодняшнюю выдачу');

    // За три дня заказ виден целиком.
    const nedelya = zakazy.statistika(s.l.db, str.oknoPerioda('nedelya', 'Europe/Moscow'));
    assert.equal(nedelya.vsego, 1);

    // И страница отвечает тем же числом, что и запрос к базе.
    const stranica = await k.get('/admin/statistika?za=segodnya');
    assert.ok(stranica.telo.includes('Заказов оформлено'), 'нет строки про оформленные заказы');
    // Разделитель разрядов у ru-RU — неразрывный пробел, поэтому
    // сравниваем по приведённой строке, а не по набранной руками.
    const bezProbelov = stranica.telo.replace(/[\s\u00a0\u202f]/g, '');
    assert.ok(bezProbelov.includes('7000₽'), 'выручки за сегодня нет на странице');
  } finally {
    await s.zakryt();
  }
});

test('окно «сегодня» начинается в полночь по часам лавки', () => {
  const poyas = 'Europe/Moscow';
  // Момент заведомо известный: 9 сентября 2026, 00:30 по Москве.
  const seychas = Date.parse('2026-09-08T21:30:00.000Z');
  const segodnya = str.oknoPerioda('segodnya', poyas, seychas);
  assert.equal(segodnya.ot, '2026-09-08T21:00:00.000Z', 'начало суток не в московскую полночь');
  assert.equal(segodnya.do, null);

  const vchera = str.oknoPerioda('vchera', poyas, seychas);
  assert.equal(vchera.ot, '2026-09-07T21:00:00.000Z');
  assert.equal(vchera.do, '2026-09-08T21:00:00.000Z', 'вчера обязано кончаться там, где начинается сегодня');

  assert.deepEqual(str.oknoPerioda('vse', poyas, seychas), { ot: null, do: null });
});
