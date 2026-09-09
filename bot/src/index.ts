/**
 * Точка входа.
 *
 * Бот работает вебхуком, а не опросом: Telegram сам стучится на 443,
 * nginx проксирует на петлю. Опрос держал бы постоянное исходящее
 * соединение и просыпался бы вхолостую круглые сутки ради десятка
 * заказов.
 *
 * Порядок подъёма выбран так, чтобы поломка обнаруживалась ДО того,
 * как её увидит покупатель:
 *
 *   1. настройки — нет токена или ключа, дальше идти незачем;
 *   2. ключ шифрования проверяется туда-обратно;
 *   3. база открывается и мигрируется;
 *   4. команда засевается из окружения;
 *   5. и только потом бот объявляет Telegram свой адрес.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot, webhookCallback } from 'grammy';
import { prochitat, adresVebhuka, putVebhuka } from './config.js';
import { otkrytBazu } from './db/index.js';
import { zaseyat } from './db/komanda.js';
import { proveritKlyuch } from './lib/shifr.js';
import { zhurnal, skryt } from './lib/zhurnal.js';
import { sobrat } from './bot/index.js';
import { proveritKomandu } from './bot/uvedomleniya.js';
import { vybratPut, rasskazat, nastroitSokety } from './lib/svyaz.js';
import type { Semeystvo } from './lib/svyaz.js';
import { zapustit as zapustitPrismotr } from './jobs/svyaz.js';
import { sozdatServer } from './server.js';
import type { Sostoyanie } from './server.js';
import { zapustit as zapustitNapominaniya } from './jobs/napominaniya.js';
import { zapustit as zapustitOzhidanieKodov } from './jobs/kody.js';
import { zapustit as zapustitPrismotrVykladki } from './jobs/vykladka.js';
import {
  zapustit as zapustitPrismotrDostavki,
  pereytiNaOpros,
  razobrat as razobratDostavku,
} from './jobs/dostavka.js';
import { zaglushka } from './oplata/zaglushka.js';
import type { Lavka } from './lavka.js';
import { sozdatBota, zapomnitOpros } from './lavka.js';

/**
 * Дождаться, пока Telegram станет доступен, — вслух.
 *
 * grammY внутри init() повторяет getMe бесконечно и МОЛЧА. Молчание
 * здесь недопустимо: невозможность достучаться до api.telegram.org
 * с этого сервера — состояние, которое надо видеть в журнале
 * с первой минуты, а не вычислять по косвенным признакам.
 *
 * Сдаваться при этом нельзя: связь возвращается, и бот обязан
 * подняться сам, без человека.
 */
const UZEL_TELEGRAM = 'api.telegram.org';

async function dozhdatsyaTelegram(l: Lavka): Promise<Semeystvo | null> {
  const nachalo = Date.now();
  for (let popytka = 1; ; popytka += 1) {
    // Путь выбирается ЗАНОВО на каждой попытке, а не один раз при
    // старте. Так работает обещание «предпочитаем IPv6, но не
    // прибиваем»: если он отвалится, а IPv4 к тому времени
    // разблокируют, следующая же попытка это увидит и переключится.
    const vybor = await vybratPut(UZEL_TELEGRAM);
    rasskazat(UZEL_TELEGRAM, vybor);
    try {
      await l.bot.api.getMe();
      if (popytka > 1) {
        zhurnal.info(`Telegram ответил с ${popytka}-й попытки, ждали ${Math.round((Date.now() - nachalo) / 1000)} с`);
      }
      // ВОЗВРАЩАЕМ РОВНО ТО, ЧТО ПОДТВЕРДИЛОСЬ, включая «ничего».
      //
      // Здесь стояло `vybor.vybrano ?? 4`, и это стоило двадцати минут
      // молчания на боевом: обе пробы не ответили, getMe при этом
      // прошёл (счастливые глазки нашли живой адрес сами) — и бот
      // объявлял себя работающим по IPv4, который на этом сервере
      // заблокирован постоянно. Присмотр верил числу и проверял
      // именно четвёрку — раз в десять минут.
      return vybor.vybrano;
    } catch (e) {
      zhurnal.vnimanie(
        `Telegram недоступен с этого сервера (попытка ${popytka}, ` +
          `прошло ${Math.round((Date.now() - nachalo) / 1000)} с). ` +
          'Бот жив и ждёт связи; заказы пока не доходят.',
        e,
      );
      const pauza = Math.min(30_000, 2_000 * popytka);
      await new Promise((gotovo) => setTimeout(gotovo, pauza));
    }
  }
}

