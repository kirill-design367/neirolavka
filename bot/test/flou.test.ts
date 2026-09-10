/**
 * Путь заказа со СВОИМ аккаунтом — целиком, через настоящий вебхук.
 *
 * Это самый длинный путь в лавке и единственный, где участвуют трое:
 * покупатель вводит логин и пароль, помощник входит в аккаунт, а между
 * ними ходит код с почты. Проверяется не «что-то ответило», а состояние
 * заказа на каждом шаге и то, что видит каждая сторона.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zakazy from '../src/db/zakazy.js';
import * as koshelek from '../src/db/koshelek.js';
import * as svoi from '../src/db/svoi.js';
import * as lyudi from '../src/db/lyudi.js';
import { proverit as proveritKody } from '../src/jobs/kody.js';
import {
  stend,
  poslat,
  SEKRET,
  POKUPATEL,
  VLADELEC,
  nazhatie,
  soobshchenie,
  ZHIVOY_PLAN,
  PRODUKT_BEZ_UROVNEY,
} from './stend.js';

type Vyzov = { metod: string; telo: Record<string, unknown> };

/** Все тексты, ушедшие человеку с этим идентификатором. */
function komu(vyzovy: Vyzov[], tgId: number): string[] {
  return vyzovy
    .filter((v) => v.metod === 'sendMessage' && v.telo['chat_id'] === tgId)
    .map((v) => String(v.telo['text'] ?? ''));
}

/** Текст последней правки или отправки — то, что человек видит сейчас. */
function poslednee(vyzovy: Vyzov[]): string {
  const v = [...vyzovy].reverse().find((x) => x.metod === 'editMessageText' || x.metod === 'sendMessage');
  return String(v?.telo['text'] ?? '');
}

const POCHTA = 'pokupatel@example.com';
const PAROL = 'parol-ot-akkaunta-777';
const KOD = '314159';

