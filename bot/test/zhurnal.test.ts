import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skryt, bezSekretov, zhurnal } from '../src/lib/zhurnal.js';

test('зарегистрированный секрет не проходит в журнал', () => {
  skryt('123456:AAHtoken-bota-nastoyashchiy');
  const s = bezSekretov('запрос к https://api.telegram.org/bot123456:AAHtoken-bota-nastoyashchiy/getMe упал');
  assert.equal(s.includes('AAHtoken'), false);
  assert.equal(s.includes('‹скрыто›'), true);
});

test('секрет вырезается из строки во всех местах', () => {
  skryt('sekret-vebhuka-dlinnyy');
  const s = bezSekretov('/tg/sekret-vebhuka-dlinnyy и ещё раз /tg/sekret-vebhuka-dlinnyy');
  assert.equal(s.includes('sekret-vebhuka'), false);
});

test('короткие строки секретами не считаются: иначе вырежется полтекста', () => {
  skryt('ab');
  assert.equal(bezSekretov('таблица'), 'таблица');
});

/* ── ПРИЧИНА, А НЕ ОДИН СТЕКТРЕЙС ──────────────────────────────────
 *
 * На боевом в журнал шли стектрейсы из модуля уведомлений без единого
 * слова о том, что случилось. Виновата была одна строка сборки текста:
 * `${name}: ${message}` у ошибки с ПУСТЫМ `message` не говорит ничего,
 * а у «счастливых глазок» Node он именно пуст — причины лежат
 * в `errors`, по одной на каждый адрес.
 */

function snyat(f: () => void): string {
  const bylo = process.stdout.write.bind(process.stdout);
  const bylaOsh = process.stderr.write.bind(process.stderr);
  let out = '';
  const lovit = (s: string | Uint8Array): boolean => {
    out += typeof s === 'string' ? s : Buffer.from(s).toString('utf8');
    return true;
  };
  (process.stdout as unknown as { write: unknown }).write = lovit;
  (process.stderr as unknown as { write: unknown }).write = lovit;
  try {
    f();
  } finally {
    (process.stdout as unknown as { write: unknown }).write = bylo;
    (process.stderr as unknown as { write: unknown }).write = bylaOsh;
  }
  return out;
}

test('ошибка БЕЗ текста объясняется вложенными причинами', () => {
  const a = Object.assign(new Error('connect ETIMEDOUT 149.154.167.220:443'), {
    code: 'ETIMEDOUT',
    syscall: 'connect',
  });
  const b = Object.assign(new Error('connect ENETUNREACH 2001:67c::9:443'), { code: 'ENETUNREACH' });
  const svodnaya = new AggregateError([a, b]);
  assert.equal(svodnaya.message, '', 'проба смотрит не на то: у этой ошибки текст непустой');

  const vyvod = snyat(() => zhurnal.vnimanie('не доставлено:', svodnaya));
  assert.ok(vyvod.includes('ETIMEDOUT'), 'ПРИЧИНЫ НЕТ В ЖУРНАЛЕ — остался один стектрейс');
  assert.ok(vyvod.includes('ENETUNREACH'), 'вторая причина потеряна');
  assert.ok(vyvod.includes('без текста'), 'молчание ошибки надо называть вслух');
});

test('завёрнутая причина разворачивается', () => {
  const nizhe = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  const http = Object.assign(new Error("Network request for 'sendMessage' failed!"), { error: nizhe });
  http.name = 'HttpError';
  const vyvod = snyat(() => zhurnal.vnimanie('не доставлено:', http));
  assert.ok(vyvod.includes('ECONNRESET'), 'настоящая причина осталась завёрнутой');
});

test('тело запроса к Telegram в журнал НЕ попадает', () => {
  /* У GrammyError в `payload` лежит то, что мы отправляли, — а при
     выдаче доступа это логин и пароль покупателя. Правило «не писать
     пароли в журнал ни при какой ошибке» выше удобства разбора. */
  const g = Object.assign(new Error("Call to 'sendMessage' failed! (403: Forbidden)"), {
    error_code: 403,
    description: 'Forbidden: bot was blocked by the user',
    method: 'sendMessage',
    payload: { chat_id: 1, text: 'Пароль: parol-ot-akkaunta-pokupatelya' },
  });
  g.name = 'GrammyError';
  const vyvod = snyat(() => zhurnal.vnimanie('не доставлено:', g));
  assert.ok(vyvod.includes('403'), 'номер ответа Telegram нужен');
  assert.ok(vyvod.includes('blocked by the user'), 'описание ответа нужно');
  assert.ok(
    !vyvod.includes('parol-ot-akkaunta-pokupatelya'),
    'ПАРОЛЬ ПОКУПАТЕЛЯ УЕХАЛ В ЖУРНАЛ вместе с телом запроса',
  );
});

test('заголовок не повторяется дважды', () => {
  const vyvod = snyat(() => zhurnal.oshibka('упало:', new Error('одна беда')));
  assert.equal(
    vyvod.split('одна беда').length - 1,
    1,
    'текст ошибки напечатан дважды: заголовком и первой строкой стектрейса',
  );
});
