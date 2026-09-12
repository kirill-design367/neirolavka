/**
 * Проба Робокассы: сходится ли подпись, НЕ ТРАТЯ НАСТОЯЩИХ ДЕНЕГ.
 *
 * Зачем это отдельной командой. В приёме платежей ровно одно место,
 * которое нельзя проверить с ноутбука, — подпись: её принимает или
 * не принимает чужой сервер, и ответ у него один на все причины —
 * «ошибка 29». Причин же несколько: не тот пароль (боевой в тестовом
 * режиме), не тот алгоритм, не тот вид чека в строке подписи. Проба
 * перебирает их сама и говорит, какая сочетание прошло.
 *
 * ПРОБА НЕ СОЗДАЁТ ЗАКАЗОВ И НЕ ТРОГАЕТ БАЗУ. Она собирает ссылку
 * тем же кодом, что и бот, и спрашивает Робокассу, годится ли такая.
 * Номер счёта берётся заведомо большой и случайный по времени запуска:
 * повторный номер Робокасса встречает ошибкой 40, а нам нужно
 * проверить подпись, а не поймать ошибку про номер.
 *
 * Запуск на сервере:
 *   sudo bash -c 'set -a; . /etc/neirolavka-bot/okruzhenie; set +a;
 *     cd /home/bot/neirolavka-bot/current && node dist/bot/src/oplata/proba.js'
 */

import { prochitat } from '../config.js';
import { ssylkaOplaty, ALGORITMY } from './robokassa.js';
import type { NastroykiRobokassy, Algoritm, VidChekaVPodpisi } from './robokassa.js';
import type { Zakaz } from '../db/zakazy.js';

/** Заказ-пустышка. В базу не попадает — нужен только ради названия. */
const OBRAZEC = {
  id: 0,
  nazvanie: 'Проба подписи, Нейролавка',
  cena_kop: 10000,
  skidka_kop: 0,
  oplacheno_kop: 0,
} as unknown as Zakaz;

/** Что ответила Робокасса. */
type Otvet = { kod: number; oshibka: string | null; kusok: string };

/**
 * Разбор ответа.
 *
 * Робокасса отвечает страницей, а не кодом: на ошибке там текст
 * с номером. Ищем номер, а не фразу — фразы меняются, номера нет.
 */
function razobratOtvet(kod: number, telo: string): Otvet {
  const bezTegov = telo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const nomer = /(?:код|code|ошибк\w*)\D{0,20}(\d{1,3})/i.exec(bezTegov);
  return {
    kod,
    oshibka: nomer ? nomer[1]! : null,
    kusok: bezTegov.slice(0, 220),
  };
}

async function sprosit(url: string): Promise<Otvet> {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    return razobratOtvet(r.status, await r.text());
  } catch (e) {
    return { kod: 0, oshibka: null, kusok: `не достучались: ${(e as Error).message}` };
  }
}

/** Ссылка без подписи и без чека — их длина мешает читать. */
function korotko(url: string): string {
  return url.replace(/(SignatureValue=)[0-9a-f]+/i, '$1…').replace(/(Receipt=)[^&]+/i, '$1…');
}

async function glavnoe(): Promise<number> {
  const n = prochitat(process.env).robokassa;
  if (!n.login) {
    console.log('ПЛОХО: NEIROLAVKA_ROBOKASSA_LOGIN пуст — проверять нечего.');
    return 1;
  }
  const parol1 = n.test ? n.testParol1 : n.parol1;
  if (!parol1) {
    console.log(
      `ПЛОХО: в ${n.test ? 'тестовом' : 'боевом'} режиме нужен ` +
        `${n.test ? 'NEIROLAVKA_ROBOKASSA_TEST_PAROL1' : 'NEIROLAVKA_ROBOKASSA_PAROL1'}, а он пуст.`,
    );
    return 1;
  }

  console.log(`Магазин: ${n.login}`);
  console.log(`Режим: ${n.test ? 'ТЕСТОВЫЙ — деньги не списываются' : 'БОЕВОЙ — деньги настоящие'}`);
  console.log(`Алгоритм подписи: ${n.algoritm}`);
  console.log(`Чек в подписи: ${n.chekVPodpisi}`);
  console.log(`Система налогообложения: ${n.sno || 'из кабинета магазина'}`);
  console.log('');

  /* Номер счёта — от времени запуска. Он заведомо не совпадёт
     с настоящими номерами из базы (те растут с единицы), и два
     запуска подряд не поймают ошибку 40 друг от друга. */
  const nomer = 900_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000);

  /* Перебираем ровно то, что может разойтись с кабинетом: вид чека
     в подписи и алгоритм. Пароли не перебираем — их подстановка
     наугад была бы подбором, а не пробой. */
  const vidy: VidChekaVPodpisi[] = [n.chekVPodpisi, n.chekVPodpisi === 'kodirovanny' ? 'syroy' : 'kodirovanny'];
  const algoritmy: Algoritm[] = [n.algoritm, ...ALGORITMY.filter((a) => a !== n.algoritm)];

  let horoshee: { vid: VidChekaVPodpisi; algoritm: Algoritm } | null = null;
  let shag = 0;
  for (const algoritm of algoritmy) {
    for (const vid of vidy) {
      shag += 1;
      const nn: NastroykiRobokassy = { ...n, algoritm, chekVPodpisi: vid };
      const url = ssylkaOplaty(nn, { zakaz: OBRAZEC, nomer: nomer + shag, summaKop: 10000 });
      const o = await sprosit(url);
      const vyvod = o.oshibka === '29' ? 'подпись НЕ принята (29)' : o.oshibka ? `ошибка ${o.oshibka}` : 'подпись принята';
      console.log(`${algoritm.padEnd(10)} чек ${vid.padEnd(12)} → HTTP ${o.kod}, ${vyvod}`);
      if (!o.oshibka && o.kod === 200 && !horoshee) {
        horoshee = { vid, algoritm };
        console.log(`            ${korotko(url)}`);
      }
      // Первый же успех на объявленных настройках — дальше искать нечего.
      if (horoshee && algoritm === n.algoritm && vid === n.chekVPodpisi) break;
    }
    if (horoshee) break;
  }

  console.log('');
  if (!horoshee) {
    console.log('ПЛОХО: ни одно сочетание не прошло.');
    console.log('  Проверьте по порядку:');
    console.log('   • режим и пароли: в тестовом режиме нужны ТЕСТОВЫЕ пароли (иначе ошибка 29);');
    console.log('   • алгоритм подписи в кабинете Робокассы;');
    console.log('   • что магазин активирован и тестовый режим в кабинете разрешён.');
    return 1;
  }
  if (horoshee.vid === n.chekVPodpisi && horoshee.algoritm === n.algoritm) {
    console.log('Подпись сходится на объявленных настройках. Менять нечего.');
    return 0;
  }
  console.log('Подпись сходится, но НЕ на объявленных настройках. Поправьте окружение:');
  if (horoshee.algoritm !== n.algoritm) {
    console.log(`  NEIROLAVKA_ROBOKASSA_ALGORITM=${horoshee.algoritm}`);
  }
  if (horoshee.vid !== n.chekVPodpisi) {
    console.log(`  NEIROLAVKA_ROBOKASSA_CHEK_V_PODPISI=${horoshee.vid}`);
  }
  console.log('  …и перезапустите службу: systemctl restart neirolavka-bot');
  return 1;
}

glavnoe().then(
  (kod) => process.exit(kod),
  (e) => {
    console.log('ПЛОХО:', (e as Error).message);
    process.exit(1);
  },
);
