/**
 * Как панель выглядит.
 *
 * Это не витрина, а станок: плотные таблицы, крупные кнопки шага,
 * ничего движущегося. Человек сидит здесь весь день и ведёт несколько
 * заказов разом — значит важнее всего, чтобы с одного взгляда было
 * видно, ЧТО СДЕЛАТЬ СЕЙЧАС.
 *
 * Страницы собираются строками на сервере. Ни одного скрипта на
 * странице нет вовсе, и это не аскеза: политика содержимого запрещает
 * их целиком (`script-src 'none'`), а значит внедрить чужой скрипт
 * в панель нельзя даже теоретически.
 */

import { SLOVAR } from './yazyk.js';
import type { Slova, Yazyk } from './yazyk.js';

/**
 * Экранирование. Через неё проходит ВСЁ, что пришло снаружи: имена
 * покупателей, названия товаров, записки. Иначе имя вида
 * `<img onerror=…>` становится кодом на странице администратора.
 */
export function ekr(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STIL = `
:root{--f:#f6f5f2;--p:#fff;--t:#18201b;--m:#5c6660;--l:#dedbd5;--a:#365c30;--o:#8a2f22;--z:#f0efe9}
*{box-sizing:border-box}
body{margin:0;font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--f);color:var(--t)}
a{color:var(--a)}
header{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:10px 18px;background:var(--p);border-bottom:1px solid var(--l)}
header .imya{font-weight:600}
header nav{display:flex;gap:14px}
header .spravo{margin-left:auto;display:flex;gap:14px;align-items:center;color:var(--m);font-size:13px}
main{padding:18px;max-width:1180px}
h1{font-size:20px;margin:0 0 14px}
h2{font-size:16px;margin:22px 0 8px}
table{border-collapse:collapse;width:100%;background:var(--p);border:1px solid var(--l)}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--l);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--m);background:var(--z)}
tr:last-child td{border-bottom:none}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.karta{background:var(--p);border:1px solid var(--l);padding:14px 16px;margin-bottom:14px}
.fakty{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0}
.fakty dt{color:var(--m)}
.fakty dd{margin:0}
.shag{background:var(--p);border:1px solid var(--l);border-left:3px solid var(--a);padding:12px 14px;margin-bottom:14px}
.shag h2{margin:0 0 8px}
form.ryad{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:0}
label{display:block;font-size:12px;color:var(--m);margin-bottom:3px}
input[type=text],input[type=password],input[type=number],textarea,select{font:inherit;padding:7px 9px;border:1px solid var(--l);background:var(--p);color:var(--t);border-radius:3px;min-width:0}
textarea{min-height:60px;width:100%}
button{font:inherit;padding:8px 14px;border:1px solid var(--a);background:var(--a);color:#fff;border-radius:3px;cursor:pointer}
button.tihaya{background:var(--p);color:var(--t);border-color:var(--l)}
button.opasnaya{background:var(--p);color:var(--o);border-color:var(--o)}
.metka{display:inline-block;padding:1px 7px;border:1px solid var(--l);border-radius:10px;font-size:12px;color:var(--m);background:var(--z)}
.zhdet{color:var(--o);font-variant-numeric:tabular-nums}
.tiho{color:var(--m)}
.oshibka{background:#fdf1ee;border:1px solid var(--o);color:var(--o);padding:10px 12px;margin-bottom:14px}
.horosho{background:#eef4ec;border:1px solid var(--a);color:var(--a);padding:10px 12px;margin-bottom:14px}
.tayna{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--z);padding:2px 6px;border-radius:3px}
pre{background:var(--z);border:1px solid var(--l);padding:12px;overflow:auto;font-size:12px}
.vhod{max-width:340px;margin:12vh auto;background:var(--p);border:1px solid var(--l);padding:22px}
.vhod label{margin-top:10px}
.vhod input{width:100%}
.vhod button{width:100%;margin-top:14px}
.gruppa{margin-bottom:14px}
.gruppa__shapka{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--p);border:1px solid var(--l);color:var(--t);text-decoration:none;font-weight:600}
.gruppa__shapka:hover{background:var(--z)}
.gruppa table{border-top:none;table-layout:fixed}
/* Колонки всех групп обязаны стоять на одной вертикали: помощник
   ведёт взглядом сверху вниз, и «Сумма», уехавшая на 40 пикселей
   в соседней группе, стоит ему лишнего движения глазами. */
.gruppa col.c-nomer{width:76px}
.gruppa col.c-summa{width:120px}
.gruppa col.c-kto{width:220px}
.gruppa col.c-akk{width:100px}
.gruppa col.c-sost{width:140px}
.gruppa col.c-zhdet{width:120px}
.gruppa col.c-otkryt{width:92px}
.gruppa td,.gruppa th{overflow:hidden;text-overflow:ellipsis}
.schet{margin-left:auto;font-weight:400;color:var(--m);font-variant-numeric:tabular-nums}
.gruppa--pusta .gruppa__shapka{font-weight:400;color:var(--m)}
.perekluchatel{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.vybran{font-weight:600;border-bottom:2px solid var(--a)}
th a{color:var(--m);text-decoration:none}
th a:hover{color:var(--a);text-decoration:underline}
`;

export type Obstanovka = {
  yazyk: Yazyk;
  s: Slova;
  login?: string;
  rol?: 'vladelec' | 'pomoshnik';
  /** Токен против подделки запроса. Кладётся в каждую форму. */
  zashchita?: string;
  /** Адрес, на котором мы сейчас, — для подсветки раздела и возврата. */
  put: string;
};

/** Скрытое поле защиты. Без него ни одна форма панели не принимается. */
export function pole(o: Obstanovka): string {
  return `<input type="hidden" name="zashchita" value="${ekr(o.zashchita ?? '')}">`;
}

/** Ссылка на смену языка — с возвратом туда же, где стоим. */
function perekluchatel(o: Obstanovka): string {
  const drugoy: Yazyk = o.yazyk === 'ru' ? 'en' : 'ru';
  const nazad = encodeURIComponent(o.put);
  return `<a href="/admin/yazyk?na=${drugoy}&nazad=${nazad}">${drugoy.toUpperCase()}</a>`;
}

export function stranica(o: Obstanovka, zagolovok: string, telo: string, obnovlyat = 0): string {
  const razdely = o.login
    ? [
        `<a href="/admin/ochered">${ekr(o.s.ochered)}</a>`,
        ...(o.rol === 'vladelec'
          ? [
              `<a href="/admin/pokupateli">${ekr(o.s.pokupateli)}</a>`,
              `<a href="/admin/katalog">${ekr(o.s.katalog)}</a>`,
              `<a href="/admin/statistika">${ekr(o.s.statistika)}</a>`,
              `<a href="/admin/vykladka">${ekr(o.s.vykladka)}</a>`,
            ]
          : []),
      ].join('')
    : '';
  const kto = o.login
    ? `<span>${ekr(o.s.vy)}: ${ekr(o.login)} · ${ekr(o.rol === 'vladelec' ? o.s.vladelec : o.s.pomoshnik)}</span>` +
      `<form method="post" action="/admin/vyhod" style="margin:0">${pole(o)}` +
      `<button class="tihaya">${ekr(o.s.vyyti)}</button></form>`
    : '';
  return `<!doctype html><html lang="${o.yazyk}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
${obnovlyat ? `<meta http-equiv="refresh" content="${obnovlyat}">` : ''}
<title>${ekr(zagolovok)} · ${ekr(o.s.panel)}</title><style>${STIL}</style></head><body>
${o.login ? `<header><span class="imya">${ekr(o.s.panel)}</span><nav>${razdely}</nav><span class="spravo">${perekluchatel(o)}${kto}</span></header>` : ''}
<main>${telo}</main></body></html>`;
}
