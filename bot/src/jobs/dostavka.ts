/**
 * Доходят ли до нас обновления вообще.
 *
 * Есть отказ, которого не видно ни в одном журнале бота: Telegram
 * не может достучаться до вебхука. Бот при этом жив, отвечает
 * на /health, ходит в Telegram сам — и не получает НИ ОДНОГО
 * обновления. Снаружи это выглядит как «бот не отвечает на кнопки»,
 * а внутри — как тишина: обработчики не запускались, писать в журнал
 * нечего.
 *
 * Так и случилось на боевом: `getWebhookInfo` показывал
 * `pending_update_count: 6` и `last_error_message: Connection timed
 * out`, потому что Telegram ходит к нам по IPv4, а входящий IPv4
 * на этом сервере закрыт так же, как исходящий.
 *
 * ВЕБХУК ПО IPv6 НЕВОЗМОЖЕН, и это не наша недоработка. В коде
 * Bot API (tdlib/telegram-bot-api, `WebhookActor::check_ip_address`)
 * стоит:
 *
 *     if (!addr.is_ipv4()) {
 *       return td::Status::Error("IPv6-only addresses are not allowed");
 *     }
 *
 * Проверка применяется и к адресу, полученному из DNS, и к тому, что
 * задан параметром `ip_address`; имя вебхука резолвится с явным
 * `prefer_ipv6 = false`. Исключение одно — свой сервер Bot API,
 * запущенный с `--local`, а официальный работает не в этом режиме.
 * То есть ни `ip_address` с IPv6, ни отдельное имя с одной лишь
 * AAAA-записью не помогут: во втором случае Telegram сам скажет
 * «IPv6-only addresses are not allowed».
 *
 * Раз входящий путь закрыт, а исходящий работает, обновления надо
 * ЗАБИРАТЬ. Этим и занят присмотр: пока бот на вебхуке, раз в две
 * минуты спрашивает у Telegram, доходит ли до нас доставка, и при
 * доказанном отказе переводит бота на опрос.
 */

import type { Lavka } from '../lavka.js';
import type { Sostoyanie } from '../server.js';
import { zhurnal } from '../lib/zhurnal.js';

export const SHAG_MS = 2 * 60_000;

/**
 * Первый круг — раньше остальных.
 *
 * Сразу после `setWebhook` Telegram отдаёт сведения без ошибки
 * доставки: новый вебхук, попыток ещё не было. Значит первый вывод
 * можно сделать, только когда Telegram успел попробовать — и ждать
 * ради этого полных двух минут незачем.
 */
export const PERVYY_SHAG_MS = 30_000;

/**
 * Насколько свежей должна быть ошибка доставки, чтобы считаться
 * действующей. Telegram повторяет доставку часто, поэтому ошибка
 * старше четверти часа — это память о прошлой аварии, а не поломка
 * сейчас: ровно то различение, что записано про `getWebhookInfo`
 * в CLAUDE.md.
 */
export const SVEZHEST_S = 15 * 60;

/** Что нам рассказал Telegram о своей доставке. */
export type Svedeniya = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  ip_address?: string;
};

export type Vyvod = { perehodit: boolean; pochemu: string };

/**
 * Решение по сведениям — отдельной чистой функцией, без сети.
 *
 * ДВА признака ОДНОВРЕМЕННО, и оба обязательны. Очередь без свежей
 * ошибки — это всплеск, который сейчас разгребается. Свежая ошибка
 * при пустой очереди — это уже пережитая заминка. Поломка — это
 * когда обновления ждут И доставка при этом падает.
 */
export function razobrat(s: Svedeniya, seychasSek: number, svezhestS = SVEZHEST_S): Vyvod {
  if (!s.url) return { perehodit: false, pochemu: 'вебхук не объявлен' };
  const zhdut = s.pending_update_count ?? 0;
  if (zhdut === 0) return { perehodit: false, pochemu: 'очередь пуста — доставка идёт' };
  const oshibkaSek = s.last_error_date ?? 0;
  const vozrast = seychasSek - oshibkaSek;
  if (!oshibkaSek || vozrast > svezhestS) {
    return { perehodit: false, pochemu: `ждут ${zhdut}, но свежей ошибки доставки нет` };
  }
  return {
    perehodit: true,
    pochemu:
      `ждут ${zhdut}, доставка падает ${Math.round(vozrast)} с назад: ` +
      `${s.last_error_message ?? 'причина не названа'}` +
      (s.ip_address ? ` (Telegram ходит на ${s.ip_address})` : ''),
  };
}

