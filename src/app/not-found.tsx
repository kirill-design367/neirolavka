import Link from 'next/link';
import './styles/notfound.css';

/**
 * Своя страница 404.
 *
 * Готовая страница Next набрана по-английски («This page could not be
 * found»), а по правилам проекта латиница допустима только в именах
 * брендов. Плюс nginx обязан отдавать страницу САЙТА, а не свою
 * служебную — за это отвечает error_page в deploy/nginx.
 *
 * Ни одной новой ступени кегля и ни одного цвета мимо токенов:
 * всё существующее.
 */
export default function NotFound() {
  return (
    <main className="nf">
      <div className="page nf__in">
        <p className="nf__code">404</p>
        <h1 className="nf__title">Такой страницы в лавке нет</h1>
        <p className="nf__text">
          Возможно, ссылка устарела или в адресе опечатка. На главной — все продукты и тарифы.
        </p>
        <Link className="nf__back" href="/">
          На главную
        </Link>
      </div>
    </main>
  );
}
