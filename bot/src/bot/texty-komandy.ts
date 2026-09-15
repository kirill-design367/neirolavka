/**
 * Тексты СЛУЖЕБНОЙ части бота — по-английски.
 *
 * Владелец в сентябре 2026 развёл два языка: покупатель читает
 * по-русски (`lib/texty.ts`), команда — по-английски. Это не перевод
 * интерфейса «на всякий случай», а разделение аудиторий: помощник,
 * которому поручены логин и пароль, работает по-английски, и половина
 * его экрана не должна быть на языке, которого он не читает.
 *
 * ЧТО СЮДА НЕ ВХОДИТ, и это правило, а не недосмотр:
 *
 *   • ТЕКСТЫ ПОКУПАТЕЛЯ. Они остались в `lib/texty.ts` и остались
 *     русскими — там слова владельца, поставленные дословно.
 *   • ЗАПИСИ В ИСТОРИИ ЗАКАЗА (`zakazy.sobytie`). Это ЗАПИСЬ о том,
 *     что произошло, сделанная в момент события, а не строка
 *     на экране: она лежит в базе у всех прежних заказов, и перевод
 *     означал бы две истории на одном заказе. То же правило уже
 *     записано про историю событий в панели.
 *   • ЖУРНАЛ СЕРВЕРА. Он не бот, его читают через `journalctl`,
 *     и он русский целиком — включая модули, которых этот заход
 *     не касается. Половина журнала на другом языке хуже, чем весь
 *     журнал на одном.
 *
 * Перечисления — статус, причина отмены — берутся из СЛОВАРЯ ПАНЕЛИ
 * (`admin/yazyk.ts`), а не пишутся здесь заново. Владелец смотрит
 * на один и тот же заказ в боте и в панели; два английских написания
 * одного статуса читались бы как два разных состояния.
 */

import { SLOVAR, prichinaSlovami, statusSlovami } from '../admin/yazyk.js';
import type { PochemuNeUbrali } from '../db/komanda.js';
import type { PrichinaOtmeny, VidAkkaunta, Zakaz } from '../db/zakazy.js';
import { rubli } from '../lib/katalog.js';
import {
  chasSlovami,
  dataPoAngliyski,
  mnozhestvennoe,
  momentPoAngliyski,
  skolkoOsalosPoAngliyski,
} from '../lib/vremya.js';

/** Английская половина словаря панели. Одно написание на бот и панель. */
const S = SLOVAR.en;

export const NET_PRAV = 'This section is for the owner only.';

/** Цена для служебного экрана. Ноль — это «цена не объявлена», а не «даром». */
export function cena(kop: number): string {
  return kop > 0 ? rubli(kop) : 'price to be set';
}

export function vidAkkaunta(v: VidAkkaunta): string {
  switch (v) {
    case 'novy':
      return 'new account';
    case 'svoy':
      return 'own account';
    case 'ne_vybran':
      return 'not chosen yet';
  }
}

export const status = (s: Zakaz['status']): string => statusSlovami(s, S);
export const prichina = (p: PrichinaOtmeny): string => prichinaSlovami(p, S);

// ── карточка заказа и уведомления ───────────────────────────────────

export const ZAKAZ = (id: number) => `Order #${id}`;
export const POKUPATEL = 'Customer';
export const AKKAUNT = 'Account';
export const OFORMLEN = 'Placed';
export const OBESHCHANO = 'Promised by';
export const VZYAL = 'Taken by';
export const DOSTUP_DO = 'Access until';
export const OPLACHENO = 'Paid';
export const S_BALANSA = 'from balance';
export const KOD_ZAPROSHEN = 'Code requested';
export const ZHDEM_OTVETA = 'waiting for the answer';
export const KOD_POLUCHEN = 'Code received';
export const PISMO_OTPRAVLENO = 'Password reset email sent';
export const PRICHINA_OTMENY = 'Cancellation reason';
export const AKKAUNT_ZAPISAN = 'Customer account details are saved';
export const DOSTUP_ZAPISAN = 'Access is saved';
export const NE_DOSHLO_KOMANDE = '⚠ the team was not notified — the order was found in the queue';

