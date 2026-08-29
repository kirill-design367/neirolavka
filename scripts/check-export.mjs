/**
 * Проверка статической выдачи перед публикацией.
 *
 * Ловит ровно те поломки, которые на GitHub Pages проявляются только
 * в браузере: ссылки на ассеты без basePath, недостающие файлы,
 * пропавший .nojekyll (без него Pages выбрасывает папку _next).
 *
 * Запуск: node scripts/check-export.mjs out /neirolavka
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

if (!fs.existsSync(path.join(root, '.nojekyll'))) {
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

// Onest нужен только на /fonts и не должен тянуться на главную
if (index.includes('onest')) problems.push('Onest подключён на главной, хотя нужен только на /fonts');

if (problems.length) {
  console.error('Проверка выдачи не пройдена:');
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}

console.log(`Выдача в порядке: ${htmls.length} страниц, ${fonts.length} гарнитур, basePath «${basePath || 'пустой'}».`);
