/**
 * Метка рекламного канала: откуда человек пришёл.
 *
 * ОДИН ФАЙЛ НА САЙТ И НА БОТА, и это то же решение, что с каталогом.
 * Метку собирает сайт, разбирает бот, а между ними стоит Telegram
 * со своими ограничениями на параметр `start`. Две копии правил
 * разъехались бы на первой же правке: сайт начал бы слать то, чего
 * бот не понимает, и метка молча терялась бы — а заметить это можно
 * было бы только по пустой колонке в статистике через месяц.
 *
 * Telegram пропускает в `start` ТОЛЬКО `A-Za-z0-9_-` и не длиннее
 * 64 знаков. Отсюда всё остальное:
 *   • код метки чистится до `[a-z0-9-]`, потому что `_` занят
 *     под разделитель пар;
 *   • payload — это пары `ключ_значение`, склеенные `_`:
 *     `metka_vk-post-1`, а вместе с заказом
 *     `tovar_kling-pro_oplata_sbp_metka_vk-post-1`;
 *   • разбор берёт пары, которые понимает, и молча пропускает
 *     остальные — так новая пара не ломает старого бота.
 */

/** Сколько знаков кода метки помещается, не съедая весь payload. */
export const PREDEL_KODA = 24;

/** Ключ пары, под которым метка едет в Telegram. */
export const KLYUCH_METKI = 'metka';

/**
 * Ключ пары, под которым едет СЕКРЕТ ЗАКАЗА, оплаченного на сайте.
 *
 * Живёт здесь, рядом с остальными ключами payload, а не в боте:
 * ключи — это уговор о формате, и держать их в одном месте дешевле,
 * чем искать по двум. Ссылку с этой парой собирает бот (на странице
 * возврата из Робокассы) и он же её разбирает; сайт её только
 * показывает такой, какой получил.
 */
export const KLYUCH_ZAKAZA = 'zakaz';

/**
 * Привести к коду метки.
 *
 * Кириллица, пробелы и знаки препинания превращаются в дефис —
 * `utm_source` пишет человек, и «ВК посты» встречается чаще, чем
 * `vk-posts`. Пустой итог значит «метки нет»: пустая строка в базе
 * и «метка есть, но никакая» — разные вещи, и путать их нельзя.
 */
export function kodMetki(syroe: string | null | undefined): string {
  return (syroe ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, PREDEL_KODA)
    .replace(/-$/, '');
}

/**
 * Метка из адреса страницы.
 *
 * Своё короткое `?m=` предпочитается общепринятому `?utm_source=`:
 * ссылки, сделанные в панели, короче и не путаются со счётчиками.
 * Но чужая ссылка с `utm_source` тоже считается — иначе трафик,
 * размеченный не нами, выглядел бы как «без метки».
 */
export function metkaIzAdresa(poisk: string): string {
  const p = new URLSearchParams(poisk);
  return kodMetki(p.get('m')) || kodMetki(p.get('utm_source'));
}

/** Собрать payload из пар. Пустые значения не едут. */
export function sobratPayload(pary: Record<string, string>): string {
  const kuski: string[] = [];
  for (const [k, v] of Object.entries(pary)) {
    if (!v) continue;
    kuski.push(k, v);
  }
  return kuski.join('_').slice(0, 64);
}

/**
 * Разобрать payload обратно в пары.
 *
 * Нечётный хвост отбрасывается: обрезка до 64 знаков могла отрезать
 * значение последней пары, и полупара — это не значение, а мусор.
 */
export function razobratPayload(start: string | null | undefined): Record<string, string> {
  const kuski = (start ?? '').split('_').filter((x) => x.length > 0);
  const itog: Record<string, string> = {};
  for (let i = 0; i + 1 < kuski.length; i += 2) itog[kuski[i] as string] = kuski[i + 1] as string;
  return itog;
}

/** Метка из payload — уже почищенная, потому что прийти могло что угодно. */
export function metkaIzPayload(start: string | null | undefined): string {
  return kodMetki(razobratPayload(start)[KLYUCH_METKI]);
}