export const NOVY_ZAKAZ_OPLACHEN = 'New paid order.';
export const NOVY_ZAKAZ = 'New order. Payment is handled outside the bot for now.';

/** Момент и дата — в поясе лавки, английским написанием. */
export const moment = (kogda: string | Date, poyas: string): string =>
  momentPoAngliyski(kogda instanceof Date ? kogda : new Date(kogda), poyas);
export const data = (kogda: string | Date, poyas: string): string =>
  dataPoAngliyski(kogda instanceof Date ? kogda : new Date(kogda), poyas);
export const ostalos = skolkoOsalosPoAngliyski;

// ── служебный экран ──────────────────────────────────────────────────

export const SLUZHEBNOE_VLADELEC = 'Shop desk. You are the owner.';
export const SLUZHEBNOE_POMOSHNIK = 'Shop desk. You are an assistant.';
export const V_OCHEREDI = (n: number) => `In the delivery queue: ${n}`;
export const NA_VAS = (n: number, zhdutKod: number) =>
  `On you: ${n}${zhdutKod ? `, waiting for a code: ${zhdutKod}` : ''}`;
export const ZHDUT_OPLATY = (n: number) => `Awaiting payment: ${n}`;

export const OCHERED_EST = (n: number) => `Delivery queue: ${n}. Oldest on top.`;
export const OCHERED_PUSTA = 'The queue is empty: everything is delivered.';
export const MOI_EST = (n: number) => `${n} on you. Open any of them — they run independently.`;
export const MOI_PUSTO = 'Nothing on you right now. Take an order from the queue.';
export const NEOPL_EST = (n: number) =>
  `Awaiting payment: ${n}. While payment is handled outside the bot, mark it by hand.`;
export const NEOPL_PUSTO = 'No unpaid orders.';

export const NET_ZAKAZA = 'No such order.';
export const NET_ZAKAZA_KRATKO = 'No such order';

// ── движение заказа: ответы на нажатия ───────────────────────────────

export const OTMETIL_OPLATU = 'Marked as paid';
export const UZHE_NE_ZHDET_OPLATY = 'The order is no longer awaiting payment';
export const VZYALI = 'Taken into work';
export const UZHE_VZYAT = 'The order is already taken or delivered';
export const VERNUL_V_OCHERED = 'Returned to the queue';
export const SNACHALA_PISMO = 'Send the password reset email and mark it first';
export const UZHE_ZAKRYT = 'The order is already closed';
export const OTMENIL_DENGI = 'Cancelled, money is on the balance';
export const OTMENIL = 'Cancelled';
export const POCHEMU_OTMENYAEM = 'Why are we cancelling?';
export const NET_TAKOY_PRICHINY = 'No such reason';

// ── код двухфакторной аутентификации ─────────────────────────────────

export const KOD_NE_NUZHEN = 'This order is on a new account — no code needed';
export const ZAKAZ_NE_ZABRAN = 'The buyer has not claimed this order yet — there is nobody to ask';
export const UZHE_VVODIT_KOD = (id: number) => `The customer is already entering a code for order #${id}`;
export const KOD_SEYCHAS_NELZYA = 'A code cannot be requested right now';
export const SPROSILI_KOD = 'Asked the customer';
export const KOD_NE_DOSHEL = 'Not delivered to the customer';
export const KODA_NET = 'No code for this order';
export const KOD_PO_ZAKAZU = (id: number, kod: string) => `Code for order #${id}: ${kod}`;

/**
 * Запрос кода — шаг НЕОБЯЗАТЕЛЬНЫЙ, и это сказано словами.
 *
 * Не все нейросети спрашивают код при входе. Кнопка осталась там же,
 * но помощник должен видеть, что через неё идти не обязан, — иначе
 * он будет ждать кода, которого никто не пришлёт.
 */
