/**
 * Запрос кода двухфакторной аутентификации — шаг НЕОБЯЗАТЕЛЬНЫЙ.
 *
 * Решение владельца, сентябрь 2026: код при входе спрашивают не все
 * нейросети. Пока шаг стоял в цепочке, помощник у заказа со своим
 * аккаунтом не мог ввести доступ вовсе, пока не запросил код
 * и не дождался его, — то есть ждал того, чего никто не пришлёт,
 * а заказ через час отменялся «по коду».
 *
 * Что проверяется:
 *   • путь к выдаче идёт МИМО кода — и в боте, и в панели;
 *   • кнопка «Запросить код» осталась на месте и работает;
 *   • час на код и отмена по нему не тронуты: они отсчитываются
 *     от `kod_zapros_v` и действуют, только если код ЗАПРАШИВАЛИ.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adminy from '../src/db/adminy.js';
import * as zakazy from '../src/db/zakazy.js';
import * as lyudi from '../src/db/lyudi.js';
import * as kody from '../src/db/kody.js';
import { sleduyushchiyShag, GRUPPY } from '../src/admin/stranicy.js';
import { tarif } from '../src/lib/katalog.js';
import type { Stend } from './stend.js';
import { stend, poslat, nazhatie, soobshchenie, SEKRET, VLADELEC, POKUPATEL, ZHIVOY_PLAN } from './stend.js';

const PAROL_PANELI = 'ochen-dlinnyy-parol-1';

/** Заказ со СВОИМ аккаунтом, оплаченный и взятый в работу. */
function vRabote(s: Stend): zakazy.Zakaz {
  lyudi.zapomnit(s.l.db, POKUPATEL, 'Pokupatel', null);
  const t = tarif(s.l.db, ZHIVOY_PLAN);
  assert.ok(t, 'уровень подписки из каталога');
  const { zakaz: z } = zakazy.sozdatIliVernut(s.l.db, {
    tgId: POKUPATEL,
    produktId: t!.product.id,
    planId: t!.plan.id,
    nazvanie: `${t!.product.name} · ${t!.plan.title}`,
    cenaKop: 100_000,
    mesyacev: 0,
    vidAkkaunta: 'svoy',
  });
  zakazy.otmetitOplachennym(s.l.db, z.id, new Date('2026-09-20T10:00:00Z'), VLADELEC);
  zakazy.vzyat(s.l.db, z.id, VLADELEC);
  return zakazy.po(s.l.db, z.id) as zakazy.Zakaz;
}

function knopki(s: Stend): string[] {
  const posledn = [...s.tg.vyzovy]
    .reverse()
    .find((v) => v.metod === 'editMessageText' || v.metod === 'sendMessage');
  const razmetka = (posledn?.telo as { reply_markup?: { inline_keyboard?: { text: string }[][] } })
    ?.reply_markup?.inline_keyboard;
  return (razmetka ?? []).flat().map((k) => k.text);
}

// ── бот ──────────────────────────────────────────────────────────────

test('в боте доступ вводится сразу, а «Запросить код» стоит ниже', async () => {
  const s = await stend();
  try {
    const z = vRabote(s);
    await poslat(s.adres, SEKRET, nazhatie(`az:${z.id}`, VLADELEC));
    const spisok = knopki(s);

    const vvod = spisok.indexOf('Enter access');
    const kod = spisok.indexOf('Request 2FA code');
    assert.ok(vvod >= 0, `кнопки ввода доступа нет вовсе: ${spisok.join(' | ')}`);
    assert.ok(kod >= 0, `кнопка запроса кода пропала: ${spisok.join(' | ')}`);
    assert.ok(vvod < kod, `запрос кода стоит выше ввода доступа: ${spisok.join(' | ')}`);
  } finally {
    await s.zakryt();
  }
});

test('ПУТЬ ЦЕЛИКОМ: свой аккаунт выдан, а кода никто не спрашивал', async () => {
  const s = await stend();
  try {
    const z = vRabote(s);

    // Ввод доступа — сразу, без единого нажатия по запросу кода.
    await poslat(s.adres, SEKRET, nazhatie(`avv:${z.id}`, VLADELEC));
    await poslat(s.adres, SEKRET, soobshchenie('login@pochta.ru', VLADELEC));
    await poslat(s.adres, SEKRET, soobshchenie('parol-ot-akkaunta', VLADELEC));
    assert.ok(knopki(s).includes('Send to customer'), 'не дошли до проверки доступа');

    await poslat(s.adres, SEKRET, nazhatie(`avyd:${z.id}`, VLADELEC));
    const posle = zakazy.po(s.l.db, z.id) as zakazy.Zakaz;
    assert.equal(posle.status, 'vydan', 'заказ не выдан без кода');
    assert.equal(posle.kod_zapros_v, null, 'код всё-таки запрашивали');
    assert.equal(kody.vzyat(s.l.db, z.id, s.l.n.klyuchDostupov), null, 'код взялся откуда-то');

    // Покупателю ушёл доступ, а не просьба о коде.
    const emu = s.tg.vyzovy
      .filter((v) => v.metod === 'sendMessage' && (v.telo as { chat_id?: number }).chat_id === POKUPATEL)
      .map((v) => String((v.telo as { text?: string }).text ?? ''))
      .join('\n');
    assert.ok(emu.includes('login@pochta.ru'), `доступ покупателю не ушёл: ${emu}`);
    assert.ok(!emu.includes('код подтверждения'), `у покупателя всё-таки просили код: ${emu}`);
  } finally {
    await s.zakryt();
  }
});

