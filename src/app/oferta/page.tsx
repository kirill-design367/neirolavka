import type { Metadata } from 'next';
import Link from 'next/link';
import { NAZVANIE, PODZAGOLOVOK, RAZDELY } from '@/lib/oferta';
import type { Element } from '@/lib/oferta';
import { getProdavec } from '@/lib/prodavec';
import { ThemeToggle } from '@/components/ThemeToggle';
import '../styles/legal.css';

export const metadata: Metadata = {
  title: 'Публичная оферта — Нейролавка',
  description:
    'Условия договора об оказании услуг: предмет, права и обязанности сторон, цена, ответственность, реквизиты.',
};

/**
 * Страница публичной оферты.
 *
 * ТЕКСТ СЮДА НЕ ВПИСАН — он приходит из `src/lib/oferta.ts`, который
 * машина собирает из docx владельца. Здесь только разметка: что чем
 * показать. Границу держать строго, иначе однажды кто-нибудь поправит
 * формулировку прямо в JSX, и страница разойдётся с подписанным
 * документом.
 *
 * ДОКУМЕНТ ЛЕЖИТ НА БУМАГЕ, и это не украшение. Пузыри живут под всем
 * содержимым сайта, а запретные прямоугольники стерегут только текст
 * на голом фоне — список селекторов в `bubbles-gl.ts`, и дописывать
 * туда десяток правовых селекторов значило бы держать два списка
 * в согласии вручную. Непрозрачная подложка закрывает пузырь сама,
 * ровно как карточки и чек на главной: «под карточками и чеком
 * запрещать нечего». Плюс лист бумаги — это и есть то, чем документ
 * является.
 *
 * Lenis тут не поднимается намеренно. Страница длинная, и ходят по ней
 * якорями из оглавления; нативная прокрутка попадает по якорю без
 * согласования со сглаживанием, а сглаживание ради страницы, где
 * читают, а не листают, — это чистый расход кадров.
 */

