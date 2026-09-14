/**
 * ПРОБА ПОДПИСИ УВЕДОМЛЕНИЯ: почему ResultURL не сходится.
 *
 * Отдельная команда, и вот зачем. Уведомление об оплате приходит
 * ОДИН раз от чужого сервера. Не сошлась подпись — заказ остался
 * неоплаченным при списанных деньгах, а в журнале одна строка
 * в минуту («Робокасса повторяет»), по которой разобраться нельзя:
 * причин у отказа несколько, а ответ на все был один.
 *
 * Повторить такое уведомление руками НЕЛЬЗЯ: подпись считает
 * Робокасса своим паролем, и придумать её мы не можем — в том и смысл
 * пароля № 2. Поэтому отказ записывается в базу (`db/otkazy.ts`),
 * а эта проба разбирает записанное. Денег она не тратит, в сеть
 * не ходит и ничего не меняет.
 *
 * ЧТО ОНА ДЕЛАЕТ. Берёт последний отклонённый отказ и перебирает
 * сетку: шесть алгоритмов × четыре пароля (боевые № 1 и № 2,
 * тестовые № 1 и № 2) × с пользовательскими параметрами в подписи
 * и без. Двадцать четыре сочетания, из которых сойтись может ровно
 * одно, — и оно называет беду по имени:
 *
 *   • сошлось на ПАРОЛЕ № 2 и другом алгоритме → алгоритм. В кабинете
 *     Робокассы хеш выбирается рядом С КАЖДЫМ адресом, и у Result URL
 *     он свой; лечится `NEIROLAVKA_ROBOKASSA_ALGORITM_RESULT`;
 *   • сошлось на ПАРОЛЕ № 1 → в файле окружения пароли перепутаны
 *     местами либо в кабинете у ResultURL стоит не тот пароль;
 *   • сошлось на ТЕСТОВОМ пароле → магазин ведёт платёж тестовым,
 *     а мы считаем боевым (или наоборот);
 *   • не сошлось НИЧЕГО → пароль № 2 просто не тот. Это уже
 *     не про код: пароль надо взять в кабинете заново.
 *
 * Тот же закон, что у пробы ссылки: ищем не «прошло», а ЧТО ИМЕННО
 * изменило ответ. Пока все сочетания отвечают одинаково, они
 * не различают ничего.
 *
 * СЕКРЕТОВ В ВЫВОДЕ НЕТ. Пароли не печатаются ни целиком, ни
 * частями — только отпечаток: длина и первые знаки sha256. Отпечаток
 * ни во что не разворачивается, но его достаточно, чтобы сравнить
 * пароль в файле с паролем в кабинете, не показывая ни одного знака.
 * Подпись при этом не секрет: она летит от Робокассы к нам открытым
 * полем запроса и лежит в журнале nginx.
 *
 * ЗАПУСК НА СЕРВЕРЕ — одной строкой, БЕЗ ОБОЛОЧКИ. Подключать файл
 * окружения через `. файл` нельзя: для bash это программа, и строка,
 * которую он не прочтёт как присваивание, будет выполнена и
 * напечатана обратно вместе с содержимым. Подробности —
 * в `lib/okruzhenie.ts`.
 *
 *   sudo node /home/bot/neirolavka-bot/current/dist/bot/src/oplata/proba-podpisi.js
 */

import { createHash } from 'node:crypto';

import { robokassa } from '../config.js';
import { ALGORITMY, kopeykiIzSummy, podpisiSovpali, shpHvost } from './robokassa.js';
import type { Algoritm, NastroykiRobokassy } from './robokassa.js';
import { prochitatFayl, tolkoS, FAYL_OKRUZHENIYA } from '../lib/okruzhenie.js';
import Database from 'better-sqlite3';
import * as otkazy from '../db/otkazy.js';

/**
 * Отпечаток секрета: сказать, ТОТ ЛИ он, не показав ни знака.
 *
 * Длина плюс двенадцать знаков sha256. Обратно не разворачивается,
 * а сравнить пароль в файле с паролем в кабинете позволяет: владелец
 * считает отпечаток от того, что видит в кабинете, и сверяет.
 */
function otpechatok(s: string): string {
  if (!s) return 'НЕ ЗАДАН';
  return `задан, ${s.length} знаков, отпечаток ${createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12)}`;
}

/** Все пароли, которыми Робокасса могла подписать уведомление. */
type Kandidat = { imya: string; parol: string };

function kandidaty(n: NastroykiRobokassy): Kandidat[] {
  return [
    { imya: 'боевой № 2', parol: n.parol2 },
    { imya: 'боевой № 1', parol: n.parol1 },
    { imya: 'тестовый № 2', parol: n.testParol2 },
    { imya: 'тестовый № 1', parol: n.testParol1 },
  ];
}