export const KOD_NEOBYAZATELEN =
  'Only if the service asks for a code at sign-in. You can enter the access straight away.';

// ── свой аккаунт покупателя ──────────────────────────────────────────

export const NE_CHITAETSYA_AKKAUNT = 'The saved account record cannot be read';
export const NET_AKKAUNTA = 'The customer did not hand over their own account';
export const AKKAUNT_PLASHKA = (id: number) => `Order #${id}. Customer account.`;
export const LOGIN = 'Login';
export const POCHTA = 'Email';
export const PAROL = 'Password';
export const OTMETIL_PISMO = 'Marked. The order can be cancelled now';
export const PISMO_SEYCHAS_NELZYA = 'This cannot be marked right now';

// ── ввод доступа и выдача ────────────────────────────────────────────

export const PROSIM_LOGIN = (id: number) =>
  [
    `Order #${id}. Send the login in one message.`,
    '',
    'The password goes in the next message. If the access needs a note for the customer, ' +
      'add it from the second line of that same message.',
  ].join('\n');
export const LOGIN_ZAPISAN = 'Login saved. Now the password — and a note from the second line, if needed.';
export const VVOD_OTMENEN_KRATKO = 'Input cancelled';
export const VVOD_OTMENEN = 'Input cancelled. The order is left as it was.';
export const VVOD_POTERYALSYA = 'Something was lost while typing. Start again from the order card.';
export const PROVERKA_DOSTUPA = (id: number) => `Order #${id}. Check what I will send to the customer.`;

export const DOSTUP_NE_ZAPISAN = 'No access saved yet';
export const NE_CHITAETSYA_DOSTUP = 'The saved access cannot be read';
export const NE_DOSTAVLENO = 'The message was not delivered to the customer';
export const OTPRAVIL = 'Sent to the customer';
export const NE_DOSTAVLEN_DOSTUP = (id: number, pochemu: string) =>
  [
    `Access for order #${id} was not delivered to the customer:`,
    `${pochemu}.`,
    '',
    'I left the order UNDELIVERED — otherwise it would count as closed while the person ' +
      'has no access.',
  ].join('\n');

// ── люди и баланс ────────────────────────────────────────────────────

export const LYUDI_SHAPKA = (vsego: number) => `People in total: ${vsego}. The last twenty:`;
export const LYUDI_STROKA = (podpis: string, zakazov: number, vydano: number, balansKop: number) =>
  `${podpis} · orders ${zakazov}, delivered ${vydano}${balansKop > 0 ? `, balance ${rubli(balansKop)}` : ''}`;

export const PROSIM_POPOLNENIE = [
  'Send one line: the person identifier and the amount in roubles.',
  '',
  'For example: 42 1500',
  '',
  'Positive amounts only: money cannot be taken off somebody else’s balance by hand.',
].join('\n');
export const POPOLNENIE_NE_RAZOBRALI =
  'Two numbers are needed: an identifier and an amount in roubles above zero. For example: 42 1500';
export const NET_TAKOGO_CHELOVEKA = 'No such person in the database. They must write to the bot at least once.';
export const POPOLNIL = (komu: number, kop: number, stalo: number) =>
  `Topped up ${komu} by ${rubli(kop)}. Balance is now ${rubli(stalo)}.`;

// ── статистика ───────────────────────────────────────────────────────

export const STATISTIKA = 'Statistics.';
export const VYDACH_NE_BYLO = 'nothing delivered yet';
export const CENA_NE_OBYAVLENA = 'price not set';
export const CHASTICHNO_BEZ_CENY = (summa: string, bezCeny: number, vsego: number) =>
  `${summa} (price not set on ${bezCeny} of ${vsego})`;
export const STAT_VSEGO = (vsego: number, zaSutki: number) =>
  `Orders in total: ${vsego}, in the last 24 hours: ${zaSutki}`;
