/**
 * Уведомления администраторов.
 *
 * Здесь проверяется свойство, которое стоило боевого дня: неудача
 * служебного сообщения не имеет права влиять на путь покупателя.
 * Заказ уже принят и записан; дошло ли уведомление — отдельная
 * история, и её место в журнале и в очереди, а не в исключении.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as zakazy from '../src/db/zakazy.js';
import * as dostupy from '../src/db/dostupy.js';
import * as lyudi from '../src/db/lyudi.js';
import { komande, mozhemPisat, proveritKomandu, pochemuNeDoshlo } from '../src/bot/uvedomleniya.js';
import { GrammyError } from 'grammy';
import { stend, poslat, SEKRET, VLADELEC, POKUPATEL, nazhatie } from './stend.js';

/** Подставной отказ Telegram, как он приходит из grammY. */
function otkaz(kod: number, opisanie: string): GrammyError {
  return new GrammyError(
    `Call to 'sendMessage' failed!`,
    { ok: false, error_code: kod, description: opisanie },
    'sendMessage',
    {},
  );
}

test('«chat not found» отличается от прочих отказов', () => {
  assert.equal(pochemuNeDoshlo(otkaz(400, 'Bad Request: chat not found')), 'ne_zapuskal');
  assert.equal(pochemuNeDoshlo(otkaz(403, 'Forbidden: bot was blocked by the user')), 'zablokiroval');
  assert.equal(pochemuNeDoshlo(otkaz(400, 'Bad Request: message is too long')), 'inoe');
  assert.equal(pochemuNeDoshlo(new Error('сеть отвалилась')), 'inoe');
});

test('недоступный администратор виден ДО первого заказа', async () => {
  const s = await stend();
  try {
    s.tg.otvechat = (metod) =>
      metod === 'getChat'
        ? { vid: 'oshibka', kod: 400, opisanie: 'Bad Request: chat not found' }
        : { vid: 'ok' };
    const itog = await mozhemPisat(s.l, VLADELEC);
    assert.equal(itog.doshlo, false);
    assert.equal(itog.doshlo === false && itog.pochemu, 'ne_zapuskal');

    // Проверка всей команды не бросает и не роняет запуск бота.
    await proveritKomandu(s.l);
    // getChat вызывался, sendMessage — нет: человека не тревожим.
    assert.ok(s.tg.vyzovy.some((v) => v.metod === 'getChat'));
    assert.equal(s.tg.vyzovy.some((v) => v.metod === 'sendMessage'), false);
  } finally {
    await s.zakryt();
  }
});

test('уведомление команде не бросает и рассказывает, кто недоступен', async () => {
  const s = await stend();
  try {
    s.tg.otvechat = (metod) =>
      metod === 'sendMessage'
        ? { vid: 'oshibka', kod: 400, opisanie: 'Bad Request: chat not found' }
        : { vid: 'ok' };
    const itog = await komande(s.l, 'проба');
    assert.equal(itog.vsego, 1);
    assert.equal(itog.doshlo, 0);
    assert.deepEqual(itog.nedostupny, [{ tgId: VLADELEC, pochemu: 'ne_zapuskal' }]);
  } finally {
    await s.zakryt();
  }
});

test('заказ, о котором некому сообщить, сохраняется и попадает в очередь', async () => {
  const s = await stend();
  try {
    s.tg.otvechat = (metod, telo) =>
      metod === 'sendMessage' && telo['chat_id'] === VLADELEC
        ? { vid: 'oshibka', kod: 400, opisanie: 'Bad Request: chat not found' }
        : { vid: 'ok' };

    await poslat(s.adres, SEKRET, nazhatie('of:claude-pro-1m'));

    const spisok = zakazy.cheloveka(s.l.db, POKUPATEL);
    assert.equal(spisok.length, 1, 'заказ записан');
    const z = spisok[0]!;

    // Неудача уведомления отмечена событием — по нему видно в карточке.
    const sobytiya = zakazy.sobytiya(s.l.db, z.id).map((x) => x.chto);
    assert.ok(sobytiya.includes('команду уведомить не удалось'), sobytiya.join(', '));

    // И заказ виден администратору: он в списке ждущих оплаты.
    assert.deepEqual(
      zakazy.neoplachennye(s.l.db).map((x) => x.id),
      [z.id],
    );
  } finally {
    await s.zakryt();
  }
});

test('покупателю доступ не доставлен — заказ НЕ отмечается выданным', async () => {
  const s = await stend();
  try {
    // Заказ, доведённый до состояния «в работе» с записанным доступом.
    // Покупателя заводим руками: обычно это делает общий слой бота
    // на первом же обновлении, а тут мы начинаем сразу с середины.
    lyudi.zapomnit(s.l.db, POKUPATEL, 'Покупатель', null);
    const { zakaz } = zakazy.sozdatIliVernut(s.l.db, {
      tgId: POKUPATEL,
      produktId: 'claude',
      planId: 'claude-pro-1m',
      nazvanie: 'Claude Pro, 1 месяц',
      cenaKop: 199000,
      mesyacev: 1,
    });
    zakazy.otmetitOplachennym(s.l.db, zakaz.id, new Date(), VLADELEC);
    zakazy.vzyat(s.l.db, zakaz.id, VLADELEC);
    dostupy.polozhit(s.l.db, zakaz.id, { login: 'a@b.ru', parol: 'sekret' }, VLADELEC, s.l.n.klyuchDostupov);

    // Покупатель заблокировал бота между оплатой и выдачей.
    s.tg.otvechat = (metod, telo) =>
      metod === 'sendMessage' && telo['chat_id'] === POKUPATEL
        ? { vid: 'oshibka', kod: 403, opisanie: 'Forbidden: bot was blocked by the user' }
        : { vid: 'ok' };

    await poslat(s.adres, SEKRET, nazhatie(`avyd:${zakaz.id}`, VLADELEC));

    const posle = zakazy.po(s.l.db, zakaz.id);
    assert.equal(posle?.status, 'v_rabote', 'заказ остался невыданным');
    assert.equal(posle?.vydan, null);
    assert.ok(
      zakazy.sobytiya(s.l.db, zakaz.id).some((x) => x.chto === 'доступ не доставлен покупателю'),
    );
  } finally {
    await s.zakryt();
  }
});
