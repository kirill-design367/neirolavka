/**
 * Проверка боем: боевой адрес глазами постороннего.
 *
 * Судит ПО СОДЕРЖИМОМУ, а не по коду ответа. Причина простая: 200
 * отдаёт и заглушка хостера, и страница «сайт переехал», и старая
 * версия из кеша. Код говорит «что-то ответило», содержимое —
 * «ответила наша лавка».
 *
 * И вторая половина той же мысли: проверка не должна падать на
 * пустяках. Ложная тревога приучает не читать вывод, и настоящая
 * поломка проезжает мимо. Поэтому здесь ДВА уровня:
 *
 *   ПЛОХО   — сайт сломан для человека. Код возврата 1.
 *   внимание — стоит посмотреть, но люди этого не заметят. Код 0.
 *
 * Запуск: node scripts/check-live.mjs https://neirolavka.ru
 */
import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import { URL } from 'node:url';

const ADRES = process.argv[2] ?? 'https://neirolavka.ru';
const BAZA = new URL(ADRES);
const IMYA = BAZA.hostname;
const MESTNYY = /^(localhost|127\.|\[?::1)/.test(IMYA);
/* Боевой адрес обязан быть по https. Прогон по http против настоящего
   домена — это не «мягкий режим», это непроверенный сертификат
   и непроверенные переходы, то есть половина смысла. Поэтому http
   допустим только для местной выдачи, где сертификата и нет. */
const PO_HTTPS = BAZA.protocol === 'https:';
const KANON = PO_HTTPS
  ? `https://${IMYA.replace(/^www\./, '')}`
  : `${BAZA.protocol}//${BAZA.host}`;

let plohih = 0;
let vnimanie = 0;
const ok = (t) => console.log(`  ok       ${t}`);
const no = (t) => { plohih++; console.log(`  ПЛОХО    ${t}`); };
const vn = (t) => { vnimanie++; console.log(`  внимание ${t}`); };
const shag = (t) => console.log(`\n── ${t} ──`);

/** Запрос без слежения за переходами, с замером времени до первого байта. */
function zapros(adres, { metod = 'GET', zagolovki = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(adres);
    const mod = u.protocol === 'https:' ? https : http;
    const nachalo = process.hrtime.bigint();
    let pervyy = null;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: metod,
        servername: u.hostname,
        headers: {
          'accept-encoding': 'gzip, br',
          'user-agent': 'neirolavka-proverka/1',
          host: u.host,
          ...zagolovki,
        },
        timeout: 15000,
      },
      (res) => {
        pervyy = Number(process.hrtime.bigint() - nachalo) / 1e6;
        const kuski = [];
        res.on('data', (d) => kuski.push(d));
        res.on('end', () =>
          resolve({
            kod: res.statusCode,
            zagolovki: res.headers,
            telo: Buffer.concat(kuski),
            ttfb: pervyy,
            szhato: Buffer.concat(kuski).length,
          }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('ответа нет 15 секунд')));
    req.on('error', reject);
    req.end();
  });
}

/** Тело как текст: node сжатие не снимает, снимаем сами. */
const tekst = (o) => {
  const e = o.zagolovki['content-encoding'];
  try {
    if (e === 'gzip') return zlib.gunzipSync(o.telo).toString('utf8');
    if (e === 'br') return zlib.brotliDecompressSync(o.telo).toString('utf8');
    if (e === 'deflate') return zlib.inflateSync(o.telo).toString('utf8');
  } catch {
    return o.telo.toString('utf8');
  }
  return o.telo.toString('utf8');
};

console.log(`\nПроверка боем: ${ADRES}`);

