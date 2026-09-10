/**
 * Метка рекламного канала: от адреса страницы до строки в статистике.
 *
 * Проверяется весь путь по частям, потому что рвётся он тихо:
 * сайт кладёт метку в ссылку, Telegram отдаёт её боту в `start`,
 * бот пишет человеку, статистика считает. Порвись любое звено —
 * колонка просто окажется пустой, и понять это можно будет только
 * через месяц.
 *
 * Отдельно проверяется ПЕРВОЕ КАСАНИЕ: метка не перезаписывается.
 * Иначе человек, вернувшийся по ссылке из другого канала, переписал бы
 * себе источник, и статистика начала бы врать в пользу того канала,
 * по которому люди возвращаются, а не того, который их привёл.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as metki from '../src/db/metki.js';
import * as lyudi from '../src/db/lyudi.js';
import * as zakazy from '../src/db/zakazy.js';
import { kodMetki, metkaIzAdresa, metkaIzPayload, sobratPayload } from '../src/lib/metka.js';
import { poslat } from './podstavnoy-telegram.js';
import { stend, SEKRET, POKUPATEL, VLADELEC, ZHIVOY_PLAN } from './stend.js';

/** Обновление вида «человек нажал ссылку с меткой». */
function start(payload: string, tgId = POKUPATEL): unknown {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: tgId, type: 'private' },
      from: { id: tgId, is_bot: false, first_name: 'Покупатель' },
      text: payload ? `/start ${payload}` : '/start',
      entities: [{ offset: 0, length: 6, type: 'bot_command' }],
    },
  };
}

test('код метки чистится до того, что переживёт ссылку', () => {
  assert.equal(kodMetki('ВК посты'), '', 'из одной кириллицы код не собирается');
  // А вот латиница и цифры переживают — и это не мелочь: «ВК посты 1»
  // превратится в код «1», и владелец увидит его в списке ссылок.
  assert.equal(kodMetki('ВК посты 1'), '1');
  assert.equal(kodMetki('VK Posty 1'), 'vk-posty-1');
  assert.equal(kodMetki('vk-posty'), 'vk-posty');
  assert.equal(kodMetki('VK Posty!!'), 'vk-posty');
  assert.equal(kodMetki('  --vk--  '), 'vk');
  assert.equal(kodMetki(null), '');
  // Не длиннее предела и без дефиса на конце после обрезки.
  assert.ok(kodMetki('a'.repeat(60)).length <= 24);
  assert.ok(!kodMetki(`${'a'.repeat(23)}-bbb`).endsWith('-'));
});

test('метка берётся и из своего ?m=, и из чужого utm_source', () => {
  assert.equal(metkaIzAdresa('?m=vk-posty'), 'vk-posty');
  assert.equal(metkaIzAdresa('?utm_source=vk&utm_medium=cpc'), 'vk');
  // Своё имеет старшинство: ссылка из панели короче и точнее.
  assert.equal(metkaIzAdresa('?m=svoya&utm_source=chuzhaya'), 'svoya');
  assert.equal(metkaIzAdresa(''), '');
});

test('payload собирается и разбирается обратно', () => {
  assert.equal(sobratPayload({ metka: 'vk-posty' }), 'metka_vk-posty');
  assert.equal(
    sobratPayload({ tovar: 'kling-pro', oplata: 'sbp', metka: 'vk' }),
    'tovar_kling-pro_oplata_sbp_metka_vk',
  );
  assert.equal(metkaIzPayload('tovar_kling-pro_oplata_sbp_metka_vk'), 'vk');
  // Пустое значение не едет вовсе, полупара отбрасывается.
  assert.equal(sobratPayload({ metka: '' }), '');
  assert.equal(metkaIzPayload('metka'), '');
  // И то, что приехало, всё равно чистится: прийти могло что угодно.
  assert.equal(metkaIzPayload('metka_VK!!'), 'vk');
  // Telegram не пропустит длиннее 64 знаков — значит и мы не шлём.
  assert.ok(sobratPayload({ metka: 'a'.repeat(24), tovar: 'b'.repeat(60) }).length <= 64);
});

test('бот записывает метку из ссылки — и только при первом касании', async () => {
  const s = await stend();
  try {
    await poslat(s.adres, SEKRET, start('metka_vk-posty'));
    assert.equal(lyudi.chelovek(s.l.db, POKUPATEL)?.metka, 'vk-posty', 'метка не записана');

    // Вернулся по другой ссылке — источник не переписывается.
    await poslat(s.adres, SEKRET, start('metka_telegram-ads'));
    assert.equal(
      lyudi.chelovek(s.l.db, POKUPATEL)?.metka,
      'vk-posty',
      'ПЕРЕЗАПИСАЛИ источник: канал возврата вытеснил канал привлечения',
    );
  } finally {
    await s.zakryt();
  }
});