export const STAT_ZHDUT_OPLATY = (n: number) => `Awaiting payment: ${n}`;
export const STAT_OPLACHENY = (n: number) => `Paid: ${n}`;
export const STAT_V_RABOTE = (n: number) => `In progress: ${n}`;
export const STAT_VYDANY = (n: number) => `Delivered: ${n}`;
export const STAT_OTMENENY = (n: number) => `Cancelled: ${n}`;
export const STAT_VYRUCHKA = (dengi: string) => `Revenue on delivered: ${dengi}`;
export const STAT_NET_SREDNEGO = 'No average delivery time yet: no order has gone the whole way.';
export const STAT_SREDNEE = (minut: number) =>
  `Average delivery time: ${mnozhestvennoe(minut, 'minute', 'minutes')}`;
export const STAT_PO_TOVARAM = 'By product:';

// ── настройки и команда ──────────────────────────────────────────────

export const NASTROYKI = 'Settings.';
export const CHASY_RABOTY = (s: number, po: number, poyas: string) =>
  `Working hours: ${chasSlovami(s)} to ${chasSlovami(po)} (${poyas})`;
export const OBESHCHANIE = (minut: number) =>
  `Delivery promise: ${mnozhestvennoe(minut, 'minute', 'minutes')}`;
export const OPLATA_STROKA = (imya: string | null) => `Payment: ${imya ?? 'not connected'}`;
export const CHASY_SAMI = 'Working hours are substituted into the texts automatically: changing them here is enough.';

export const PROSIM_CHASY = (s: number, po: number) =>
  ['Send two numbers separated by a space: the opening hour and the closing hour.', '', `Now: ${s} ${po}`].join('\n');
export const CHASY_NE_RAZOBRALI = 'Two whole hours are needed, the start below the end. For example: 8 23';
export const CHASY_POSTAVLENY = (s: number, po: number) =>
  `Working hours are now ${chasSlovami(s)} to ${chasSlovami(po)}. The texts pick them up themselves — nothing to edit.`;

export const KOMANDA = 'Team.';
export const ROL_VLADELEC = 'owner';
export const ROL_POMOSHNIK = 'assistant';
export const KOMANDA_POYASNENIE =
  'An assistant sees the queue and delivers access. People, statistics and settings are not shown to them.';
export const KOMANDA_UBRAT = 'Remove an assistant: /ubrat_pomoshnika ‹id›';

export const PROSIM_POMOSHNIKA = [
  'Send the Telegram identifier of the assistant — a number.',
  '',
  'To find it out: let the person write any message to the bot, then look at the people list ' +
    'in the shop desk.',
].join('\n');
export const NE_POHOZHE_NA_ID = 'That does not look like an identifier. A number is needed.';
export const NUZHEN_ID = 'A numeric identifier is needed.';
export const UBRAL_IZ_KOMANDY = (id: number) => `Removed ${id} from the team.`;
/**
 * Почему помощника не убрали.
 *
 * `komanda.ubrat` отдаёт КОД, а не фразу, и фраза живёт здесь. Пока
 * она лежала в базе, служебный ответ был русским в английском экране,
 * и вылечить это правкой одного модуля было нельзя — тот же довод,
 * по которому причина отмены заказа хранится кодом.
 */
export function neUbrali(p: PochemuNeUbrali): string {
  switch (p) {
    case 'net_v_komande':
      return 'they are not on the team';
    case 'posledniy_vladelec':
      return 'this is the only owner';
  }
}
export const NE_UBRAL = (p: PochemuNeUbrali) => `Not removed: ${neUbrali(p)}.`;

/** Первое, что видит новый помощник. Он уже команда — значит по-английски. */
export const DOBAVLEN_POMOSHNIKOM =
  'You have been added as an assistant at Neirolavka. A “Shop orders” section has appeared ' +
  'in the bottom menu: the delivery queue lives there. Press /start so the menu refreshes.';
export const DOBAVIL_DOSHLO = (id: number) =>
  `Added ${id} as an assistant, the message reached them. Orders now go to them too.`;
