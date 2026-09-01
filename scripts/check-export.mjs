/**
 * Проверка статической выдачи перед публикацией.
 *
 * Ловит поломки, которые видны только в браузере: ссылки на ассеты
 * мимо basePath, недостающие файлы, пропавшие гарнитуры.
 *
 * Второй аргумент — basePath. Сайт переехал в корень своего домена,
 * поэтому он пустой; аргумент оставлен на случай, если выдачу опять
 * придётся класть в подпапку.
 *
 * Запуск: node scripts/check-export.mjs out
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? 'out';
const basePath = (process.argv[3] ?? '').replace(/\/$/, '');
const problems = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(root);
const htmls = files.filter((f) => f.endsWith('.html'));

// .nojekyll нужен только на GitHub Pages: без него Pages выбрасывает
// папку _next. На своём nginx он ничего не значит, поэтому требуется
// он ровно тогда, когда выдача собрана под подпапку Pages.
if (basePath && !fs.existsSync(path.join(root, '.nojekyll'))) {
  problems.push('нет файла .nojekyll в корне выдачи — Pages выбросит папку _next');
}
if (!htmls.length) {
  problems.push('в выдаче нет ни одного html');
}

for (const html of htmls) {
  const body = fs.readFileSync(html, 'utf8');
  const rel = path.relative(root, html);

  // Все локальные ссылки на ассеты и страницы
  const refs = [...body.matchAll(/(?:href|src)="(\/[^"'#?]*)"/g)].map((m) => m[1]);

  for (const ref of new Set(refs)) {
    if (basePath && !ref.startsWith(basePath + '/') && ref !== basePath) {
      problems.push(`${rel}: ссылка «${ref}» без basePath «${basePath}»`);
      continue;
    }
    const local = basePath ? ref.slice(basePath.length) : ref;
    const target = path.join(root, local);
    const ok =
      fs.existsSync(target) ||
      fs.existsSync(target + '.html') ||
      fs.existsSync(path.join(target, 'index.html'));
    if (!ok) problems.push(`${rel}: файла для «${ref}» нет в выдаче`);
  }
}

// Шрифты должны быть на месте и предзагружаться
const media = path.join(root, '_next', 'static', 'media');
const fonts = fs.existsSync(media) ? fs.readdirSync(media).filter((f) => f.endsWith('.woff2')) : [];
if (!fonts.length) problems.push('в выдаче нет ни одного woff2');

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const font of ['golos_text', 'akt']) {
  if (!index.includes(font)) problems.push(`главная не ссылается на гарнитуру ${font}`);
  if (!new RegExp(`rel="preload"[^>]*${font}`).test(index)) {
    problems.push(`гарнитура ${font} не предзагружается на главной`);
  }
}

// Своя страница 404. Готовая страница Next набрана по-английски,
// а nginx обязан отдавать именно её (error_page 404 /404.html),
// поэтому проверяем и наличие файла, и что это НАША страница.
const notFound = path.join(root, '404.html');
if (!fs.existsSync(notFound)) {
  problems.push('в выдаче нет 404.html — nginx нечего отдать на несуществующий адрес');
} else {
  const body = fs.readFileSync(notFound, 'utf8');
  if (!body.includes('Такой страницы в лавке нет')) {
    problems.push('404.html — не наша страница: нет собственного текста');
  }
  if (/This page could not be found/.test(body)) {
    problems.push('404.html — готовая английская страница Next, а не наша');
  }
}

if (problems.length) {
  console.error('Проверка выдачи не пройдена:');
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}

console.log(
  `Выдача в порядке: ${htmls.length} страниц, ${fonts.length} гарнитур, ` +
    `своя страница 404 на месте, basePath «${basePath || 'пустой, сайт в корне домена'}».`,
);
