/**
 * Яндекс Метрика — счётчик посещаемости.
 *
 * НОМЕР СЧЁТЧИКА ЖИВЁТ ЗДЕСЬ И ТОЛЬКО ЗДЕСЬ. Из него собираются все три
 * адреса — загружаемый скрипт, вызов `init` и пиксель для тех, у кого
 * выключен JavaScript. Тот же закон, что у каталога и у меток каналов:
 * три написания одного номера разъехались бы при первой правке, причём
 * молча — в Метрике просто появился бы второй счётчик с нулём.
 *
 * Отсюда же номер читает `scripts/check-metrika.mjs`: вписанный
 * в проверку строкой, он устарел бы вместе со счётчиком, а проверка
 * осталась бы зелёной — ровно тот случай, из-за которого имена товаров
 * в `check-live` тоже читаются из каталога, а не из самой проверки.
 *
 * Код скрипта — дословно тот, что прислал Яндекс; своего в нём нет
 * ничего, кроме подстановки номера. Переписывать его «покрасивее»
 * нельзя: он должен совпадать с тем, что Метрика ждёт увидеть.
 */

export const METRIKA_ID = 112737572;

/** Узел Метрики. Отдельной строкой — его знают и проверки. */
export const METRIKA_HOST = 'mc.yandex.ru';

/** Скрипт счётчика: грузится асинхронно, разбор страницы не держит. */
export const METRIKA_TAG = `https://${METRIKA_HOST}/metrika/tag.js?id=${METRIKA_ID}`;

/** Пиксель для тех, у кого выключен JavaScript. */
export const METRIKA_PIXEL = `https://${METRIKA_HOST}/watch/${METRIKA_ID}`;

/**
 * Встраивается синхронным `<script>` ПЕРВЫМ в `<head>`.
 *
 * Синхронный он не по недосмотру: просмотр должен засчитаться даже
 * у человека, закрывшего вкладку через полсекунды, а для этого очередь
 * `ym.a` обязана существовать и вызов `init` обязан в неё попасть
 * до того, как страница начнёт грузить всё остальное. Сам разбор
 * при этом не задерживается: тело скрипта только заводит функцию
 * и вставляет в head тег с `async` — настоящая загрузка идёт мимо
 * разбора страницы.
 *
 * Скрипт темы стоит СРАЗУ ЗА ним и по-прежнему выполняется до первой
 * отрисовки: вспышки чужой темы не бывает, стережёт `check-theme-motion`.
 */
export const metrikaInitScript = `(function(m,e,t,r,i,k,a){
m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
})(window, document,'script',${JSON.stringify(METRIKA_TAG)}, 'ym');

ym(${METRIKA_ID}, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});`;

/**
 * Пиксель для страниц без JavaScript.
 *
 * Стоит в `<body>`, а не в `<head>`: по правилам HTML внутри `<noscript>`
 * в голове документа разрешены только `link`, `style` и `meta`, а `img`
 * там — недопустимая разметка, и браузер всё равно вынес бы её в тело.
 *
 * Разметка отдаётся через `dangerouslySetInnerHTML`: содержимое
 * `<noscript>` для браузера — текст, и React при гидратации сверял бы
 * его с деревом, которого там нет.
 */
export const metrikaNoscript = `<div><img src="${METRIKA_PIXEL}" style="position:absolute; left:-9999px;" alt="" /></div>`;