test('/start без метки ничего не ломает и приветствие приходит', async () => {
  const s = await stend();
  try {
    await poslat(s.adres, SEKRET, start(''));
    assert.equal(lyudi.chelovek(s.l.db, POKUPATEL)?.metka, null);
    const teksty = s.tg.vyzovy
      .filter((v) => v.metod === 'sendMessage')
      .map((v) => String(v.telo['text'] ?? ''));
    assert.ok(teksty.some((x) => x.includes('Нейролавка')), 'приветствие не пришло');
  } finally {
    await s.zakryt();
  }
});

test('/start с меткой выпускает из незаконченного разговора', async () => {
  const s = await stend();
  try {
    // Человек начал вводить свой аккаунт…
    await poslat(s.adres, SEKRET, {
      update_id: 1,
      callback_query: {
        id: '1',
        from: { id: POKUPATEL, is_bot: false, first_name: 'Покупатель' },
        message: { message_id: 1, date: 1, chat: { id: POKUPATEL, type: 'private' } },
        data: `svoy:${ZHIVOY_PLAN}`,
      },
    });
    // …и нажал ссылку с меткой. Раньше она уходила в черновик как логин.
    await poslat(s.adres, SEKRET, start('metka_vk-posty'));

    const teksty = s.tg.vyzovy
      .filter((v) => v.metod === 'sendMessage')
      .map((v) => String(v.telo['text'] ?? ''));
    assert.ok(
      teksty.some((x) => x.includes('Нейролавка')),
      'человек остался заперт в разговоре: приветствия нет',
    );
    assert.equal(lyudi.chelovek(s.l.db, POKUPATEL)?.metka, 'vk-posty');
  } finally {
    await s.zakryt();
  }
});

test('сводка считает и заведённые метки, и чужие, и «без метки»', async () => {
  const s = await stend();
  try {
    const db = s.l.db;
    metki.zavesti(db, { kod: 'vk-posty', nazvanie: 'Посты во ВКонтакте' }, VLADELEC);

    lyudi.zapomnit(db, 101, 'Первый', null);
    lyudi.zapomnit(db, 102, 'Второй', null);
    lyudi.zapomnit(db, 103, 'Третий', null);
    metki.zapisatCheloveku(db, 101, 'vk-posty');
    metki.zapisatCheloveku(db, 102, 'vk-posty');
    metki.zapisatCheloveku(db, 103, 'chuzhaya-ssylka');
    lyudi.zapomnit(db, 104, 'Четвёртый', null); // без метки вовсе

    zakazy.sozdatIliVernut(db, {
      tgId: 101,
      produktId: 'kling',
      planId: ZHIVOY_PLAN,
      nazvanie: 'Kling AI, Pro',
      cenaKop: 0,
      mesyacev: 0,
      vidAkkaunta: 'novy',
    });

    const svodka = metki.svodka(db, null, null);
    const vk = svodka.find((r) => r.kod === 'vk-posty');
    assert.ok(vk, 'заведённой метки нет в сводке');
    assert.equal(vk!.lyudey, 2);
    assert.equal(vk!.zakazov, 1);
    assert.equal(vk!.nazvanie, 'Посты во ВКонтакте', 'имя из панели не подтянулось');
    assert.equal(vk!.svoya, true);

    const chuzhaya = svodka.find((r) => r.kod === 'chuzhaya-ssylka');
    assert.ok(chuzhaya, 'НЕРАЗМЕЧЕННЫЙ ТРАФИК ПРОПАЛ из сводки');
    assert.equal(chuzhaya!.svoya, false);
    assert.equal(chuzhaya!.nazvanie, 'chuzhaya-ssylka', 'у незаведённой метки должен быть виден код');

    const bez = svodka.find((r) => r.kod === '');
    assert.ok(bez, 'строки «без метки» нет');
    assert.equal(bez!.lyudey, 1);
  } finally {
    await s.zakryt();
  }
});

test('убранная метка не стирает людей: они остаются под своим кодом', async () => {
  const s = await stend();
  try {
    const db = s.l.db;
    metki.zavesti(db, { kod: 'vk', nazvanie: 'ВКонтакте' }, VLADELEC);
    lyudi.zapomnit(db, 201, 'Кто-то', null);
    metki.zapisatCheloveku(db, 201, 'vk');

    metki.ubrat(db, 'vk');
    const stroka = metki.svodka(db, null, null).find((r) => r.kod === 'vk');
    assert.ok(stroka, 'вместе с именем метки пропали и люди');
    assert.equal(stroka!.lyudey, 1);
    assert.equal(stroka!.svoya, false);
    assert.equal(lyudi.chelovek(db, 201)?.metka, 'vk', 'метку стёрли у человека');
  } finally {
    await s.zakryt();
  }
});