export const DOBAVIL_NE_DOSHLO = (id: number, pochemu: string, neZapuskal: boolean) =>
  [
    `Added ${id} as an assistant, but I cannot write to them:`,
    `${pochemu}.`,
    '',
    neZapuskal
      ? 'Let them open the bot and press “Start” — after that orders will start reaching them. ' +
        'Until then they are on the team but get no notifications.'
      : 'While this is so, orders will not reach them.',
  ].join('\n');

// ── уведомления команде из фоновых работ и оплаты ────────────────────

export const ZAKAZ_PROSROCHEN = (o: {
  id: number;
  nazvanie: string;
  pokupatel: string;
  srok: string;
  ostalos: string;
}) =>
  [
    'Order overdue.',
    '',
    `#${o.id} · ${o.nazvanie}`,
    `Customer: ${o.pokupatel}`,
    `Promised by ${o.srok} — ${o.ostalos}`,
  ].join('\n');

export const OTMENEN_BEZ_KODA = (o: {
  id: number;
  nazvanie: string;
  pokupatel: string;
  minut: number;
  vernuli: number;
}) =>
  [
    `Order #${o.id} cancelled: the code did not arrive within ${mnozhestvennoe(o.minut, 'minute', 'minutes')}.`,
    '',
    o.nazvanie,
    `Customer: ${o.pokupatel}`,
    o.vernuli > 0 ? `Money returned to their balance: ${rubli(o.vernuli)}` : 'There was no money on the order',
  ].join('\n');

export const NE_CHITAETSYA_DOSTUP_KOMANDE = (id: number) =>
  `Access for order #${id} cannot be read. Check the encryption key.`;
export const ZAKAZ_ZABRAN = (id: number, kto: string) => `Order #${id} claimed by the buyer: ${kto}.`;
export const KOD_KOMANDE = (o: { id: number; nazvanie: string; pokupatel: string; kod: string }) =>
  [`Code for order #${o.id} · ${o.nazvanie}`, `Customer: ${o.pokupatel}`, '', `Code: ${o.kod}`].join('\n');
export const VOPROS_KOMANDE = (o: { ot: string; tgId: number; text: string }) =>
  ['Question from a customer.', '', `From: ${o.ot}`, `id: ${o.tgId}`, '', o.text].join('\n');

export const ZAKAZ_OPLACHEN = (id: number, nazvanie: string) =>
  `Order #${id} is paid: ${nazvanie}. Ready to be taken into work.`;
export const ZAKAZ_S_SAYTA = (id: number, nazvanie: string, kOplate: number) =>
  `Order #${id} placed ON THE WEBSITE: ${nazvanie}.\n` +
  `${rubli(kOplate)} to pay. There is no buyer yet — they appear when they open the bot link.`;
export const SUMMA_NE_TA = (o: {
  nomer: number;
  zakazId: number;
  zhdali: number;
  prishlo: number;
}) =>
  `Payment amount does not match.\nInvoice #${o.nomer}, order #${o.zakazId}.\n` +
  `Expected ${rubli(o.zhdali)}, received ${rubli(o.prishlo)}.\n` +
  'The order is NOT marked as paid — sort it out by hand.';
export const DENGI_BEZ_HOZYAINA = (o: {
  summaKop: number;
  zakazId: number;
  status: string;
  nomer: number;
}) =>
  `MONEY WITH NO OWNER. A payment of ${rubli(o.summaKop)} arrived for order #${o.zakazId} ` +
  `(${o.status}), which was placed on the website and never claimed in the bot.\n` +
  'There is nothing to credit it to — the order has no buyer. Sort it out by hand: ' +
  `invoice #${o.nomer} in Robokassa.`;
export const OPLATA_PO_ZAKRYTOMU = (o: { zakazId: number; status: string; summaKop: number }) =>
  `A payment arrived for order #${o.zakazId}, which is already closed (${o.status}).\n` +
  `${rubli(o.summaKop)} credited to the buyer balance.`;