test('свой аккаунт: ввод, код, выдача — и каждая сторона видит своё', async () => {
  const s = await stend();
  try {
    // ── покупатель оформляет заказ на свой аккаунт ──
    await poslat(s.adres, SEKRET, nazhatie(`of:${ZHIVOY_PLAN}`));
    await poslat(s.adres, SEKRET, nazhatie(`svoy:${ZHIVOY_PLAN}`));
    assert.ok(poslednee(s.tg.vyzovy).includes('почты'), 'бот просит логин почты');
    assert.equal(zakazy.cheloveka(s.l.db, POKUPATEL).length, 0, 'заказа до ввода ещё нет');

    await poslat(s.adres, SEKRET, soobshchenie(POCHTA));
    assert.ok(poslednee(s.tg.vyzovy).includes('пароль'), 'бот просит пароль');
    await poslat(s.adres, SEKRET, soobshchenie(PAROL));

    // ── сверка: показали записанное и ждём подтверждения ──
    const sverka = poslednee(s.tg.vyzovy);
    assert.ok(sverka.includes('Всё верно?'), `нет вопроса о сверке: ${sverka}`);
    assert.ok(sverka.includes(POCHTA), 'на сверке не показана почта');
    assert.ok(!sverka.includes(PAROL), 'ПАРОЛЬ ПОКАЗАН ОТКРЫТЫМ на сверке');
    assert.ok(sverka.includes('••••'), 'не видно, что пароль записан');
    assert.equal(
      zakazy.cheloveka(s.l.db, POKUPATEL).length,
      0,
      'заказ создан ДО подтверждения — сверка ничего не значит',
    );
    // Пока ждём подтверждения, пароль лежит в черновике — и там он
    // обязан быть шифротекстом, как и везде.
    const doPodtverzhdeniya = JSON.stringify(s.l.db.prepare('SELECT * FROM dialogi').all());
    assert.ok(!doPodtverzhdeniya.includes(PAROL), 'пароль лежит в черновике открытым');
    assert.ok(!doPodtverzhdeniya.includes(POCHTA), 'почта лежит в черновике открытой');

    await poslat(s.adres, SEKRET, nazhatie('sv:da'));

    const zakaz = zakazy.cheloveka(s.l.db, POKUPATEL)[0];
    assert.ok(zakaz, 'заказ создан после подтверждения');
    assert.equal(zakaz!.vid_akkaunta, 'svoy');
    assert.equal(svoi.est(s.l.db, zakaz!.id), true, 'данные аккаунта записаны');

    // Секреты в базе только шифротекстом — ни почты, ни пароля открытым.
    const syrye = JSON.stringify(
      s.l.db.prepare('SELECT * FROM svoi_akkaunty WHERE zakaz_id = ?').get(zakaz!.id),
    );
    assert.ok(!syrye.includes(POCHTA), 'почта лежит открытой');
    assert.ok(!syrye.includes(PAROL), 'пароль лежит открытым');
    const chernoviki = JSON.stringify(s.l.db.prepare('SELECT * FROM dialogi').all());
    assert.ok(!chernoviki.includes(PAROL), 'пароль остался в черновике разговора');

    // Покупателя предупредили про код ещё при оформлении.
    const emu = komu(s.tg.vyzovy, POKUPATEL).join('\n');
    assert.ok(emu.includes('код'), 'покупателя не предупредили про код');

    // ── администратор ведёт заказ ──
    await poslat(s.adres, SEKRET, nazhatie(`aopl:${zakaz!.id}`, VLADELEC));
    assert.equal(zakazy.po(s.l.db, zakaz!.id)!.status, 'oplachen');

    await poslat(s.adres, SEKRET, nazhatie(`avz:${zakaz!.id}`, VLADELEC));
    assert.equal(zakazy.po(s.l.db, zakaz!.id)!.status, 'v_rabote');
    assert.ok(
      komu(s.tg.vyzovy, POKUPATEL).some((x) => x.includes('взяли в работу')),
      'покупателю не сказали, что заказ взяли',
    );

    // ── код ──
    await poslat(s.adres, SEKRET, nazhatie(`akodz:${zakaz!.id}`, VLADELEC));
    assert.equal(zakazy.po(s.l.db, zakaz!.id)!.status, 'zhdem_kod');
    const prosba = komu(s.tg.vyzovy, POKUPATEL).find((x) => x.includes('двухфакторной'));
    assert.ok(prosba, 'просьбы о коде не было');
    assert.ok(prosba!.includes(`№ ${zakaz!.id}`), 'в просьбе нет номера заказа');

    await poslat(s.adres, SEKRET, soobshchenie(KOD));
    const sverkaKoda = poslednee(s.tg.vyzovy);
    assert.ok(sverkaKoda.includes('Всё верно?'), `нет сверки кода: ${sverkaKoda}`);
    assert.ok(sverkaKoda.includes(KOD), 'на сверке не показан сам код');
    assert.equal(
      zakazy.po(s.l.db, zakaz!.id)!.status,
      'zhdem_kod',
      'код зачтён ДО подтверждения — сверка ничего не значит',
    );
    assert.ok(
      !komu(s.tg.vyzovy, VLADELEC).some((x) => x.includes(KOD)),
      'код ушёл команде до подтверждения',
    );

    await poslat(s.adres, SEKRET, nazhatie('kd:da'));
    const posleKoda = zakazy.po(s.l.db, zakaz!.id)!;
    assert.equal(posleKoda.status, 'kod_poluchen');
    assert.ok(posleKoda.kod_poluchen_v, 'время получения кода не записано');

    // Код ушёл команде И с номером заказа: помощник ведёт несколько
    // заказов разом и по голому коду не поймёт, к какому он.
    const komande = komu(s.tg.vyzovy, VLADELEC).find((x) => x.includes(KOD));
    assert.ok(komande, 'код команде не ушёл');
    assert.ok(komande!.includes(`№ ${zakaz!.id}`), `в коде нет номера заказа: ${komande}`);

    // Сам код в базе — шифротекстом.
    const kodySyrye = JSON.stringify(s.l.db.prepare('SELECT * FROM kody').all());
    assert.ok(!kodySyrye.includes(KOD), 'код лежит в базе открытым');

    // ── выдача ──
    await poslat(s.adres, SEKRET, nazhatie(`avv:${zakaz!.id}`, VLADELEC));
    await poslat(s.adres, SEKRET, soobshchenie('login@vydannyy', VLADELEC));
    await poslat(s.adres, SEKRET, soobshchenie('parol-vydannyy', VLADELEC));
    await poslat(s.adres, SEKRET, nazhatie(`avyd:${zakaz!.id}`, VLADELEC));
    assert.equal(zakazy.po(s.l.db, zakaz!.id)!.status, 'vydan');
  } finally {
    await s.zakryt();
  }
});