// ─── 1. Сертификат и цепочка целиком ────────────────────────────────
shag('сертификат и цепочка');
if (!PO_HTTPS && !MESTNYY) {
  no(`${ADRES} — боевой адрес по http. Сертификат и переходы не проверены, а это половина проверки`);
} else if (!PO_HTTPS) {
  console.log('  пропуск  местная выдача по http: сертификата и переходов тут нет');
}
if (PO_HTTPS) await new Promise((resolve) => {
  const s = tls.connect(
    { host: IMYA, port: 443, servername: IMYA, rejectUnauthorized: true },
    () => {
      ok(`рукопожатие прошло, доверенный: ${s.authorized}`);
      ok(`протокол ${s.getProtocol()}, шифр ${s.getCipher().name}`);

      // Цепочка целиком: браузер не станет докачивать недостающее
      // промежуточное звено, а вот curl и мобильные клиенты
      // спотыкаются об это регулярно.
      let c = s.getPeerCertificate(true);
      const zvenya = [];
      const vidennye = new Set();
      while (c && c.fingerprint && !vidennye.has(c.fingerprint)) {
        vidennye.add(c.fingerprint);
        zvenya.push(c);
        c = c.issuerCertificate;
      }
      console.log(`           звеньев в цепочке: ${zvenya.length}`);
      zvenya.forEach((z, i) =>
        console.log(`           ${i + 1}. ${z.subject?.CN ?? '?'}  ←  ${z.issuer?.CN ?? '?'}`),
      );
      if (zvenya.length >= 2) ok('промежуточное звено сервер отдаёт сам');
      else no('сервер отдаёт только конечный сертификат — часть клиентов не соберёт цепочку');

      const list = zvenya[0];
      const imena = (list.subjectaltname ?? '')
        .split(',')
        .map((x) => x.trim().replace(/^DNS:/, ''))
        .filter(Boolean);
      console.log(`           имена в сертификате: ${imena.join(', ') || 'нет'}`);
      const nado = [IMYA.replace(/^www\./, ''), `www.${IMYA.replace(/^www\./, '')}`];
      for (const n of nado) {
        imena.includes(n) ? ok(`имя ${n} покрыто`) : no(`имени ${n} в сертификате нет`);
      }

      const do_ = new Date(list.valid_to);
      const dney = Math.floor((do_ - Date.now()) / 86400000);
      const stroka = `годен до ${do_.toISOString().slice(0, 10)}, осталось ${dney} дней`;
      // Let's Encrypt живёт 90 дней и продлевается за 30 до конца.
      // Меньше недели — значит автопродление не работает.
      if (dney < 7) no(stroka + ' — автопродление не сработало');
      else if (dney < 21) vn(stroka + ' — продление должно было уже пройти');
      else ok(stroka);

      s.end();
      resolve();
    },
  );
  s.on('error', (e) => {
    no(`рукопожатие не прошло: ${e.message}`);
    resolve();
  });
});

// ─── 2. Переходы: каждый за один шаг ────────────────────────────────
shag('переходы');
async function tsepochka(ot) {
  const shagi = [];
  let tek = ot;
  for (let i = 0; i < 6; i++) {
    const r = await zapros(tek).catch((e) => ({ kod: 0, oshibka: e.message, zagolovki: {} }));
    shagi.push({ adres: tek, kod: r.kod, kuda: r.zagolovki.location, oshibka: r.oshibka });
    if (r.kod >= 300 && r.kod < 400 && r.zagolovki.location) {
      tek = new URL(r.zagolovki.location, tek).toString();
      continue;
    }
    break;
  }
  return shagi;
}
for (const ot of PO_HTTPS
  ? [
      `http://${IMYA.replace(/^www\./, '')}/`,
      `http://www.${IMYA.replace(/^www\./, '')}/`,
      `https://www.${IMYA.replace(/^www\./, '')}/`,
    ]
  : []) {
  const c = await tsepochka(ot);
  const put = c.map((x) => `${x.kod}`).join(' → ');
  const konec = c[c.length - 1];
  const perehodov = c.length - 1;
  const stroka = `${ot}  ${put}  → ${konec.adres}`;
  if (konec.oshibka) no(`${ot}: ${konec.oshibka}`);
  else if (konec.kod !== 200) no(`${stroka} — конец не 200`);
  else if (!konec.adres.startsWith(KANON)) no(`${stroka} — приехали не на ${KANON}`);
  else if (perehodov > 1) no(`${stroka} — ${perehodov} шага, а должен быть один`);
  else ok(`${stroka} — один шаг`);
}
{
  const c = await tsepochka(`${KANON}/`);
  c.length === 1 && c[0].kod === 200
    ? ok(`${KANON}/  200  — без переходов`)
    : no(`${KANON}/ отвечает ${c.map((x) => x.kod).join(' → ')}, ожидали сразу 200`);
}

