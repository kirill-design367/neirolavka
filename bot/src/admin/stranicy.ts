/**
 * Страницы панели.
 *
 * Всё, что здесь есть, отвечает на один вопрос: что сделать сейчас.
 * Поэтому в очереди отдельной колонкой стоит СЛЕДУЮЩИЙ ШАГ, а в
 * карточке заказа кнопка текущего шага вынесена наверх и отделена
 * от остальных — помощник ведёт несколько заказов разом, и выбирать
 * из десятка одинаковых кнопок ему некогда.
 */

import type { Baza } from '../db/index.js';
import * as zakazy from '../db/zakazy.js';
import * as lyudi from '../db/lyudi.js';
import * as komanda from '../db/komanda.js';
import * as koshelek from '../db/koshelek.js';
import * as dostupy from '../db/dostupy.js';
import * as svoi from '../db/svoi.js';
import * as kody from '../db/kody.js';
import * as bdKatalog from '../db/katalog.js';
import * as bdVykladki from '../db/vykladki.js';
import * as vyk from './vykladka.js';
import { rubli, rubliIli } from '../lib/katalog.js';
import { chasti, moment, momentSlovami } from '../lib/vremya.js';
import { ekr, pole, stranica } from './vid.js';
import type { Obstanovka } from './vid.js';
import type { Slova, Yazyk } from './yazyk.js';

/**
 * Время в языке панели.
 *
 * `momentSlovami` пишет месяц по-русски — и «9 сентября, 11:01»
 * посреди английской страницы читается не переводом, а недоделкой.
 * Часовой пояс при этом ОДИН и тот же: лавка живёт по Москве,
 * и время заказа не должно зависеть от того, на каком языке
 * на него смотрят.
 */