async function glavnaya(): Promise<void> {
  // Счастливые глазки — до первого исходящего запроса: соединение
  // должно уметь уйти на живой путь само, даже если наш выбор ошибся.
  nastroitSokety();

  const n = prochitat(process.env);
  // Регистрируем секреты до первой строки журнала: дальше они
  // не смогут просочиться даже через чужую трассировку.
  skryt(n.token, n.sekretVebhuka, n.klyuchDostupov.toString('base64'), n.klyuchDostupov.toString('hex'));
  // Ключ хранилища вырезается из журнала на тех же правах, что токен
  // бота: попав в трассировку, он даёт запись в репозиторий.
  skryt(n.klyuchHranilishcha);

  proveritKlyuch(n.klyuchDostupov);
  zhurnal.info('ключ доступов проходит проверку');

  const db = otkrytBazu(n.baza);
  zaseyat(db, n.vladelcy, n.pomoshniki);
  zhurnal.info(`база открыта: ${n.baza}`);

  const bot = sozdatBota(n);
  // Ссылку на опрос берём ЗДЕСЬ, до создания вебхук-сервера:
  // после него grammY подменяет bot.start исключением.
  const l: Lavka = { db, n, bot, oplata: zaglushka, nachatOpros: zapomnitOpros(bot) };
  sobrat(l);

  // Отметка выпуска. Кладётся выкладкой рядом с кодом; выкладка потом
  // спрашивает её у живого бота и так убеждается, что перезапустился
  // именно новый выпуск, а не остался работать прежний.
  let vypusk = 'неизвестен';
  try {
    vypusk = readFileSync(new URL('../../../vypusk', import.meta.url), 'utf8').trim() || 'неизвестен';
  } catch {
    // Запуск из исходников без выкладки — это нормально.
  }

  // Сервер поднимается ПЕРВЫМ, до любого обращения к Telegram.
  //
  // Прежде порядок был обратный: сначала bot.init(), потом listen.
  // Выглядит логично — бот должен знать своё имя, — но у grammY init
  // повторяет getMe БЕСКОНЕЧНО при сетевой ошибке. Стоило серверу
  // не достучаться до api.telegram.org, и процесс жил, молчал
  // и не отвечал ни на /health, ни на /vypusk. Снаружи это
  // неотличимо от мёртвого бота, и выкладка честно откатилась,
  // хотя код был исправен.
  //
  // Имя бота для разбора команд вида /start@imya грамматический слой
  // получит сам: webhookCallback вызывает init перед первым
  // обновлением, если её ещё не было.
  const sostoyanie: Sostoyanie = { gotov: false, shag: 'поднимаюсь', dostavka: 'vebhuk' };
  const { server, put } = sozdatServer(l, vypusk, sostoyanie);

  server.listen(n.port, '127.0.0.1', () => {
    zhurnal.info(`слушаю 127.0.0.1:${n.port}${put.replace(/\/[^/]+$/, '/‹секрет›')}, выпуск ${vypusk}`);
  });

  sostoyanie.shag = 'жду ответа Telegram';
  const putDoTelegram = await dozhdatsyaTelegram(l);
  await bot.init();
  zhurnal.info(`бот: @${bot.botInfo.username}`);

  if (n.rezhim === 'opros') {
    // Владелец сказал прямо: обновления забираем сами. Вебхук снимет
    // сам `bot.start`, и снимет без потери накопленного.
    sostoyanie.shag = 'начинаю опрос';
    await pereytiNaOpros(l, sostoyanie, 'режим задан настройкой NEIROLAVKA_REZHIM=opros');
  } else {
    sostoyanie.shag = 'объявляю вебхук';
    await bot.api.setWebhook(adresVebhuka(n), {
      secret_token: n.sekretVebhuka,
      // Telegram сам разрешает наше имя и решает, по какому адресу идти.
      // Задать адрес явно можно — но ТОЛЬКО IPv4: Bot API отвергает
      // любой другой словами «IPv6-only addresses are not allowed».
      ...(n.adresVebhukaDlyaTelegram ? { ip_address: n.adresVebhukaDlyaTelegram } : {}),
      // Пропущенные за время простоя обновления НЕ выбрасываем: там
      // могут быть заказы.
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query'],
    });
    // Что Telegram думает о нашем вебхуке — в журнал сразу после
    // объявления. Поле ip_address показывает, по какому адресу он к нам
    // ходит: без этой строки «почему не доходят обновления» выясняется
    // отдельным походом на сервер.
    try {
      const v = await bot.api.getWebhookInfo();
      zhurnal.info(
        `вебхук объявлен; Telegram ходит к нам на ${v.ip_address ?? '?'}, ` +
          `ожидают доставки ${v.pending_update_count ?? 0}` +
          (v.last_error_message ? `, последняя ошибка: ${v.last_error_message}` : ''),
      );
      // Решение о переходе принимается ПРЯМО ЗДЕСЬ, а не через две
      // минуты: сведения о неудачной доставке Telegram отдаёт сразу,
      // и если они говорят «не дохожу», ждать нечего.
      if (n.rezhim === 'sam') {
        const vyvod = razobratDostavku(v, Math.floor(Date.now() / 1000));
        if (vyvod.perehodit) {
          zhurnal.oshibka(`Telegram не доставляет обновления на вебхук: ${vyvod.pochemu}`);
          await pereytiNaOpros(l, sostoyanie, vyvod.pochemu);
        }
      }
    } catch (e) {
      zhurnal.vnimanie('вебхук объявлен, но состояние спросить не вышло:', e);
    }
  }

  // Кому мы вообще можем писать. Проверяется СРАЗУ, а не в момент
  // первого заказа: «chat not found» означает, что человек ни разу
  // не открывал бота, и узнать об этом надо до того, как в пустоту
  // уйдёт чей-то оплаченный заказ.
  await proveritKomandu(l).catch((e) => zhurnal.oshibka('проверка команды не прошла:', e));

  sostoyanie.gotov = true;
  const kak = sostoyanie.dostavka === 'opros' ? 'обновления забираю опросом' : 'обновления приходят вебхуком';
  sostoyanie.shag =
    putDoTelegram === null ? `на связи, путь не подтверждён — ищу; ${kak}` : `на связи по IPv${putDoTelegram}, ${kak}`;

  zapustitNapominaniya(l);
  zapustitOzhidanieKodov(l);
  // Выкладка цен на сайт: страницу могут закрыть, а состояние
  // должно дойти до конца само.
  zapustitPrismotrVykladki(l);
  // Присмотр держит состояние пути и правит строку /health на ходу:
  // «жив» без указания пути ничего не говорит, когда путь потерян.
  const prismotr = zapustitPrismotr(l, putDoTelegram);
  // Присмотр за ДОСТАВКОЙ — отдельный от присмотра за путём. Первый
  // спрашивает «доходит ли до нас», второй — «доходим ли мы».
  zapustitPrismotrDostavki(l, sostoyanie);
  setInterval(() => {
    const p = prismotr.put();
    const put = p === null ? 'путь не подтверждён — ищу' : `по IPv${p}`;
    const kakSeychas =
      sostoyanie.dostavka === 'opros' ? 'обновления забираю опросом' : 'обновления приходят вебхуком';
    sostoyanie.shag = `на связи ${put}, ${kakSeychas}`;
  }, 5_000).unref();

  const ostanovka = (signal: string) => {
    zhurnal.info(`${signal}: останавливаюсь`);
    // Опрос держит открытый запрос к Telegram: не прервав его,
    // процесс уходил бы в остановку до конца ожидания.
    if (sostoyanie.dostavka === 'opros') void bot.stop();
    server.close(() => {
      try {
        db.close();
      } catch (e) {
        zhurnal.oshibka('база не закрылась:', e);
      }
      process.exit(0);
    });
    // Если соединения не отпускают, ждём недолго и выходим сами:
    // systemd всё равно прибьёт по таймауту, но выйти самому чище.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => ostanovka('SIGTERM'));
  process.on('SIGINT', () => ostanovka('SIGINT'));
}

glavnaya().catch((e) => {
  zhurnal.oshibka('бот не поднялся:', e);
  process.exit(1);
});