// ─── 3. Главная: содержимое, а не код ───────────────────────────────
shag('главная страница');
const glav = await zapros(`${KANON}/`).catch((e) => ({ kod: 0, oshibka: e.message, zagolovki: {} }));
let telo = '';
if (glav.kod !== 200) {
  no(`главная отвечает ${glav.kod}${glav.oshibka ? ': ' + glav.oshibka : ''}`);
} else {
  telo = tekst(glav);
  ok(`код 200, ${(glav.szhato / 1024).toFixed(1)} КБ по проводу, ${(telo.length / 1024).toFixed(1)} КБ распакованных`);
  // Это ДОЛЖНА быть наша лавка, а не заглушка и не чужая страница.
  const nado = ['Нейролавка', 'Claude Pro', 'ChatGPT Plus', 'Seedance 2.5'];
  const net = nado.filter((s) => !telo.includes(s));
  net.length ? no(`на главной нет: ${net.join(', ')} — это не наш сайт`) : ok(`содержимое наше: ${nado.join(', ')}`);
  /<html[^>]*lang="ru"/.test(telo) ? ok('страница объявлена русской') : vn('нет lang="ru" у html');
  /data-theme="light"/.test(telo)
    ? ok('тема по умолчанию светлая прямо в разметке')
    : no('в разметке нет data-theme="light" — сайт может открыться тёмным');
}

// ─── 4. Внутренние адреса и своя страница 404 ───────────────────────
shag('внутренние адреса и 404');
for (const put of ['/icon.svg', '/_next/static/']) {
  const r = await zapros(`${KANON}${put}`).catch((e) => ({ kod: 0, oshibka: e.message, zagolovki: {} }));
  if (put.endsWith('/')) {
    // Листинг папки отдавать нельзя: это выдача чужого содержимого.
    r.kod === 403 || r.kod === 404
      ? ok(`${put} → ${r.kod}, листинга папок нет`)
      : no(`${put} → ${r.kod} — похоже на открытый листинг папки`);
  } else {
    r.kod === 200 ? ok(`${put} → 200`) : no(`${put} → ${r.kod}`);
  }
}
{
  const r = await zapros(`${KANON}/takoy-stranicy-net-${Date.now()}/`).catch((e) => ({
    kod: 0,
    oshibka: e.message,
    zagolovki: {},
  }));
  const t = r.kod ? tekst(r) : '';
  if (r.kod !== 404) no(`несуществующий адрес отвечает ${r.kod}, а должен 404`);
  else if (/nginx/i.test(t) && !t.includes('Нейролавка')) no('404 — служебная страница nginx, а не наша');
  else if (!t.includes('Такой страницы в лавке нет')) no('404 отдаётся, но это не наша страница');
  else if (/This page could not be found/.test(t)) no('404 — готовая английская страница Next');
  else ok('404 — наша страница, по-русски, с кодом 404');
}

