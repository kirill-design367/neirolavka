/**
 * Проба Робокассы: сходится ли подпись, НЕ ТРАТЯ НАСТОЯЩИХ ДЕНЕГ.
 *
 * Зачем это отдельной командой. В приёме платежей ровно одно место,
 * которое нельзя проверить с ноутбука, — подпись: её принимает или
 * не принимает чужой сервер. Причин отказа несколько (не тот пароль,
 * не тот алгоритм, не тот вид чека в строке подписи), а ответ на все
 * один — «ошибка 29». Проба перебирает сочетания и говорит, какое
 * прошло.
 *
 * ВЕРДИКТ СТАВИТСЯ ПО ТОМУ, ЧТО ОТВЕТ ИЗМЕНИЛСЯ, а не по тому, что
 * всё хорошо. Это и есть главный урок первого захода. Проба искала
 * «страницу оплаты без ошибки» — а её не бывало, пока магазин
 * не был настроен: там, где подпись принята, Робокасса отвечала
 * ДРУГОЙ ошибкой (838, про тестовые параметры). Одиннадцать
 * сочетаний из двенадцати дали 29, одно — 838, и именно оно
 * правильное. Мера, у которой «хорошо» недостижимо, ничего
 * не различает. (Сейчас кабинет настроен, и страница оплаты
 * на `md5` + сыром чеке открывается по-настоящему.)
 *
 * И ВТОРОЙ УРОК, ровно обратный: строгость разбора не имеет права
 * превращаться в ложный успех. Проба один раз объявила «ошибку
 * 8381» на открывшейся странице оплаты — это был код символа рубля
 * из её же JavaScript. Поэтому теперь отдельно спрашивается,
 * РУГАЕТСЯ ли страница вообще: «номера не нашлось» само по себе
 * не значит «всё хорошо», и ошибка, которую мы не научились
 * читать, останавливает пробу, а не засчитывается успехом.
 *
 * ПРОБА НЕ СОЗДАЁТ ЗАКАЗОВ И НЕ ТРОГАЕТ БАЗУ. Она собирает ссылку
 * тем же кодом, что и бот, и спрашивает Робокассу, годится ли такая.
 * Номер счёта берётся заведомо большой и случайный по времени
 * запуска: повторный номер Робокасса встречает ошибкой 40, а нам
 * нужно проверить подпись, а не поймать ошибку про номер.
 *
 * ПРОБА ЧИТАЕТ ФАЙЛ ОКРУЖЕНИЯ САМА И БЕРЁТ ИЗ НЕГО ТОЛЬКО
 * `NEIROLAVKA_ROBOKASSA_*`. Ни токена бота, ни ключа доступов,
 * ни ключа хранилища в этом процессе нет вовсе — и потому им неоткуда
 * утечь. Подключать файл оболочкой (`. /etc/…/okruzhenie`) НЕЛЬЗЯ:
 * для bash это программа, и любая строка, которую он не прочтёт как
 * присваивание, будет выполнена и напечатана обратно вместе
 * со своим содержимым. Подробности — в `lib/okruzhenie.ts`.
 *
 * Запуск на сервере — одной строкой, без оболочки и без переменных:
 *
 *   sudo node /home/bot/neirolavka-bot/current/dist/bot/src/oplata/proba.js
 */

import { robokassa } from '../config.js';
import { ssylkaOplaty, ALGORITMY, OSHIBKI, nomerOshibki } from './robokassa.js';
import type { NastroykiRobokassy, Algoritm, VidChekaVPodpisi } from './robokassa.js';
import { prochitatFayl, tolkoS, FAYL_OKRUZHENIYA } from '../lib/okruzhenie.js';
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
type Otvet = {
  kod: number;
  /** Номер ошибки, если страница его назвала. */
  oshibka: string | null;
  /** Страница ругается вообще? Это ДРУГОЙ вопрос, чем «есть ли номер». */
  rugaetsya: boolean;
  kusok: string;
  dostuchalis: boolean;
};

async function sprosit(url: string): Promise<Otvet> {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const o = nomerOshibki(await r.text());
    return { kod: r.status, oshibka: o.nomer, rugaetsya: o.oshibochnaya, kusok: o.tekst, dostuchalis: true };
  } catch (e) {
    return { kod: 0, oshibka: null, rugaetsya: false, kusok: (e as Error).message, dostuchalis: false };
  }
}

/** Ссылка без подписи и без чека — их длина мешает читать. */
function korotko(url: string): string {
  return url.replace(/(SignatureValue=)[0-9a-f]+/i, '$1…').replace(/(Receipt=)[^&]+/i, '$1…');
}

/** Подпись принята? Всё, кроме 29, означает «да, дальше другое». */
function podpisProshla(o: Otvet): boolean {
  return o.dostuchalis && o.kod === 200 && o.oshibka !== '29';
}

/**
 * Откуда брать настройки.
 *
 * С боевого файла, если он читается (то есть при запуске от root
 * на сервере), иначе — из обычного окружения: в разработке файла нет,
 * и это не поломка. В любом случае берутся ТОЛЬКО переменные
 * Робокассы.
 */
function nastroyki(): { n: NastroykiRobokassy; otkuda: string } {
  const put = process.env['NEIROLAVKA_OKRUZHENIE'] || FAYL_OKRUZHENIYA;
  const f = prochitatFayl(put);
  if (!f) {
    return { n: robokassa(process.env), otkuda: 'окружение процесса' };
  }
  if (f.plohie.length) {
    /* Номера строк, а не их содержимое: в негодной строке и лежит
       секрет, ради которого проба перестала пользоваться оболочкой. */
    console.log(
      `ВНИМАНИЕ: строки ${f.plohie.join(', ')} файла окружения не читаются как «ИМЯ=значение». ` +
        'Скорее всего, значение съехало на свою строку при вставке. Содержимое не печатаю.',
    );
  }
  return { n: robokassa(tolkoS(f.pary, 'NEIROLAVKA_ROBOKASSA_')), otkuda: put };
}