/** Строка подписи уведомления и её хеш — теми же правилами, что в бою. */
function podpis(
  algoritm: Algoritm,
  outSum: string,
  invId: string,
  parol: string,
  shp: string[],
): string {
  return createHash(algoritm)
    .update([outSum, invId, parol, ...shp].join(':'), 'utf8')
    .digest('hex');
}

/**
 * Откуда брать настройки.
 *
 * С боевого файла, если он читается (запуск от root на сервере),
 * иначе из обычного окружения. Берутся ТОЛЬКО переменные Робокассы
 * и путь к базе: токена бота, ключа доступов и ключа хранилища
 * в этом процессе нет вовсе — им неоткуда утечь.
 */
function nastroyki(): { n: NastroykiRobokassy; baza: string; otkuda: string } {
  const put = process.env['NEIROLAVKA_OKRUZHENIE'] || FAYL_OKRUZHENIYA;
  const f = prochitatFayl(put);
  if (!f) {
    return {
      n: robokassa(process.env),
      baza: process.env['NEIROLAVKA_BAZA'] ?? '',
      otkuda: 'окружение процесса',
    };
  }
  if (f.plohie.length) {
    /* НОМЕРА строк, а не содержимое: в негодной строке и лежит
       секрет, ради которого проба перестала пользоваться оболочкой.
       И это не мелочь для нашей беды: пароль № 2, съехавший
       на свою строку, systemd не прочтёт вовсе — подпись будет
       считаться пустым паролем и не сойдётся никогда. */
    console.log(
      `ВНИМАНИЕ: строки ${f.plohie.join(', ')} файла окружения не читаются как «ИМЯ=значение». ` +
        'Скорее всего, значение съехало на свою строку при вставке. Содержимое не печатаю. ' +
        'Если среди них пароль № 2 — беда найдена, и это она.',
    );
  }
  return {
    n: robokassa(tolkoS(f.pary, 'NEIROLAVKA_ROBOKASSA_')),
    baza: f.pary['NEIROLAVKA_BAZA'] ?? process.env['NEIROLAVKA_BAZA'] ?? '',
    otkuda: put,
  };
}