// ─── 5. Сжатие и кеш ────────────────────────────────────────────────
shag('сжатие и заголовки кеша');
{
  const e = glav.zagolovki['content-encoding'];
  if (!e) no('главная отдаётся без сжатия — это минус десятки баллов производительности');
  else ok(`главная сжата: ${e}`);
  const cc = glav.zagolovki['cache-control'] ?? '';
  /no-cache|no-store|max-age=0/.test(cc)
    ? ok(`html не кешируется: ${cc}`)
    : vn(`html с заголовком «${cc || 'ничего'}» — после выкладки человек может увидеть старую страницу`);
}
// Настоящий адрес куска берём из главной: имена содержат хеш и меняются.
const kusok = (telo.match(/\/_next\/static\/[^"']+\.(?:js|css)/) ?? [])[0];
if (!kusok) {
  vn('в главной не нашлось ссылки на _next/static — кеш статики не проверен');
} else {
  const r = await zapros(`${KANON}${kusok}`).catch((e) => ({ kod: 0, oshibka: e.message, zagolovki: {} }));
  if (r.kod !== 200) {
    no(`${kusok} → ${r.kod}: статики нет на месте`);
  } else {
    ok(`${kusok} → 200`);
    const cc = r.zagolovki['cache-control'] ?? '';
    /immutable/.test(cc) && /max-age=\d{7,}/.test(cc)
      ? ok(`кеш статики навсегда: ${cc}`)
      : vn(`кеш статики «${cc || 'ничего'}» — имя файла содержит хеш, можно кешировать навсегда`);
    r.zagolovki['content-encoding']
      ? ok(`статика сжата: ${r.zagolovki['content-encoding']}`)
      : vn('статика отдаётся без сжатия');
  }
}
{
  // Гарнитуры: их тянет загрузчик шрифтов, ему нужен CORS.
  const shrift = (telo.match(/\/_next\/static\/media\/[^"']+\.woff2/) ?? [])[0];
  if (!shrift) vn('в главной не нашлось ссылки на woff2');
  else {
    const r = await zapros(`${KANON}${shrift}`).catch(() => ({ kod: 0, zagolovki: {} }));
    r.kod === 200 ? ok(`гарнитура на месте: ${shrift.split('/').pop()}`) : no(`гарнитура ${shrift} → ${r.kod}`);
  }
}

// ─── 5б. Заголовки, которые легко потерять ──────────────────────────
// Уровень «внимание», а не «плохо»: без них сайт работает, человек
// ничего не заметит. Но потерять их проще простого — add_header внутри
// location заменяет весь набор сервера целиком, и на этом уже
// обожглись: html-страницы оставались вообще без них.
shag('заголовки ответа');
if (glav.kod === 200) {
  for (const [imya, ozhid] of [
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', null],
    ['x-frame-options', null],
  ]) {
    const v = glav.zagolovki[imya];
    if (!v) vn(`на главной нет ${imya}`);
    else if (ozhid && v !== ozhid) vn(`${imya}: «${v}», ожидали «${ozhid}»`);
    else ok(`${imya}: ${v}`);
  }
  const hsts = glav.zagolovki['strict-transport-security'];
  if (PO_HTTPS) {
    hsts ? ok(`strict-transport-security: ${hsts}`) : vn('нет strict-transport-security');
  }
  const server = glav.zagolovki.server ?? '';
  /\d/.test(server) ? vn(`заголовок Server выдаёт версию: «${server}»`) : ok(`Server: ${server || 'скрыт'}`);
}

// ─── 6. Время до первого байта ──────────────────────────────────────
shag('время до первого байта');
{
  const zamery = [];
  for (let i = 0; i < 5; i++) {
    const r = await zapros(`${KANON}/`).catch(() => null);
    if (r) zamery.push(r.ttfb);
  }
  if (!zamery.length) {
    no('замерить не удалось — главная не отвечает');
  } else {
    zamery.sort((a, b) => a - b);
    const med = zamery[Math.floor(zamery.length / 2)];
    const stroka = `медиана ${med.toFixed(0)} мс по ${zamery.length} запросам (${zamery
      .map((x) => x.toFixed(0))
      .join(', ')})`;
    // Пороги нарочно щедрые: замер идёт из чужой сети, и полсекунды
    // на канале до Москвы — это канал, а не сервер.
    if (med > 2000) no(stroka + ' — дольше двух секунд, что-то не так');
    else if (med > 700) vn(stroka + ' — заметно медленно');
    else ok(stroka);
  }
}

// ─── Итог ───────────────────────────────────────────────────────────
console.log(
  `\n${plohih ? `Плохо: ${plohih}. ` : 'Боевой адрес в порядке. '}` +
    `${vnimanie ? `Замечаний: ${vnimanie}.` : 'Замечаний нет.'}`,
);
process.exit(plohih ? 1 : 0);