/**
 * Перейти на опрос.
 *
 * `bot.start` сам снимает вебхук — и снимает его БЕЗ
 * `drop_pending_updates`, поэтому всё, что успело накопиться,
 * приходит первым же ответом `getUpdates`. Терять чужие нажатия
 * при смене способа доставки нельзя: это оплаченные заказы.
 */
export async function pereytiNaOpros(l: Lavka, sostoyanie: Sostoyanie, pochemu: string): Promise<void> {
  if (sostoyanie.dostavka === 'opros') return;
  sostoyanie.dostavka = 'opros';
  sostoyanie.shag = 'на связи, обновления забираю опросом';
  zhurnal.vnimanie(`перехожу на опрос: ${pochemu}`);

  // Опрос запускается ссылкой, взятой ДО создания вебхук-обработчика:
  // grammY подменяет bot.start заглушкой-исключением, как только
  // вебхук собран. См. `zapomnitOpros` в lavka.ts.
  void l
    .nachatOpros({
      // Длина одного ожидания. ОБЯЗАНА быть заметно меньше предела
      // запроса к Telegram (PREDEL_ZAPROSA_S = 10 с), иначе наш же
      // клиент оборвёт длинный опрос на середине и превратит обычное
      // ожидание в поток сетевых ошибок.
      timeout: OZHIDANIE_OPROSA_S,
      allowed_updates: ['message', 'callback_query'],
      // Накопленное не выбрасываем: там заказы.
      drop_pending_updates: false,
      onStart: () => zhurnal.info('опрос пошёл: обновления забираю сам, вебхук снят'),
    })
    .catch((e) => {
      // Опрос — единственный способ получать обновления в этом режиме.
      // Если он умер, бот оглох, и притворяться живым нельзя.
      sostoyanie.gotov = false;
      sostoyanie.shag = 'опрос остановился';
      zhurnal.oshibka('опрос остановился, бот больше не получает обновлений:', e);
      // Выходим сами: systemd поднимет заново, и следующий подъём
      // снова начнётся с попытки вебхука — вдруг входящий путь ожил.
      setTimeout(() => process.exit(1), 1_000).unref();
    });
}

export const OZHIDANIE_OPROSA_S = 5;

/**
 * Присмотр. Работает, только пока бот на вебхуке: после перехода
 * на опрос смотреть не на что.
 */
export function zapustit(l: Lavka, sostoyanie: Sostoyanie): { ostanovit: () => void } {
  let chasy: NodeJS.Timeout | null = null;

  const krug = async (): Promise<void> => {
    if (sostoyanie.dostavka !== 'vebhuk') return;
    try {
      const v = (await l.bot.api.getWebhookInfo()) as Svedeniya;
      const vyvod = razobrat(v, Math.floor(Date.now() / 1000));
      if (vyvod.perehodit) {
        zhurnal.oshibka(`Telegram не доставляет обновления на вебхук: ${vyvod.pochemu}`);
        await pereytiNaOpros(l, sostoyanie, vyvod.pochemu);
      }
    } catch (e) {
      // Не спросили — не повод менять способ доставки: сеть моргает,
      // а решение о переходе принимается только по ответу Telegram.
      zhurnal.vnimanie('не удалось спросить Telegram о доставке:', e);
    }
  };

  const vzvesti = (cherez: number) => {
    chasy = setTimeout(() => {
      void krug().finally(() => vzvesti(SHAG_MS));
    }, cherez);
    // Таймер не держит процесс живым сам по себе.
    chasy.unref();
  };

  vzvesti(PERVYY_SHAG_MS);
  return {
    ostanovit() {
      if (chasy) clearTimeout(chasy);
      chasy = null;
    },
  };
}