export function momentPaneli(d: Date, poyas: string, yazyk: Yazyk): string {
  if (yazyk === 'ru') return momentSlovami(d, poyas);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: poyas,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Что помощник может сделать с заказом прямо сейчас. */
export type Pod = { estDostup: boolean; estKod: boolean; estAkkaunt: boolean };

export type Shag =
  | 'oplata'
  | 'vzyat'
  | 'kod'
  | 'zhdem_kod'
  | 'dostup'
  | 'otpravit'
  | 'nichego';

/**
 * СЛЕДУЮЩИЙ ШАГ — чистая функция от состояния заказа.
 *
 * Одна и та же и для строки очереди, и для карточки: если бы их было
 * две, они разошлись бы, и в очереди было бы написано одно, а внутри
 * предлагалось другое.
 */
export function sleduyushchiyShag(z: zakazy.Zakaz, pod: Pod): Shag {
  if (z.status === 'zhdet_oplaty') return 'oplata';
  if (z.status === 'oplachen') return 'vzyat';
  if (z.status === 'zhdem_kod') return 'zhdem_kod';
  if (z.status === 'vydan' || z.status === 'otmenen') return 'nichego';
  // Заказ у помощника. Доступ записан — осталось отправить.
  if (pod.estDostup) return 'otpravit';
  // Свой аккаунт, кода ещё нет — сначала код.
  if (z.vid_akkaunta === 'svoy' && !pod.estKod) return 'kod';
  return 'dostup';
}

export function shagSlovami(shag: Shag, s: Slova): string {
  switch (shag) {
    case 'oplata':
      return s.otmetitOplatu;
    case 'vzyat':
      return s.vzyat;
    case 'kod':
      return s.zaprositKod;
    case 'zhdem_kod':
      return `${s.kodZaproshen} — ${s.zhdet.toLowerCase()}`;
    case 'dostup':
      return s.vvestiDostup;
    case 'otpravit':
      return s.otpravitPokupatelyu;
    case 'nichego':
      return '—';
  }
}

/** «2 ч 14 мин» — сколько заказ уже ждёт. */
export function skolkoZhdet(ot: string, seychas = Date.now()): string {
  const minut = Math.max(0, Math.round((seychas - Date.parse(ot)) / 60_000));
  if (minut < 60) return `${minut} мин`;
  const chasov = Math.floor(minut / 60);
  if (chasov < 24) return `${chasov} ч ${minut % 60} мин`;
  return `${Math.floor(chasov / 24)} д ${chasov % 24} ч`;
}

const cena = (z: zakazy.Zakaz, s: Slova): string =>
  z.cena_kop > 0 ? rubli(z.cena_kop) : s.utochnyaetsya;

/**
 * Как назвать своего — исполнителя заказа.
 *
 * Помощник может ни разу не писать боту как покупатель, и тогда
 * в `lyudi` его нет; имя при этом есть в команде. Голый
 * идентификатор в карточке — это загадка вместо ответа.
 */
function ktoTakoy(db: Baza, tgId: number): string {
  const c = lyudi.chelovek(db, tgId);
  if (c) return lyudi.podpis(c, tgId);
  const svoy = komanda.vsya(db).find((x) => x.tg_id === tgId);
  return svoy?.imya ? `${svoy.imya} (id ${tgId})` : `id ${tgId}`;
}

export function pod(db: Baza, z: zakazy.Zakaz, klyuch: Buffer): Pod {
  return {
    estDostup: dostupy.est(db, z.id),
    estKod: kody.vzyat(db, z.id, klyuch) !== null,
    estAkkaunt: svoi.est(db, z.id),
  };
}

// ── очередь ──────────────────────────────────────────────────────────

/**
 * Порядок групп: СНАЧАЛА ТО, ГДЕ ЖДУТ ДЕЙСТВИЯ, и это решение.
 *
 * Очередь отвечает на вопрос «что сделать сейчас», поэтому наверху
 * лежит работа, которую можно доделать прямо в эту минуту, и первой —
 * та, что ближе всего к концу: доступ уже записан, осталось отправить.
 * Внизу — два ожидания, в которых от нас не зависит ничего: оплата
 * придёт извне, код пришлёт покупатель. Расположи их по ходу заказа —
 * и первыми на экране оказались бы ровно те строки, с которыми делать
 * нечего.
 *
 * Группы совпадают со ШАГАМИ, а не со статусами: шаг считает та же
 * `sleduyushchiyShag`, что и раньше, и второго правила «что дальше»
 * в проекте не появилось.
 */
export const GRUPPY: Shag[] = ['otpravit', 'dostup', 'kod', 'vzyat', 'oplata', 'zhdem_kod'];

export function gruppaSlovami(shag: Shag, s: Slova): string {
  switch (shag) {
    case 'otpravit':
      return s.gruppaOtpravit;
    case 'dostup':
      return s.gruppaDostup;
    case 'kod':
      return s.gruppaKod;
    case 'vzyat':
      return s.gruppaVzyat;
    case 'oplata':
      return s.gruppaOplata;
    case 'zhdem_kod':
      return s.gruppaZhdemKod;
    case 'nichego':
      return '—';
  }
}

export type Poryadok = { po: 'zhdet' | 'summa'; napr: 'vozr' | 'ubyv' };

/** Умолчание: дольше всех ждущие сверху. */
export const PORYADOK_PO_UMOLCHANIYU: Poryadok = { po: 'zhdet', napr: 'ubyv' };

export function razobratPoryadok(poisk: URLSearchParams): Poryadok {
  const po = poisk.get('sort') === 'summa' ? 'summa' : 'zhdet';
  const napr = poisk.get('napr') === 'vozr' ? 'vozr' : 'ubyv';
  return { po, napr };
}

/**
 * Сортировка одной меркой на все группы.
 *
 * «Ждёт» — это возраст заказа, поэтому по убыванию ожидания идёт
 * возрастание даты: дольше всех ждущий заказ — самый старый.
 * Заказы без объявленной цены (ноль в базе) при сортировке по сумме
 * уезжают ВНИЗ при любом направлении: ноль здесь значит «неизвестно»,
 * и ставить неизвестное в начало ряда дешёвых значило бы выдавать
 * отсутствие цены за самую низкую.
 */
function razlozhit(spisok: zakazy.Zakaz[], p: Poryadok): zakazy.Zakaz[] {
  const znak = p.napr === 'ubyv' ? -1 : 1;
  return [...spisok].sort((a, b) => {
    if (p.po === 'summa') {
      const net = (z: zakazy.Zakaz) => (z.cena_kop > 0 ? 0 : 1);
      if (net(a) !== net(b)) return net(a) - net(b);
      if (a.cena_kop !== b.cena_kop) return znak * (a.cena_kop - b.cena_kop);
      return a.id - b.id;
    }
    const va = Date.parse(a.sozdan);
    const vb = Date.parse(b.sozdan);
    // Дольше ждёт тот, кто оформлен раньше: убывание ожидания —
    // это возрастание даты, отсюда минус.
    if (va !== vb) return -znak * (va - vb);
    return a.id - b.id;
  });
}

/** Ссылка на ту же очередь с другой сортировкой. */
function ssylkaSortirovki(po: Poryadok['po'], nyneshniy: Poryadok): string {
  // Нажали по той же мерке — меняем сторону; по другой — начинаем
  // с убывания: и «дольше всех ждёт», и «дороже всех» интереснее
  // своих противоположностей.
  const napr = nyneshniy.po === po ? (nyneshniy.napr === 'ubyv' ? 'vozr' : 'ubyv') : 'ubyv';
  return `/admin/ochered?sort=${po}&napr=${napr}`;
}

function strelka(po: Poryadok['po'], p: Poryadok): string {
  if (p.po !== po) return '';
  return p.napr === 'ubyv' ? ' ↓' : ' ↑';
}

export function ochered(
  o: Obstanovka,
  db: Baza,
  klyuch: Buffer,
  poyas: string,
  poryadok: Poryadok = PORYADOK_PO_UMOLCHANIYU,
  svernuto: Set<string> = new Set(),
): string {
  const s = o.s;
  const spisok = [...zakazy.neoplachennye(db), ...zakazy.ochered(db)];

  // Раскладываем по группам ОДИН раз: шаг считается тем же способом,
  // что и в карточке, и считать его дважды незачем.
  const poGruppam = new Map<Shag, zakazy.Zakaz[]>();
  for (const g of GRUPPY) poGruppam.set(g, []);
  for (const z of spisok) {
    const shag = sleduyushchiyShag(z, pod(db, z, klyuch));
    poGruppam.get(shag)?.push(z);
  }

  const hvost = `sort=${poryadok.po}&napr=${poryadok.napr}`;
  const stroka = (z: zakazy.Zakaz): string => {
    const c = lyudi.chelovek(db, z.tg_id);
    return `<tr>
<td class="num">№ ${z.id}</td>
<td><a href="/admin/zakaz/${z.id}">${ekr(z.nazvanie)}</a></td>
<td class="num">${ekr(cena(z, s))}</td>
<td>${ekr(lyudi.podpis(c, z.tg_id))}</td>
<td><span class="metka">${ekr(z.vid_akkaunta === 'svoy' ? s.svoyAkkaunt : s.novyAkkaunt)}</span></td>
<td>${ekr(statusSlovami(z.status, s))}</td>
<td class="zhdet">${ekr(skolkoZhdet(z.sozdan))}</td>
<td><a href="/admin/zakaz/${z.id}">${ekr(s.otkryt)}</a></td>
</tr>`;
  };

  const gruppy = GRUPPY.map((g) => {
    const svoi = razlozhit(poGruppam.get(g) ?? [], poryadok);
    const zakryta = svernuto.has(g);
    const znak = zakryta ? '▸' : '▾';
    // Переключатель — ссылка, а не скрипт: на страницах панели
    // скриптов нет вовсе. Выбор уезжает в куку, поэтому переживает
    // и обновление страницы, и самообновление раз в 30 секунд.
    const perekluchatel = `<a class="gruppa__shapka" href="/admin/ochered/svernut?g=${g}&amp;${hvost}"
 title="${ekr(zakryta ? s.razvernut : s.svernut)}">${znak} ${ekr(gruppaSlovami(g, s))}
<span class="schet">${svoi.length}</span></a>`;
    if (svoi.length === 0) {
      return `<section class="gruppa gruppa--pusta">${perekluchatel}</section>`;
    }
    if (zakryta) return `<section class="gruppa">${perekluchatel}</section>`;
    return `<section class="gruppa">${perekluchatel}
<table><colgroup><col class="c-nomer"><col><col class="c-summa"><col class="c-kto">
<col class="c-akk"><col class="c-sost"><col class="c-zhdet"><col class="c-otkryt"></colgroup>
<thead><tr><th class="num">№</th><th>${ekr(s.chto)}</th>
<th class="num"><a href="${ssylkaSortirovki('summa', poryadok)}">${ekr(s.summa)}${strelka('summa', poryadok)}</a></th>
<th>${ekr(s.kto)}</th><th>${ekr(s.akkaunt)}</th><th>${ekr(s.status)}</th>
<th><a href="${ssylkaSortirovki('zhdet', poryadok)}">${ekr(s.zhdet)}${strelka('zhdet', poryadok)}</a></th>
<th></th></tr></thead><tbody>${svoi.map(stroka).join('')}</tbody></table></section>`;
  }).join('');

  void poyas;
  // Очередь обновляется сама: помощник держит её открытой, и новые
  // заказы должны появляться без нажатия.
  return stranica(o, s.ochered, `<h1>${ekr(s.ochered)} · ${spisok.length}</h1>${gruppy}`, 30);
}

/**
 * СОСТОЯНИЕ заказа, а не действие над ним.
 *
 * Слова здесь свои, отдельные от кнопок, и это не расточительство:
 * пока состояние подписывалось словом кнопки, в колонке «Состояние»
 * стояло «Взять в работу» у заказа, который УЖЕ взят, — то есть
 * колонка врала ровно там, где помощник смотрит первым делом.
 */
export function statusSlovami(st: zakazy.StatusZakaza, s: Slova): string {
  switch (st) {
    case 'zhdet_oplaty':
      return s.stZhdetOplaty;
    case 'oplachen':
      return s.stOplachen;
    case 'v_rabote':
      return s.stVRabote;
    case 'zhdem_kod':
      return s.stZhdemKod;
    case 'kod_poluchen':
      return s.stKodPoluchen;
    case 'vydan':
      return s.stVydan;
    case 'otmenen':
      return s.stOtmenen;
  }
}

// ── карточка заказа ──────────────────────────────────────────────────

export type Pokaz = { kod?: string; akkaunt?: { pochta: string; parol: string }; oshibka?: string; horosho?: string };

export function zakaz(
  o: Obstanovka,
  db: Baza,
  z: zakazy.Zakaz,
  klyuch: Buffer,
  poyas: string,
  pokaz: Pokaz = {},
): string {
  const s = o.s;
  const p = pod(db, z, klyuch);
  const shag = sleduyushchiyShag(z, p);
  const c = lyudi.chelovek(db, z.tg_id);
  const d = (t: string, v: string) => `<dt>${ekr(t)}</dt><dd>${v}</dd>`;
  const mom = (kogda: string) => momentPaneli(new Date(kogda), poyas, o.yazyk);

  const fakty = [
    d(s.chto, ekr(z.nazvanie)),
    d(s.kto, `<a href="/admin/pokupatel/${z.tg_id}">${ekr(lyudi.podpis(c, z.tg_id))}</a>`),
    d(s.akkaunt, ekr(z.vid_akkaunta === 'svoy' ? s.svoyAkkaunt : s.novyAkkaunt)),
    d(s.status, ekr(statusSlovami(z.status, s))),
    d(s.cena, ekr(cena(z, s))),
    z.oplacheno_kop > 0
      ? d(
          s.oplachen,
          ekr(z.s_balansa_kop > 0 ? `${rubli(z.oplacheno_kop)} (${s.sBalansa} ${rubli(z.s_balansa_kop)})` : rubli(z.oplacheno_kop)),
        )
      : '',
    d(s.oformlen, ekr(mom(z.sozdan))),
    z.srok_do ? d(s.obeshchano, ekr(mom(z.srok_do))) : '',
    // Исполнителя показываем ИМЕНЕМ, а не голым идентификатором:
    // «Взял: 777» ничего не говорит владельцу, у которого помощников
    // двое, а имя есть в той же базе.
    z.ispolnitel
      ? d(s.ispolnitel, ekr(ktoTakoy(db, z.ispolnitel)))
      : '',
    z.kod_zapros_v ? d(s.kodZaproshen, ekr(mom(z.kod_zapros_v))) : '',
    z.kod_poluchen_v ? d(s.kodPoluchen, ekr(mom(z.kod_poluchen_v))) : '',
    z.pismo_v ? d(s.pismoOtpravleno, ekr(mom(z.pismo_v))) : '',
    z.prichina_otmeny ? d(s.prichinaOtmeny, ekr(prichinaSlovami(z.prichina_otmeny, s))) : '',
  ].join('');

  const knopka = (deystvie: string, imya: string, klass = '') =>
    `<form method="post" action="/admin/zakaz/${z.id}/${deystvie}" class="ryad">${pole(o)}<button class="${klass}">${ekr(imya)}</button></form>`;

  // ГЛАВНАЯ КНОПКА — одна и отдельно от остальных. Всё прочее ниже,
  // мелким рядом: так шаг не теряется среди возможностей.
  const glavnaya =
    shag === 'oplata'
      ? knopka('oplata', s.otmetitOplatu)
      : shag === 'vzyat'
        ? knopka('vzyat', s.vzyat)
        : shag === 'kod'
          ? knopka('kod', s.zaprositKod)
          : shag === 'otpravit'
            ? knopka('otpravit', s.otpravitPokupatelyu)
            : shag === 'zhdem_kod'
              ? `<p class="tiho">${ekr(shagSlovami(shag, s))}</p>${knopka('kod', s.zaprositKod, 'tihaya')}`
              : '';

  const vvod =
    shag === 'dostup' || (p.estDostup && z.status !== 'vydan')
      ? `<form method="post" action="/admin/zakaz/${z.id}/dostup">${pole(o)}
<label>${ekr(s.login)}</label><input type="text" name="login" required>
<label>${ekr(s.parolDostupa)}</label><input type="text" name="parol" required>
<label>${ekr(s.zametka)}</label><textarea name="zametka"></textarea>
<button>${ekr(s.sohranitDostup)}</button></form>`
      : '';

  const svoyBlok =
    z.vid_akkaunta === 'svoy'
      ? `<div class="karta"><h2>${ekr(s.dannyeAkkaunta)}</h2>` +
        (pokaz.akkaunt
          ? `<dl class="fakty">${d(s.pochta, `<span class="tayna">${ekr(pokaz.akkaunt.pochta)}</span>`)}${d(
              s.parol,
              `<span class="tayna">${ekr(pokaz.akkaunt.parol)}</span>`,
            )}</dl>`
          : p.estAkkaunt
            ? knopka('akkaunt', s.pokazatDannye, 'tihaya')
            : `<p class="tiho">—</p>`) +
        (pokaz.kod ? `<dl class="fakty">${d(s.kod, `<span class="tayna">${ekr(pokaz.kod)}</span>`)}</dl>` : p.estKod ? knopka('kod-pokazat', s.pokazatKod, 'tihaya') : '') +
        (!z.pismo_v && z.status !== 'vydan' && z.status !== 'otmenen' ? knopka('pismo', s.otmetitPismo, 'tihaya') : '') +
        '</div>'
      : '';

  // Причина «пароль не подошёл» и напоминание о письме — только
  // у заказа СО СВОИМ аккаунтом. У заказа на новый аккаунт пароля
  // покупателя нет вовсе, и строка про письмо восстановления там
  // читалась бы требованием сделать невозможное.
  const svoyAkk = z.vid_akkaunta === 'svoy';
  const otmena = ['vydan', 'otmenen'].includes(z.status)
    ? ''
    : `<div class="karta"><h2>${ekr(s.otmenit)}</h2>
<form method="post" action="/admin/zakaz/${z.id}/otmena" class="ryad">${pole(o)}
<div><label>${ekr(s.prichinaOtmeny)}</label>
<select name="prichina">
<option value="ruchnaya">${ekr(s.otmenaRuchnaya)}</option>
${svoyAkk && z.pismo_v ? `<option value="nevernyy_parol">${ekr(s.otmenaParol)}</option>` : ''}
</select></div>
<button class="opasnaya">${ekr(s.otmenit)}</button></form>
${svoyAkk && !z.pismo_v ? `<p class="tiho">${ekr(s.nuzhnoPismo)}</p>` : ''}</div>`;

  const vernut = ['v_rabote', 'zhdem_kod', 'kod_poluchen'].includes(z.status)
    ? knopka('vernut', s.vernutVOchered, 'tihaya')
    : '';

  const sobytiya = zakazy
    .sobytiya(db, z.id)
    .map((e) => `<tr><td>${ekr(mom(e.kogda))}</td><td>${ekr(e.chto)}</td></tr>`)
    .join('');

  const telo = `
<p><a href="/admin/ochered">← ${ekr(s.nazad)}</a></p>
<h1>${ekr(s.zakaz)} № ${z.id}</h1>
${pokaz.oshibka ? `<div class="oshibka">${ekr(pokaz.oshibka)}</div>` : ''}
${pokaz.horosho ? `<div class="horosho">${ekr(pokaz.horosho)}</div>` : ''}
${glavnaya ? `<div class="shag"><h2>${ekr(s.sleduyushchiyShag)}</h2>${glavnaya}</div>` : ''}
<div class="karta"><dl class="fakty">${fakty}</dl></div>
${svoyBlok}
${vvod ? `<div class="karta"><h2>${ekr(s.vvestiDostup)}</h2>${vvod}</div>` : ''}
${vernut ? `<div class="karta">${vernut}</div>` : ''}
${otmena}
<h2>${ekr(s.sobytiya)}</h2>
<table><tbody>${sobytiya}</tbody></table>`;
  return stranica(o, `${s.zakaz} № ${z.id}`, telo);
}

export function prichinaSlovami(p: zakazy.PrichinaOtmeny, s: Slova): string {
  return p === 'net_koda' ? s.otmenaNetKoda : p === 'nevernyy_parol' ? s.otmenaParol : s.otmenaRuchnaya;
}

// ── покупатели ───────────────────────────────────────────────────────

export function pokupateli(o: Obstanovka, db: Baza, poisk: lyudi.Poisk = {}): string {
  const s = o.s;
  const svodka = lyudi.svodka(db);
  const najdeno = lyudi.spisok(db, 200, poisk);
  const otbor = poisk.otbor ?? 'vse';
  const q = (poisk.q ?? '').trim();

  const stroki = najdeno
    .map(
      (c) => `<tr><td class="num">${c.tg_id}</td>
<td><a href="/admin/pokupatel/${c.tg_id}">${ekr(lyudi.podpis(c, c.tg_id))}</a></td>
<td class="num">${c.zakazov}</td><td class="num">${c.vydano}</td>
<td class="num">${ekr(rubli(c.balans_kop))}</td></tr>`,
    )
    .join('');

  const knopka = (k: lyudi.Otbor, imya: string) =>
    k === otbor
      ? `<span class="vybran">${ekr(imya)}</span>`
      : `<a href="/admin/pokupateli?otbor=${k}${q ? `&amp;q=${encodeURIComponent(q)}` : ''}">${ekr(imya)}</a>`;

  // Отбор — ссылки, поиск — форма: у ссылок состояние видно в адресе
  // и его можно оставить в закладке, а строку поиска всё равно надо
  // куда-то вводить.
  const telo = `<h1>${ekr(s.pokupateli)}</h1>
<div class="karta"><dl class="fakty">
<dt>${ekr(s.vsegoPokupateley)}</dt><dd>${svodka.vsego}</dd>
<dt>${ekr(s.zaNedelyu)}</dt><dd>${svodka.zaNedelyu}</dd>
<dt>${ekr(s.zaMesyac)}</dt><dd>${svodka.zaMesyac}</dd>
<dt>${ekr(s.zaGod)}</dt><dd>${svodka.zaGod}</dd>
</dl></div>
<div class="karta">
<form method="get" action="/admin/pokupateli" class="ryad">
<input type="hidden" name="otbor" value="${ekr(otbor)}">
<div><label>${ekr(s.poisk)}</label>
<input type="text" name="q" value="${ekr(q)}" placeholder="${ekr(s.poiskPodskazka)}" style="width:260px"></div>
<button>${ekr(s.primenit)}</button>
${q || otbor !== 'vse' ? `<a href="/admin/pokupateli" style="align-self:center">${ekr(s.sbrosit)}</a>` : ''}
</form>
<div class="perekluchatel" style="margin-top:10px">
${knopka('vse', s.otborVse)}${knopka('s_zakazami', s.otborSZakazami)}
${knopka('bez_zakazov', s.otborBezZakazov)}${knopka('s_balansom', s.otborSBalansom)}
</div></div>
${
  najdeno.length
    ? `<p class="tiho">${ekr(s.naydeno)}: ${najdeno.length}</p>
<table><thead><tr><th class="num">id</th><th>${ekr(s.kto)}</th><th class="num">${ekr(s.zakazov)}</th>
<th class="num">${ekr(s.vydano)}</th><th class="num">${ekr(s.balans)}</th></tr></thead><tbody>${stroki}</tbody></table>`
    : `<p class="tiho">${ekr(s.nikogoNeNashlos)}</p>`
}`;
  return stranica(o, s.pokupateli, telo);
}

export function pokupatel(o: Obstanovka, db: Baza, tgId: number, poyas: string): string {
  const s = o.s;
  const c = lyudi.chelovek(db, tgId);
  const dvizh = koshelek
    .dvizheniya(db, tgId, 50)
    .map(
      (d) =>
        `<tr><td>${ekr(momentPaneli(new Date(d.kogda), poyas, o.yazyk))}</td>
<td class="num">${d.kop > 0 ? '+' : '−'}${ekr(rubli(Math.abs(d.kop)))}</td>
<td>${ekr(d.za_chto)}</td></tr>`,
    )
    .join('');
  const zak = zakazy
    .cheloveka(db, tgId, 50)
    .map(
      (z) =>
        `<tr><td class="num"><a href="/admin/zakaz/${z.id}">№ ${z.id}</a></td>
<td>${ekr(z.nazvanie)}</td><td>${ekr(statusSlovami(z.status, s))}</td>
<td class="num">${ekr(cena(z, s))}</td>
<td>${ekr(momentPaneli(new Date(z.sozdan), poyas, o.yazyk))}</td></tr>`,
    )
    .join('');
  const telo = `<p><a href="/admin/pokupateli">← ${ekr(s.pokupateli)}</a></p>
<h1>${ekr(lyudi.podpis(c, tgId))}</h1>
<div class="karta"><dl class="fakty">
<dt>${ekr(s.balans)}</dt><dd>${ekr(rubli(koshelek.balans(db, tgId)))}</dd>
<dt>id</dt><dd>${tgId}</dd></dl>
<form method="post" action="/admin/pokupatel/${tgId}/popolnit" class="ryad" style="margin-top:10px">${pole(o)}
<div><label>${ekr(s.summaRubley)}</label><input type="number" name="rubli" min="1" step="1" required></div>
<button>${ekr(s.popolnit)}</button></form></div>
<h2>${ekr(s.dvizheniya)}</h2><table><tbody>${dvizh || `<tr><td class="tiho">${ekr(s.pusto)}</td></tr>`}</tbody></table>
<h2>${ekr(s.istoriyaZakazov)}</h2><table><tbody>${zak || `<tr><td class="tiho">${ekr(s.pusto)}</td></tr>`}</tbody></table>`;
  return stranica(o, lyudi.podpis(c, tgId), telo);
}

// ── каталог ──────────────────────────────────────────────────────────

export function katalog(o: Obstanovka, db: Baza): string {
  const s = o.s;
  const cenaPole = (imya: string, kop: number | null) =>
    `<input type="number" name="${imya}" min="0" step="0.01" value="${kop === null ? '' : (kop / 100).toString()}" placeholder="${ekr(s.utochnyaetsya)}" style="width:120px">`;

  const produkty = bdKatalog
    .produkty(db, true)
    .map((p) => {
      const skryt = bdKatalog.produkty(db, false).every((v) => v.id !== p.id);
      const urovni = p.plans
        .map(
          (u) => `<tr><td>${ekr(u.short)}</td><td>${ekr(u.title)}</td>
<td><form method="post" action="/admin/katalog/uroven/${ekr(u.id)}" class="ryad">${pole(o)}
${cenaPole('cena', u.priceRub === null ? null : Math.round(u.priceRub * 100))}
<button class="tihaya">${ekr(s.sohranit)}</button></form></td></tr>`,
        )
        .join('');
      return `<div class="karta">
<h2>${ekr(p.name)} ${skryt ? `<span class="metka">${ekr(s.spryatan)}</span>` : ''}</h2>
<form method="post" action="/admin/katalog/produkt/${ekr(p.id)}">${pole(o)}
<label>${ekr(s.imya)}</label><input type="text" name="imya" value="${ekr(p.name)}">
<label>${ekr(s.opisanie)}</label><input type="text" name="tagline" value="${ekr(p.tagline)}" style="width:100%">
<label>${ekr(s.chtoPoluchaesh)}</label><input type="text" name="note" value="${ekr(p.note)}" style="width:100%">
${p.plans.length === 0 ? `<label>${ekr(s.cena)}</label>${cenaPole('cena', p.priceRub === null ? null : Math.round(p.priceRub * 100))}` : ''}
<p><button>${ekr(s.sohranit)}</button>
<button name="skryt" value="${skryt ? '0' : '1'}" class="tihaya">${ekr(skryt ? s.pokazat : s.skryt)}</button></p></form>
${p.plans.length ? `<table><thead><tr><th>${ekr(s.korotko)}</th><th>${ekr(s.polnoeNazvanie)}</th><th>${ekr(s.cena)}, ₽</th></tr></thead><tbody>${urovni}</tbody></table>` : ''}
<form method="post" action="/admin/katalog/uroven-novyy/${ekr(p.id)}" class="ryad" style="margin-top:10px">${pole(o)}
<div><label>${ekr(s.korotko)}</label><input type="text" name="short" required placeholder="Pro"></div>
<button class="tihaya">${ekr(s.dobavitUroven)}</button></form>
</div>`;
    })
    .join('');

  // Подсказка стоит ЗДЕСЬ, а не только на странице выкладки: цену
  // меняют тут, и узнать, что она ещё не на витрине, человек должен
  // на том же экране, где её поставил.
  const r = vyk.rashozhdenie(db);
  const podskazka = r.est
    ? `<div class="karta shag"><b>${ekr(r.nikogda ? s.nikogdaNeVykladyvali : s.cenyRazoshlis)}</b>
<p class="tiho" style="margin:6px 0 10px">${ekr(s.vykladkaPoyasnenie)}</p>
<a href="/admin/vykladka">${ekr(s.vylozhitNaSayt)} →</a></div>`
    : `<div class="karta"><span class="tiho">${ekr(s.cenySovpadayut)}</span></div>`;

  const telo = `<h1>${ekr(s.katalog)}</h1>
${podskazka}
${produkty}
<div class="karta"><h2>${ekr(s.dobavitProdukt)}</h2>
<form method="post" action="/admin/katalog/produkt-novyy" class="ryad">${pole(o)}
<div><label>${ekr(s.identifikator)}</label><input type="text" name="id" required placeholder="midjourney"></div>
<div><label>${ekr(s.imya)}</label><input type="text" name="imya" required placeholder="Midjourney"></div>
<button>${ekr(s.dobavitProdukt)}</button></form></div>`;
  return stranica(o, s.katalog, telo);
}

// ── статистика ───────────────────────────────────────────────────────

export type KodPerioda = 'segodnya' | 'vchera' | 'nedelya' | 'mesyac' | 'god' | 'vse';

export const PERIODY: KodPerioda[] = ['segodnya', 'vchera', 'nedelya', 'mesyac', 'god', 'vse'];

export function razobratPeriod(znachenie: string | null): KodPerioda {
  return (PERIODY as string[]).includes(znachenie ?? '') ? (znachenie as KodPerioda) : 'vse';
}

export function periodSlovami(k: KodPerioda, s: Slova): string {
  switch (k) {
    case 'segodnya':
      return s.segodnya;
    case 'vchera':
      return s.vchera;
    case 'nedelya':
      return s.nedelya;
    case 'mesyac':
      return s.mesyac;
    case 'god':
      return s.god;
    case 'vse':
      return s.vseVremya;
  }
}

/**
 * Границы периода.
 *
 * «Сегодня» и «вчера» — КАЛЕНДАРНЫЕ сутки лавки, а не последние
 * 24 часа: человек, спрашивающий «сколько сегодня», имеет в виду день
 * по московским часам, и в 00:30 ответ обязан обнулиться. Остальные
 * три — скользящие окна ровно той же длины, что у сводки покупателей:
 * две страницы, считающие «за неделю» по-разному, — это два ответа
 * на один вопрос.
 *
 * Начало суток берётся по стенным часам пояса через `moment`, а не
 * вычитанием часов: пояс с переводом стрелок сдвинул бы границу
 * ровно в тот день, когда её и надо посчитать точно.
 */
export function oknoPerioda(k: KodPerioda, poyas: string, seychas = Date.now()): zakazy.Okno {
  const nachaloDnya = (t: number): Date => {
    const c = chasti(new Date(t), poyas);
    return moment({ god: c.god, mesyac: c.mesyac, den: c.den, chas: 0, minuta: 0 }, poyas);
  };
  const skolzhenie = (dney: number): zakazy.Okno => ({
    ot: new Date(seychas - dney * 24 * 3600_000).toISOString(),
    do: null,
  });
  if (k === 'segodnya') return { ot: nachaloDnya(seychas).toISOString(), do: null };
  if (k === 'vchera') {
    const segodnya = nachaloDnya(seychas);
    // Полдня назад от начала суток — это заведомо вчера при любом
    // переводе стрелок.
    const vchera = nachaloDnya(segodnya.getTime() - 12 * 3600_000);
    return { ot: vchera.toISOString(), do: segodnya.toISOString() };
  }
  if (k === 'nedelya') return skolzhenie(7);
  if (k === 'mesyac') return skolzhenie(30);
  if (k === 'god') return skolzhenie(365);
  return { ot: null, do: null };
}

export function statistika(o: Obstanovka, db: Baza, poyas: string, period: KodPerioda = 'vse'): string {
  const s = o.s;
  const okno = oknoPerioda(period, poyas);
  const st = zakazy.statistika(db, okno);
  // Те же правила, что в сводке бота: ноль как цена не печатается.
  const dengi = (summa: number, vsego: number, bez: number) =>
    vsego === 0 ? s.vydachNeBylo : bez >= vsego ? s.cenaNeObyavlena : bez > 0 ? `${rubli(summa)} (${bez}/${vsego} ${s.cenaNeObyavlena})` : rubli(summa);
  const vydano = st.poStatusam['vydan'] ?? 0;
  const vybor = PERIODY.map((k) =>
    k === period
      ? `<span class="vybran">${ekr(periodSlovami(k, s))}</span>`
      : `<a href="/admin/statistika?za=${k}">${ekr(periodSlovami(k, s))}</a>`,
  ).join('');
  const stroki = (
    [
      ['zhdet_oplaty', s.stZhdetOplaty],
      ['oplachen', s.stOplachen],
      ['v_rabote', s.stVRabote],
      ['zhdem_kod', s.stZhdemKod],
      ['kod_poluchen', s.stKodPoluchen],
      ['vydan', s.stVydan],
      ['otmenen', s.stOtmenen],
    ] as const
  )
    .map(([k, imya]) => `<tr><td>${ekr(imya)}</td><td class="num">${st.poStatusam[k] ?? 0}</td></tr>`)
    .join('');
  const tovary = st.poTovaram
    .map(
      (p) =>
        // Имя продукта, а не его идентификатор: `chatgpt` в отчёте
        // читается кодом, а владелец смотрит на витрину.
        `<tr><td>${ekr(bdKatalog.produkt(db, p.produkt_id, true)?.name ?? p.produkt_id)}</td>` +
        `<td class="num">${p.skolko}</td><td class="num">${ekr(dengi(p.summa_kop, p.skolko, p.bez_ceny))}</td></tr>`,
    )
    .join('');
  const granica = okno.ot
    ? `<div class="tiho">${ekr(s.sVremeni)} ${ekr(momentPaneli(new Date(okno.ot), poyas, o.yazyk))}${
        okno.do ? ` — ${ekr(momentPaneli(new Date(okno.do), poyas, o.yazyk))}` : ''
      }</div>`
    : '';
  const telo = `<h1>${ekr(s.statistika)}</h1>
<div class="karta"><div class="perekluchatel"><span class="tiho">${ekr(s.period)}</span>${vybor}</div>
${granica}</div>
<div class="karta"><dl class="fakty">
<dt>${ekr(s.oformleno)}</dt><dd>${st.vsego}</dd>
<dt>${ekr(s.vyruchkaZaPeriod)}</dt><dd>${ekr(dengi(st.vyruchkaKop, vydano, st.bezCeny))}</dd>
<dt>${ekr(s.srednyayaVydacha)}</dt><dd>${st.srednyayaVydachaMinut === null ? '—' : `${st.srednyayaVydachaMinut} ${ekr(s.minut)}`}</dd>
</dl>
<p class="tiho" style="margin:10px 0 0">${ekr(s.oknoPoyasnenie)}</p></div>
<table><tbody>${stroki}</tbody></table>
${tovary ? `<h2>${ekr(s.poTovaram)}</h2><table><tbody>${tovary}</tbody></table>` : ''}`;
  return stranica(o, s.statistika, telo);
}

// ── выкладка на сайт ─────────────────────────────────────────────────

/**
 * Страница выкладки: одна кнопка и честный ответ, что происходит.
 *
 * Никаких слов из машинного мира. Человек, который меняет цены, ничего
 * не должен знать ни про хранилище кода, ни про сборку: он видит
 * «цены в панели новее, чем на сайте», нажимает и смотрит, когда
 * это перестанет быть правдой.
 */
export function vykladka(
  o: Obstanovka,
  db: Baza,
  poyas: string,
  adresSayta: string,
  pokaz: { oshibka?: string; horosho?: string } = {},
): string {
  const s = o.s;
  const idet = bdVykladki.idushchaya(db);
  const r = vyk.rashozhdenie(db);
  const spisok = bdVykladki.istoriya(db, 8);
  const mom = (kogda: string) => momentPaneli(new Date(kogda), poyas, o.yazyk);

  const sostoyanie = idet
    ? `<div class="karta shag"><h2>${ekr(s.vykladkaIdet)}</h2>
<p class="tiho">${ekr(s.vykladkaIdetPoyasnenie)}</p>
<dl class="fakty"><dt>${ekr(s.nachata)}</dt><dd>${ekr(mom(idet.nachata))}</dd></dl></div>`
    : `<div class="karta"><dl class="fakty">
<dt>${ekr(s.status)}</dt><dd>${
        r.nikogda
          ? ekr(s.nikogdaNeVykladyvali)
          : r.est
            ? `<b>${ekr(s.cenyRazoshlis)}</b>`
            : ekr(s.cenySovpadayut)
      }</dd></dl></div>`;

  // Кнопки нет, пока выкладка идёт: второе нажатие всё равно
  // не запустит вторую, но кнопка, которая ничего не делает, —
  // это обещание, которого не сдержать.
  const knopka = idet
    ? ''
    : `<form method="post" action="/admin/vykladka/vylozhit" class="ryad">${pole(o)}
<button>${ekr(s.vylozhitNaSayt)}</button>
<a href="${ekr(adresSayta)}" target="_blank" rel="noopener noreferrer" style="align-self:center">${ekr(s.smotretSayt)}</a></form>`;

  const stroki = spisok
    .map(
      (v) => `<tr><td>${ekr(mom(v.nachata))}</td>
<td>${ekr(v.status === 'idet' ? s.vykladkaIdet : v.status === 'vylozheno' ? s.vylozheno : s.neVyshlo)}</td>
<td>${ekr(v.kto ? ktoTakoy(db, v.kto) : '—')}</td>
<td>${ekr(v.soobshchenie ?? '')}</td></tr>`,
    )
    .join('');

  const telo = `<h1>${ekr(s.vykladka)}</h1>
${pokaz.oshibka ? `<div class="oshibka">${ekr(pokaz.oshibka)}</div>` : ''}
${pokaz.horosho ? `<div class="horosho">${ekr(pokaz.horosho)}</div>` : ''}
<div class="karta"><p class="tiho" style="margin:0">${ekr(s.vykladkaPoyasnenie)}</p></div>
${sostoyanie}
${knopka ? `<div class="karta">${knopka}</div>` : ''}
<h2>${ekr(s.istoriyaVykladok)}</h2>
${
    stroki
      ? `<table><thead><tr><th>${ekr(s.nachata)}</th><th>${ekr(s.status)}</th>
<th>${ekr(s.kemVylozheno)}</th><th></th></tr></thead><tbody>${stroki}</tbody></table>`
      : `<p class="tiho">${ekr(s.vykladokNeBylo)}</p>`
  }`;
  // Пока идёт — страница обновляет себя: человек не должен гадать,
  // кончилось или нет.
  return stranica(o, s.vykladka, telo, idet ? 15 : 0);
}

// ── вход ─────────────────────────────────────────────────────────────

export function vhod(o: Obstanovka, oshibka?: string): string {
  const s = o.s;
  return stranica(
    o,
    s.vhod,
    `<form class="vhod" method="post" action="/admin/vhod">
<h1>${ekr(s.panel)}</h1>
${oshibka ? `<div class="oshibka">${ekr(oshibka)}</div>` : ''}
<label>${ekr(s.login)}</label><input type="text" name="login" autocomplete="username" required autofocus>
<label>${ekr(s.parol)}</label><input type="password" name="parol" autocomplete="current-password" required>
<button>${ekr(s.voyti)}</button>
<p style="text-align:center;margin:14px 0 0"><a href="/admin/yazyk?na=${o.yazyk === 'ru' ? 'en' : 'ru'}&nazad=%2Fadmin">${o.yazyk === 'ru' ? 'English' : 'Русский'}</a></p>
</form>`,
  );
}