/** Один кусок документа в разметке. */
function Kusok({ el }: { el: Element }) {
  switch (el.vid) {
    case 'punkt':
      return (
        <li className="doc__punkt" id={`p${el.nomer}`}>
          {/* Номер — настоящий текст, а не маркер списка: по нему
              ищут глазами («смотрите пункт 4.1») и по нему же
              попадают ссылкой. Маркер списка ни тем, ни другим
              быть не может. */}
          <span className="doc__nomer tnum">{el.nomer}.</span>
          <span className="doc__punkt-text">{el.text}</span>
        </li>
      );
    case 'abzac':
      return <p className="doc__abzac">{el.text}</p>;
    case 'podzagolovok':
      return (
        <h3 className="doc__pod" id={el.yakor}>
          {/* Двоеточие в данных есть — оно из документа; в заголовке
              оно лишнее, поэтому снимается при показе, а не в файле. */}
          {el.text.replace(/:$/, '')}
        </h3>
      );
    case 'termin':
      return (
        <div className="doc__termin">
          <dt>{el.termin}</dt>
          <dd>{el.text}</dd>
        </div>
      );
    case 'rekvizit':
      return (
        <div className="doc__rekvizit">
          <dt>{el.imya}</dt>
          <dd>{znachenie(el.imya, el.znachenie)}</dd>
        </div>
      );
    case 'spisok':
      return (
        <ul className="doc__spisok">
          {el.punkty.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      );
  }
}

/**
 * Телефон и почта в реквизитах — рабочие ссылки.
 *
 * Показанный текст при этом НЕ МЕНЯЕТСЯ ни на знак: меняется только
 * то, что по нему можно нажать. Номер для `tel:` чистится до плюса
 * и цифр — тем же правилом, что в подвале, и по той же причине:
 * часть набиралок спотыкается на пробелах и дефисах.
 *
 * ЭТО НЕ ТОТ ТЕЛЕФОН, ЧТО В ПОДВАЛЕ, и сводить их нельзя — решение
 * владельца, см. `prodavec.ts`.
 */
function znachenie(imya: string, v: string) {
  if (/телефон/i.test(imya)) {
    return <a className="doc__ssylka tnum" href={`tel:+${v.replace(/\D/g, '')}`}>{v}</a>;
  }
  if (/mail|почт/i.test(imya)) {
    return <a className="doc__ssylka" href={`mailto:${v}`}>{v}</a>;
  }
  return <span className="tnum">{v}</span>;
}

/** Раздел: пункты идут списком, всё остальное — обычными блоками. */
function Razdel({ r }: { r: (typeof RAZDELY)[number] }) {
  /* Идущие подряд пункты собираются в ОДИН <ol>: иначе у каждого
     был бы свой список из одного элемента, и скринридер объявлял бы
     «список из одного пункта» тридцать девять раз подряд. */
  const gruppy: Element[][] = [];
  for (const el of r.elementy) {
    const posledniy = gruppy[gruppy.length - 1];
    const vmeste = el.vid === 'punkt' && posledniy?.[0]?.vid === 'punkt';
    if (vmeste) posledniy.push(el);
    else gruppy.push([el]);
  }

  return (
    <section className="doc__razdel" id={r.yakor}>
      <h2 className="doc__zagolovok">
        <span className="doc__nomer-razdela tnum">{r.nomer}.</span>
        {r.zagolovok}
      </h2>
      {gruppy.map((g, i) => {
        if (g[0]?.vid === 'punkt') {
          return (
            <ol className="doc__punkty" key={i}>
              {g.map((el) => (
                <Kusok el={el} key={(el as { nomer: string }).nomer} />
              ))}
            </ol>
          );
        }
        if (g[0]?.vid === 'termin' || g[0]?.vid === 'rekvizit') {
          return (
            <dl className="doc__opredeleniya" key={i}>
              {g.map((el, j) => (
                <Kusok el={el} key={j} />
              ))}
            </dl>
          );
        }
        return g.map((el, j) => <Kusok el={el} key={`${i}-${j}`} />);
      })}
    </section>
  );
}

export default function Oferta() {
  const p = getProdavec();
  /* Оглавление — разделы плюс «Термины и определения»: это единственный
     подзаголовок внутри раздела, и ищут его отдельно, наравне
     с разделами. Собирается из тех же данных, что и сам документ,
     поэтому разойтись с ним не может. */
  const terminy = RAZDELY[0]?.elementy.find((e) => e.vid === 'podzagolovok');

  return (
    <>
      <header className="legal__shapka">
        <div className="page legal__shapka-in">
          <Link className="legal__nazad" href="/">
            {/* Стрелка — не текст, её читать незачем. */}
            <span aria-hidden="true">←</span> Нейролавка
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="legal">
        <div className="page">
          <article className="doc">
            <h1 className="doc__title">{NAZVANIE}</h1>
            <p className="doc__podtitle">{PODZAGOLOVOK}</p>

            <nav className="doc__soder" aria-label="Содержание">
              <h2 className="doc__soder-title">Содержание</h2>
              <ol className="doc__soder-list">
                {RAZDELY.map((r) => (
                  <li key={r.yakor}>
                    <a href={`#${r.yakor}`}>
                      <span className="doc__soder-nomer tnum">{r.nomer}.</span>
                      {r.zagolovok}
                    </a>
                    {r.yakor === 'r1' && terminy?.vid === 'podzagolovok' && (
                      <ul className="doc__soder-vlozh">
                        <li>
                          <a href={`#${terminy.yakor}`}>{terminy.text.replace(/:$/, '')}</a>
                        </li>
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </nav>

            {RAZDELY.map((r) => (
              <Razdel r={r} key={r.yakor} />
            ))}
          </article>

          <p className="legal__podpis">
            Продавец — {p.imya}, ИНН <span className="tnum">{p.inn}</span>. Заказ и выдача
            доступа — в Telegram-боте.
          </p>
        </div>
      </main>
    </>
  );
}