async function glavnoe(): Promise<number> {
  const { n, otkuda } = nastroyki();
  if (!n.login) {
    console.log(`ПЛОХО: NEIROLAVKA_ROBOKASSA_LOGIN пуст (смотрел: ${otkuda}) — проверять нечего.`);
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

  console.log(`Настройки: ${otkuda} (только NEIROLAVKA_ROBOKASSA_*)`);
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

  let horoshee: { vid: VidChekaVPodpisi; algoritm: Algoritm; otvet: Otvet; url: string } | null = null;
  let shag = 0;
  for (const algoritm of algoritmy) {
    for (const vid of vidy) {
      shag += 1;
      const nn: NastroykiRobokassy = { ...n, algoritm, chekVPodpisi: vid };
      const url = ssylkaOplaty(nn, { zakaz: OBRAZEC, nomer: nomer + shag, summaKop: 10000 });
      const o = await sprosit(url);
      if (!o.dostuchalis) {
        /* ДО РОБОКАССЫ НЕ ДОШЛИ — значит не измерено ничего.
           Молчащая сеть и непринятая подпись выглядят одинаково
           только в ленивой проверке; сказать здесь «подпись
           не принята» значило бы назвать не ту причину и отправить
           человека искать поломку в паролях. */
        console.log(`${algoritm.padEnd(10)} чек ${vid.padEnd(12)} → не достучались: ${o.kusok}`);
        console.log('');
        console.log('ПЛОХО: до Робокассы не дошли — проверять нечего.');
        console.log('  Это про сеть, а не про подпись. С сервера:');
        console.log('    curl -sS -o /dev/null -m 10 -w \'%{http_code}\\n\' https://auth.robokassa.ru/');
        return 1;
      }
      const proshla = podpisProshla(o);
      const vyvod = !proshla
        ? `подпись НЕ принята (${o.oshibka})`
        : o.rugaetsya
          ? `ПОДПИСЬ ПРИНЯТА, дальше ошибка ${o.oshibka ?? 'без номера'}`
          : 'ПОДПИСЬ ПРИНЯТА, страница оплаты открылась';
      console.log(`${algoritm.padEnd(10)} чек ${vid.padEnd(12)} → HTTP ${o.kod}, ${vyvod}`);

      if (o.rugaetsya && !o.oshibka) {
        /* СТРАНИЦА РУГАЕТСЯ, А НОМЕРА В НЕЙ НЕТ — это «не знаю»,
           а не «всё хорошо». Назвать такое успехом значило бы
           объявить оплату настроенной на любой ошибке, которую мы
           не научились читать; перебирать дальше — повторять тот же
           непрочитанный ответ. Печатаем, что увидели, и умолкаем. */
        console.log('');
        console.log('ПЛОХО: страница ругается, но номера в ней нет. Что она сказала:');
        console.log(`  ${o.kusok}`);
        return 1;
      }

      if (proshla && !horoshee) horoshee = { vid, algoritm, otvet: o, url };
      if (horoshee) break;
    }
    if (horoshee) break;
  }

  console.log('');
  if (!horoshee) {
    console.log('ПЛОХО: подпись не приняли ни на одном сочетании.');
    console.log('  Проверьте по порядку:');
    console.log('   • режим и пароли: в тестовом режиме нужны ТЕСТОВЫЕ пароли (иначе ошибка 29);');
    console.log('   • алгоритм подписи в кабинете Робокассы;');
    console.log('   • что идентификатор магазина написан ровно так, как в кабинете.');
    return 1;
  }

  const { vid, algoritm, otvet } = horoshee;
  if (vid !== n.chekVPodpisi || algoritm !== n.algoritm) {
    console.log('Подпись сходится, но НЕ на объявленных настройках. Поправьте окружение:');
    if (algoritm !== n.algoritm) console.log(`  NEIROLAVKA_ROBOKASSA_ALGORITM=${algoritm}`);
    if (vid !== n.chekVPodpisi) console.log(`  NEIROLAVKA_ROBOKASSA_CHEK_V_PODPISI=${vid}`);
    console.log('  …и перезапустите службу: systemctl restart neirolavka-bot');
  } else {
    console.log(`Подпись сходится на объявленных настройках (${algoritm}, чек ${vid}).`);
  }

  if (!otvet.rugaetsya) {
    console.log('Страница оплаты открылась — приём платежей настроен.');
    console.log(`  ${korotko(horoshee.url)}`);
    /* Печатаем, ЧТО на странице. Признак ошибки — слово в тексте,
       а слово можно и не узнать: пусть человек видит ответ сам,
       а не верит вердикту на слово. */
    console.log(`  страница говорит: ${otvet.kusok.slice(0, 160)}`);
    return vid === n.chekVPodpisi && algoritm === n.algoritm ? 0 : 1;
  }

  console.log('');
  console.log(`Дальше Робокасса ответила ошибкой ${otvet.oshibka}. Это уже НЕ про подпись:`);
  const tolkovanie = OSHIBKI[otvet.oshibka!];
  if (tolkovanie) {
    for (const s of tolkovanie.match(/.{1,72}(\s|$)/g) ?? [tolkovanie]) console.log(`  ${s.trim()}`);
  } else {
    console.log('  такого номера мы ещё не встречали. Что ответила страница:');
    console.log(`  ${otvet.kusok}`);
  }
  return 1;
}

glavnoe().then(
  (kod) => process.exit(kod),
  (e) => {
    console.log('ПЛОХО:', (e as Error).message);
    process.exit(1);
  },
);