function glavnoe(): number {
  const { n, baza, otkuda } = nastroyki();

  console.log('── НАСТРОЙКИ ──────────────────────────────────────────');
  console.log(`  файл окружения:      ${otkuda}`);
  console.log(`  магазин:             ${n.login || 'НЕ ЗАДАН'}`);
  console.log(`  режим:               ${n.test ? 'ТЕСТОВЫЙ' : 'боевой'}`);
  console.log(`  алгоритм ссылки:     ${n.algoritm}`);
  console.log(`  алгоритм ResultURL:  ${n.algoritmResult}`);
  console.log(`  пароль № 1:          ${otpechatok(n.parol1)}`);
  console.log(`  пароль № 2:          ${otpechatok(n.parol2)}`);
  console.log(`  тестовый № 1:        ${otpechatok(n.testParol1)}`);
  console.log(`  тестовый № 2:        ${otpechatok(n.testParol2)}`);
  console.log('  (паролей в выводе нет: отпечаток обратно не разворачивается)');

  if (!baza) {
    console.log('\nПЛОХО: не знаю, где база (NEIROLAVKA_BAZA). Разбирать нечего.');
    return 1;
  }

  let posledniy: otkazy.Otkaz | null = null;
  try {
    /* ТОЛЬКО НА ЧТЕНИЕ, и это не осторожность вообще, а конкретная
       беда. Проба запускается от root — иначе файл окружения ей
       не прочесть. Обычное открытие базы применяет миграции, засевает
       каталог и заводит рядом файлы журнала WAL: заведённые РУТОМ,
       они станут недоступны пользователю `bot`, и бот, который сейчас
       работает, потеряет собственную базу. Разбор отказа не имеет
       права стоить лавке базы.

       Read-only при этом требует, чтобы `-shm` уже существовал, —
       он есть, пока бот запущен. Не открылось и бот стоит: поднимите
       службу и повторите. */
    const db = new Database(baza, { readonly: true, fileMustExist: true }) as unknown as Parameters<
      typeof otkazy.posledniy
    >[0];
    posledniy = otkazy.posledniy(db);
    const vse = otkazy.svezhie(db);
    console.log(`\n── ОТКЛОНЁННЫЕ УВЕДОМЛЕНИЯ ──────────────────────────`);
    if (vse.length === 0) {
      console.log('  ни одного не записано.');
    }
    for (const o of vse) {
      console.log(
        `  ${o.poslednee} · ${o.pochemu} · повторов ${o.povtorov} · ` +
          `счёт ${o.pary['InvId'] ?? o.pary['invId'] ?? '—'}`,
      );
    }
  } catch (e) {
    const chto = (e as Error).message;
    console.log(`\nПЛОХО: не прочитал отказы из ${baza}: ${chto}`);
    if (/no such table/i.test(chto)) {
      console.log(
        'Таблицы отказов ещё нет — значит бот с этой правкой не выложен.\n' +
          'Записывать отклонённые уведомления он начал только с неё.',
      );
    } else {
      console.log('Если бот сейчас остановлен — поднимите службу и повторите: читаю я только на чтение.');
    }
    return 1;
  }

  if (!posledniy) {
    console.log(
      '\nНИ ОДНОГО ОТКАЗА НЕ ЗАПИСАНО — и это не «всё хорошо», а «разбирать нечего».\n' +
        'Если Робокасса прямо сейчас повторяет уведомление, значит бот с этой правкой\n' +
        'ещё не выложен: записывать отказы он начал только с неё.',
    );
    return 1;
  }

  const p = posledniy.pary;
  const shp = shpHvost(p);

  /* ДВА НАБОРА ИМЁН, И ПРОБА ОБЯЗАНА ЗНАТЬ ОБА. Робокасса шлёт
     на ResultURL и современный `OutSum`/`InvId`/`SignatureValue`,
     и старый `out_summ`/`inv_id`/`crc` — в настоящем уведомлении
     видны все шесть полей. Подпись считается от ОДНОГО из них,
     и какого — заранее неизвестно. */
  const nabory = [
    {
      imya: 'OutSum/InvId/SignatureValue',
      outSum: (p['OutSum'] ?? p['outSum'] ?? '').trim(),
      invId: (p['InvId'] ?? p['invId'] ?? '').trim(),
      podpis: (p['SignatureValue'] ?? p['signatureValue'] ?? '').trim(),
    },
    {
      imya: 'out_summ/inv_id/crc',
      outSum: (p['out_summ'] ?? p['OutSumm'] ?? '').trim(),
      invId: (p['inv_id'] ?? '').trim(),
      podpis: (p['crc'] ?? p['CRC'] ?? '').trim(),
    },
  ].filter((x) => x.outSum && x.invId && x.podpis);

  console.log('\n── ПОСЛЕДНИЙ ОТКАЗ ──────────────────────────────────');
  console.log(`  когда:               ${posledniy.vpervye} → ${posledniy.poslednee}`);
  console.log(`  повторов:            ${posledniy.povtorov}`);
  console.log(`  почему отклонили:    ${posledniy.pochemu}`);
  console.log(`  поля уведомления:    ${posledniy.imena.join(', ') || '—'}`);
  for (const nb of nabory) {
    console.log(`  набор ${nb.imya}:`);
    console.log(`      сумма ${nb.outSum} · счёт ${nb.invId} · подпись ${nb.podpis}`);
  }
  if (shp.length) console.log(`  Shp_-параметры:      ${shp.join(', ')}`);

  if (nabory.length === 0) {
    console.log(
      '\nПОЛЕЙ ПОДПИСИ В УВЕДОМЛЕНИИ НЕТ ВОВСЕ. Ни OutSum/InvId/SignatureValue,\n' +
        'ни out_summ/inv_id/crc. Разбирать нечего: смотрите список полей выше —\n' +
        'скорее всего, на этот адрес постучался не тот, кого мы ждали.',
    );
    return 1;
  }

  /* ВИДЫ СТРОКИ СУММЫ. Подпись считается ОТ СТРОКИ: `1.000000`
     и `1.00` дают разные хеши. Если Робокасса подписала не то,
     что прислала (а такое бывает: в уведомлении одно поле, а
     подписано другое), узнать это можно только перебором. */
  const vidySummy = (outSum: string): { imya: string; znachenie: string }[] => {
    const kop = kopeykiIzSummy(outSum);
    const spisok = [{ imya: 'как пришла', znachenie: outSum }];
    if (kop !== null) {
      const dvaZnaka = (kop / 100).toFixed(2);
      const bezHvosta = String(kop / 100);
      const celoe = String(Math.round(kop / 100));
      for (const [imya, znachenie] of [
        ['два знака', dvaZnaka],
        ['без нулей на конце', bezHvosta],
        ['целые рубли', celoe],
      ] as const) {
        if (!spisok.some((x) => x.znachenie === znachenie)) spisok.push({ imya, znachenie });
      }
    }
    return spisok;
  };

  console.log('\n── ПЕРЕБОР: ЧЕМ ЭТО МОГЛИ ПОДПИСАТЬ ──────────────────');
  const nashlos: { nabor: string; algoritm: string; parol: string; summa: string; shp: boolean }[] = [];
  for (const nb of nabory) {
    for (const k of kandidaty(n)) {
      if (!k.parol) continue;
      for (const a of ALGORITMY) {
        for (const vid of vidySummy(nb.outSum)) {
          for (const sHvostom of shp.length ? [true, false] : [false]) {
            const nash = podpis(a, vid.znachenie, nb.invId, k.parol, sHvostom ? shp : []);
            if (!podpisiSovpali(nb.podpis, nash)) continue;
            nashlos.push({
              nabor: nb.imya,
              algoritm: a,
              parol: k.imya,
              summa: vid.imya,
              shp: sHvostom,
            });
            console.log(
              `  СОШЛОСЬ: набор ${nb.imya}, ${a}, ${k.imya}, сумма «${vid.imya}»` +
                `${shp.length ? (sHvostom ? ', с Shp_' : ', без Shp_') : ''}`,
            );
          }
        }
      }
    }
  }

  if (nashlos.length === 0) {
    console.log('  ни одно из сочетаний не сошлось.');
    console.log(
      '\nВЫВОД: ПАРОЛЬ № 2 НЕ ТОТ. Ни один из четырёх паролей файла ни при каком\n' +
        'из шести алгоритмов, ни на одном из наборов полей и ни при одном виде\n' +
        'записи суммы не даёт присланную подпись — значит Робокасса подписала\n' +
        'уведомление паролем, которого у нас нет.\n' +
        'Что делать: Робокасса → Мои магазины → Технические настройки →\n' +
        'взять пароль № 2 заново и положить в NEIROLAVKA_ROBOKASSA_PAROL2.\n' +
        'Проверьте заодно, не съехало ли значение на свою строку при вставке\n' +
        'и нет ли в нём пробела на конце: для systemd это другой пароль.',
    );
    return 1;
  }

  console.log('\n── ЧТО ЭТО ЗНАЧИТ ────────────────────────────────────');
  const it = nashlos[0]!;
  const bedy: string[] = [];

  if (it.parol !== 'боевой № 2' && it.parol !== 'тестовый № 2') {
    bedy.push(
      'ПОДПИСАНО ПАРОЛЕМ № 1, а проверяем мы паролем № 2. Либо в файле окружения\n' +
        'пароли стоят наоборот, либо в кабинете у Result URL прописан не тот.\n' +
        'Менять надо ФАЙЛ, а не код: формула ResultURL с паролем № 2 — это то,\n' +
        'на чём держится доверие к слову «оплачено».',
    );
  } else if (it.parol.startsWith('тестовый') !== n.test) {
    bedy.push(
      `ПОДПИСАНО ${it.parol.toUpperCase()} паролем, а платёж мы считаем ` +
        `${n.test ? 'тестовым' : 'боевым'}.\n` +
        'Смотреть NEIROLAVKA_ROBOKASSA_TEST и то, активирован ли магазин:\n' +
        'неактивированный умеет только тестовые платежи.',
    );
  }

  if (it.algoritm !== n.algoritmResult) {
    bedy.push(
      `АЛГОРИТМ НЕ ТОТ: подписано «${it.algoritm}», а мы считаем «${n.algoritmResult}».\n` +
        'В кабинете Робокассы алгоритм хеша выбирается РЯДОМ С КАЖДЫМ адресом,\n' +
        'и у Result URL он свой — с алгоритмом ссылки совпадать не обязан.\n' +
        'Лечится одной строкой в /etc/neirolavka-bot/okruzhenie:\n' +
        `  NEIROLAVKA_ROBOKASSA_ALGORITM_RESULT=${it.algoritm}\n` +
        'и перезапуском службы: sudo systemctl restart neirolavka-bot',
    );
  }

  if (it.summa !== 'как пришла') {
    bedy.push(
      `СУММА ПОДПИСАНА НЕ В ТОМ ВИДЕ, В КАКОМ ПРИСЛАНА: подпись сходится\n` +
        `на записи «${it.summa}», а не на строке из поля. Это уже не настройка,\n` +
        'а расхождение протокола — покажите этот вывод тому, кто будет править\n' +
        'разбор: сейчас он подписывает строку ровно как пришла.',
    );
  }

  if (bedy.length === 0) {
    console.log(
      'Сочетание совпало с нынешними настройками — значит подпись СХОДИТСЯ,\n' +
        `и беда была не в ней, а в том, что записано выше: ${posledniy.pochemu}.\n` +
        (posledniy.pochemu === 'summa_ne_chislo'
          ? 'Сумму прочесть не удалось при верной подписи — покажите этот вывод\n' +
            'тому, кто правит разбор: уведомление настоящее.\n'
          : '') +
        'Если бот с последней правкой уже выложен, дождитесь следующего повтора:\n' +
        'Робокасса шлёт уведомление раз в минуту, пока не получит «OK».',
    );
  } else {
    for (const b of bedy) console.log(b + '\n');
  }

  console.log(`Набор полей, от которого сошлась подпись: ${it.nabor}`);
  return 0;
}

process.exit(glavnoe());