test('код не пришёл за обещанное время: заказ отменён, деньги на балансе', async () => {
  const s = await stend();
  try {
    // Покупателя обычно заводит общий слой на первом обновлении;
    // эта проба начинается прямо с базы, поэтому заводим руками.
    lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
    // Заказ с ценой: пока прайса нет, в каталоге ноль, а проверять надо
    // именно движение денег.
    koshelek.popolnit(s.l.db, POKUPATEL, 199_000, 'проба', VLADELEC);
    const { zakaz } = zakazy.sozdatIliVernut(s.l.db, {
      tgId: POKUPATEL,
      produktId: 'kling',
      planId: ZHIVOY_PLAN,
      nazvanie: 'Kling AI, Pro',
      cenaKop: 199_000,
      mesyacev: 0,
      vidAkkaunta: 'svoy',
    });
    zakazy.oplatitSBalansa(s.l.db, zakaz.id, new Date());
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 0, 'деньги ушли на заказ');
    zakazy.vzyat(s.l.db, zakaz.id, VLADELEC);
    await poslat(s.adres, SEKRET, nazhatie(`akodz:${zakaz.id}`, VLADELEC));
    assert.equal(zakazy.po(s.l.db, zakaz.id)!.status, 'zhdem_kod');

    // Час прошёл, кода нет.
    const cherezChas = new Date(Date.now() + 61 * 60_000);
    assert.equal(await proveritKody(s.l, cherezChas), 1);

    const posle = zakazy.po(s.l.db, zakaz.id)!;
    assert.equal(posle.status, 'otmenen');
    assert.equal(posle.prichina_otmeny, 'net_koda');
    assert.equal(posle.oplacheno_kop, 0, 'заказ больше не держит денег');
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 199_000, 'деньги вернулись на баланс');

    const emu = komu(s.tg.vyzovy, POKUPATEL).find((x) => x.includes('отменён'));
    assert.ok(emu, 'покупателю не сказали об отмене');
    assert.ok(emu!.includes('баланс'), `в сообщении нет судьбы денег: ${emu}`);

    // Разговор о коде закрыт: следующее сообщение человека не уйдёт
    // кодом в отменённый заказ.
    assert.equal(s.l.db.prepare('SELECT COUNT(*) n FROM dialogi').get() as unknown as { n: number } ? true : true, true);
    const dialogov = (s.l.db.prepare('SELECT COUNT(*) n FROM dialogi WHERE tg_id = ?').get(POKUPATEL) as { n: number }).n;
    assert.equal(dialogov, 0);

    // Второй проход ничего не находит: отменённый заказ уже закрыт.
    assert.equal(await proveritKody(s.l, cherezChas), 0);
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 199_000, 'второго возврата не было');
  } finally {
    await s.zakryt();
  }
});

test('неверный пароль: сначала письмо, потом отмена — и никак иначе', async () => {
  const s = await stend();
  try {
    // Покупателя обычно заводит общий слой на первом обновлении;
    // эта проба начинается прямо с базы, поэтому заводим руками.
    lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
    koshelek.popolnit(s.l.db, POKUPATEL, 199_000, 'проба', VLADELEC);
    const { zakaz } = zakazy.sozdatIliVernut(s.l.db, {
      tgId: POKUPATEL,
      produktId: 'kling',
      planId: ZHIVOY_PLAN,
      nazvanie: 'Kling AI, Pro',
      cenaKop: 199_000,
      mesyacev: 0,
      vidAkkaunta: 'svoy',
    });
    zakazy.oplatitSBalansa(s.l.db, zakaz.id, new Date());
    zakazy.vzyat(s.l.db, zakaz.id, VLADELEC);

    // Пока письмо не отправлено, отмены по паролю нет ни в базе,
    // ни на клавиатуре.
    await poslat(s.adres, SEKRET, nazhatie(`aparol:${zakaz.id}`, VLADELEC));
    assert.equal(zakazy.po(s.l.db, zakaz.id)!.status, 'v_rabote', 'заказ отменился без письма');
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 0);

    await poslat(s.adres, SEKRET, nazhatie(`apis:${zakaz.id}`, VLADELEC));
    assert.ok(zakazy.po(s.l.db, zakaz.id)!.pismo_v, 'письмо не отмечено');

    await poslat(s.adres, SEKRET, nazhatie(`aparol:${zakaz.id}`, VLADELEC));
    const posle = zakazy.po(s.l.db, zakaz.id)!;
    assert.equal(posle.status, 'otmenen');
    assert.equal(posle.prichina_otmeny, 'nevernyy_parol');
    assert.equal(koshelek.balans(s.l.db, POKUPATEL), 199_000);

    const emu = komu(s.tg.vyzovy, POKUPATEL).find((x) => x.includes('пароль'));
    assert.ok(emu, 'покупателю не объяснили причину');
    assert.ok(emu!.includes('восстановлен'), `в сообщении нет про письмо: ${emu}`);
  } finally {
    await s.zakryt();
  }
});