test('кнопка «Запросить код» по-прежнему работает, когда код нужен', async () => {
  const s = await stend();
  try {
    const z = vRabote(s);
    await poslat(s.adres, SEKRET, nazhatie(`akodz:${z.id}`, VLADELEC));
    const posle = zakazy.po(s.l.db, z.id) as zakazy.Zakaz;
    assert.equal(posle.status, 'zhdem_kod', 'запрос кода перестал работать');
    assert.ok(posle.kod_zapros_v, 'время запроса не записано — час на код не пойдёт');
  } finally {
    await s.zakryt();
  }
});

// ── час на код не тронут ─────────────────────────────────────────────

test('час на код идёт ТОЛЬКО у того, у кого код запрашивали', async () => {
  const s = await stend();
  try {
    const bezKoda = vRabote(s);
    const seychas = new Date('2026-09-20T23:00:00Z');
    assert.equal(
      zakazy.prosrochennyeKody(s.l.db, seychas, 60).length,
      0,
      'заказ без запроса кода попал в просроченные по коду',
    );

    // А как только код ЗАПРОСИЛИ — час пошёл, и отмена работает
    // ровно как раньше. Обе половины в одной пробе намеренно: порознь
    // «не отменяется» зеленело бы и у сломанного отсчёта.
    zakazy.zaprositKod(s.l.db, bezKoda.id, VLADELEC);
    s.l.db
      .prepare("UPDATE zakazy SET kod_zapros_v = '2026-09-20T10:00:00.000Z' WHERE id = ?")
      .run(bezKoda.id);
    assert.deepEqual(
      zakazy.prosrochennyeKody(s.l.db, seychas, 60).map((x) => x.id),
      [bezKoda.id],
      'час на код перестал идти после запроса',
    );
  } finally {
    await s.zakryt();
  }
});

// ── панель ───────────────────────────────────────────────────────────

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
    return (await this.get(put)).telo.match(/name="zashchita" value="([^"]+)"/)?.[1] ?? '';
  }
}

async function voyti(s: Stend): Promise<Klient> {
  adminy.zavesti(s.l.db, 'hozyain', PAROL_PANELI, VLADELEC);
  const k = new Klient(s.koren);
  assert.equal((await k.post('/admin/vhod', { login: 'hozyain', parol: PAROL_PANELI })).kod, 303);
  return k;
}

test('в панели форма ввода доступа открыта сразу, а код — вторая кнопка', async () => {
  const s = await stend();
  try {
    const z = vRabote(s);
    const k = await voyti(s);
    const kart = await k.get(`/admin/zakaz/${z.id}`);

    assert.ok(kart.telo.includes('name="login"'), 'формы ввода доступа нет на карточке');
    assert.ok(kart.telo.includes('/kod"'), 'кнопка запроса кода пропала');
    assert.ok(
      kart.telo.includes('Ввести доступ — форма ниже'),
      'следующим шагом назван не ввод доступа',
    );
    assert.ok(
      kart.telo.includes('сервис спрашивает код при входе'),
      'не сказано, что код нужен не всегда',
    );

    // И шаг у такого заказа — ввод доступа, а не код.
    assert.equal(
      sleduyushchiyShag(z, { estDostup: false, estKod: false, estAkkaunt: false }),
      'dostup',
    );
    // Группы под необязательный шаг в очереди больше нет.
    assert.ok(!(GRUPPY as string[]).includes('kod'), 'вернулась группа под запрос кода');
  } finally {
    await s.zakryt();
  }
});

test('в панели заказ выдаётся без единого касания кода', async () => {
  const s = await stend();
  try {
    const z = vRabote(s);
    const k = await voyti(s);
    const zashchita = await k.zashchita(`/admin/zakaz/${z.id}`);

    await k.post(`/admin/zakaz/${z.id}/dostup`, {
      zashchita,
      login: 'login@pochta.ru',
      parol: 'parol-ot-akkaunta',
    });
    const posleVvoda = await k.post(`/admin/zakaz/${z.id}/otpravit`, { zashchita });
    assert.equal(posleVvoda.kod, 303);

    const posle = zakazy.po(s.l.db, z.id) as zakazy.Zakaz;
    assert.equal(posle.status, 'vydan', 'панель не довела заказ до выдачи без кода');
    assert.equal(posle.kod_zapros_v, null, 'код всё-таки запрашивали');
  } finally {
    await s.zakryt();
  }
});

/**
 * У заказа, которому код УЖЕ запросили, форма свёрнута — и это не
 * блокировка, а обмен: пока полей нет, страница обновляется сама
 * (перезагрузка стёрла бы набранное), и помощник видит пришедший код
 * без нажатий. Передумал — один щелчок раскрывает форму.
 */
test('в состоянии «ждём код» форма раскрывается ссылкой', async () => {
  const s = await stend();
  try {
    const z = vRabote(s);
    zakazy.zaprositKod(s.l.db, z.id, VLADELEC);
    const k = await voyti(s);

    const zakryta = await k.get(`/admin/zakaz/${z.id}`);
    assert.ok(!zakryta.telo.includes('name="login"'), 'форма открыта там, где должна быть свёрнута');
    assert.ok(zakryta.telo.includes(`/admin/zakaz/${z.id}?vvod=1`), 'нет ссылки, раскрывающей форму');

    const raskryta = await k.get(`/admin/zakaz/${z.id}?vvod=1`);
    assert.ok(raskryta.telo.includes('name="login"'), 'ссылка не раскрыла форму ввода доступа');
  } finally {
    await s.zakryt();
  }
});