test('у одного покупателя код спрашивают только по одному заказу разом', async () => {
  const s = await stend();
  try {
    lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
    const pervy = zakazy.sozdatIliVernut(s.l.db, {
      tgId: POKUPATEL,
      produktId: 'kling',
      planId: ZHIVOY_PLAN,
      nazvanie: 'Kling AI, Pro',
      cenaKop: 0,
      mesyacev: 0,
      vidAkkaunta: 'svoy',
    }).zakaz;
    const vtoroy = zakazy.sozdatIliVernut(s.l.db, {
      tgId: POKUPATEL,
      produktId: PRODUKT_BEZ_UROVNEY.id,
      planId: PRODUKT_BEZ_UROVNEY.id,
      nazvanie: PRODUKT_BEZ_UROVNEY.name,
      cenaKop: 0,
      mesyacev: 0,
      vidAkkaunta: 'svoy',
    }).zakaz;
    for (const z of [pervy, vtoroy]) {
      zakazy.otmetitOplachennym(s.l.db, z.id, new Date(), VLADELEC);
      zakazy.vzyat(s.l.db, z.id, VLADELEC);
    }

    await poslat(s.adres, SEKRET, nazhatie(`akodz:${pervy.id}`, VLADELEC));
    assert.equal(zakazy.po(s.l.db, pervy.id)!.status, 'zhdem_kod');

    // Второй запрос не проходит: разговор о коде один на человека,
    // и код ушёл бы не к тому заказу.
    await poslat(s.adres, SEKRET, nazhatie(`akodz:${vtoroy.id}`, VLADELEC));
    assert.equal(zakazy.po(s.l.db, vtoroy.id)!.status, 'v_rabote');
    assert.equal(zakazy.po(s.l.db, pervy.id)!.status, 'zhdem_kod');

    // Код от покупателя уходит первому заказу — тому, о котором спросили.
    await poslat(s.adres, SEKRET, soobshchenie('424242'));
    await poslat(s.adres, SEKRET, nazhatie('kd:da'));
    assert.equal(zakazy.po(s.l.db, pervy.id)!.status, 'kod_poluchen');
    assert.equal(zakazy.po(s.l.db, vtoroy.id)!.status, 'v_rabote');
  } finally {
    await s.zakryt();
  }
});

/**
 * Отмена в БОТЕ тоже спрашивает причину.
 *
 * Панель и бот зовут одни переходы, и список причин у них обязан быть
 * один: пока кнопка бота писала снятую `ruchnaya`, панель показывала
 * три причины, а в базу попадала четвёртая.
 */
test('в боте «Отменить заказ» сначала спрашивает причину', async () => {
  const s = await stend();
  try {
    lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
    const z = zakazy.sozdatIliVernut(s.l.db, {
      tgId: POKUPATEL,
      produktId: 'kling',
      planId: ZHIVOY_PLAN,
      nazvanie: 'Kling AI, Pro',
      cenaKop: 199_000,
      mesyacev: 0,
      vidAkkaunta: 'novy',
    }).zakaz;

    await poslat(s.adres, SEKRET, nazhatie(`aotm:${z.id}`, VLADELEC));
    assert.notEqual(zakazy.po(s.l.db, z.id)!.status, 'otmenen', 'заказ отменён без выбора причины');
    const vopros = poslednee(s.tg.vyzovy);
    assert.ok(vopros.includes('Почему отменяем?'), `не спросили причину: ${vopros}`);
    // Подписи причин живут в клавиатуре, а не в тексте сообщения.
    const knopki = JSON.stringify(
      [...s.tg.vyzovy].reverse().find((v) => v.metod === 'editMessageText')?.telo['reply_markup'] ?? {},
    );
    assert.ok(knopki.includes('Недостаточно средств'), `новой причины нет среди кнопок: ${knopki}`);
    assert.ok(!knopki.includes('ruchnaya'), 'снятая причина осталась кнопкой');

    // Чужой код причины не проходит.
    await poslat(s.adres, SEKRET, nazhatie(`aotmp:${z.id}:ruchnaya`, VLADELEC));
    assert.notEqual(zakazy.po(s.l.db, z.id)!.status, 'otmenen', 'снятая причина прошла через бота');

    await poslat(s.adres, SEKRET, nazhatie(`aotmp:${z.id}:net_deneg`, VLADELEC));
    const posle = zakazy.po(s.l.db, z.id)!;
    assert.equal(posle.status, 'otmenen');
    assert.equal(posle.prichina_otmeny, 'net_deneg');

    const emu = komu(s.tg.vyzovy, POKUPATEL).find((x) => x.includes('отменён'));
    assert.ok(emu, 'покупателю не сказали об отмене');
    assert.ok(emu!.includes('не хватило'), `причина не названа человеку: ${emu}`);
  } finally {
    await s.zakryt();
  }
});
