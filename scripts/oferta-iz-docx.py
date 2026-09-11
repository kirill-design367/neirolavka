#!/usr/bin/env python3
"""
Сборка `src/lib/oferta.ts` из docx, который прислал владелец.

ТЕКСТ ОФЕРТЫ НЕ НАБИРАЕТСЯ РУКАМИ, и это не лень. Оферта — договор:
пропущенное «не» или съеденная частица меняют обязательство, а вычитка
одиннадцати тысяч знаков глазами такую правку не ловит. Перенос делает
машина, и тогда «дословно» — это свойство способа, а не обещание.

Побочная выгода важнее исходной: когда владелец пришлёт новую редакцию,
страница пересобирается одной командой, а не вычитывается заново.

    python3 scripts/oferta-iz-docx.py

НУМЕРАЦИЯ БЕРЁТСЯ ИЗ WORD, А НЕ ПРОСТАВЛЯЕТСЯ ЗАНОВО. В самом тексте
есть ссылка «согласно пункту 2.1. Договора» — значит номера несут смысл,
и сдвиг на единицу превратил бы ссылку в неверную. Word хранит их
не текстом, а разметкой списка (`w:numPr`): уровень 0 — раздел,
уровень 1 — пункт, уровень 2 — подпункт; счётчики считаются здесь так
же, как их считает Word.

ДВА ПУСТЫХ МЕСТА ЗАПОЛНЯЮТСЯ АДРЕСОМ САЙТА — это единственная правка
при переносе, и её назвал владелец. Опознаются они НЕ по номеру абзаца
(он поедет от любой правки исходника) и НЕ по двоеточию в конце:
двоеточием кончаются пять абзацев, и у трёх из них дальше идёт список
или подпункты. Признак — двоеточие И ПРОБЕЛ ПОСЛЕ НЕГО: владелец
оставил там настоящий зазор (в файле это `:\xa0` — двоеточие,
пробел и неразрывный пробел), а в остальных трёх после двоеточия
нет ничего. Таких абзацев ровно два; нашлось другое число — скрипт
падает, а не подставляет наугад.

Первая редакция скрипта смотрела на одно двоеточие и нашла пять мест.
Проверка на число и поймала — ради этого она и написана ДО того,
как стало известно, что признак другой.
"""

import html
import io
import re
import sys
import zipfile
from pathlib import Path

KOREN = Path(__file__).resolve().parent.parent
ISHODNIK = KOREN / 'docs' / 'Оферта Лев.docx'
ITOG = KOREN / 'src' / 'lib' / 'oferta.ts'

ADRES_SAYTA = 'neirolavka.ru'

# Сколько пустых мест под адрес сайта ждём. Ровно два — см. шапку.
ZHDEM_PUSTYH = 2


def abzacy(put: Path):
    """Абзацы документа вместе с их местом в нумерованном списке."""
    with zipfile.ZipFile(put) as z:
        xml = z.read('word/document.xml').decode('utf-8')
    for kusok in re.findall(r'<w:p\b[^>]*>(.*?)</w:p>', xml, re.S):
        kusok_s_tabami = kusok.replace('<w:tab/>', '\t').replace('<w:br/>', '\n')
        text = html.unescape(''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', kusok_s_tabami, re.S)))
        nomer = re.search(r'<w:numPr>.*?<w:ilvl w:val="(\d+)".*?<w:numId w:val="(\d+)"', kusok, re.S)
        yield {
            'text': text.strip(),
            # Сырой текст нужен ровно за одним: по хвостовому пробелу
            # после двоеточия узнаются пустые места под адрес сайта.
            'syroy': text,
            'uroven': int(nomer.group(1)) if nomer else None,
            'spisok': nomer.group(2) if nomer else None,
        }


def razobrat():
    """Документ → разделы с элементами."""
    razdely = []
    razdel = None
    sec = punkt = podpunkt = 0
    nabor_spiska = None      # копим пункты маркированного списка
    pustyh = 0               # сколько мест заполнили адресом сайта

    def dobavit(el):
        if razdel is None:
            raise SystemExit('ПЛОХО: элемент до первого раздела — разметка документа не та, что ждали')
        razdel['elementy'].append(el)

    def zakryt_spisok():
        nonlocal nabor_spiska
        if nabor_spiska:
            dobavit({'vid': 'spisok', 'punkty': nabor_spiska})
            nabor_spiska = None

    vse = list(abzacy(ISHODNIK))
    # Первые два абзаца — название документа, они в разделы не входят.
    zagolovok_dokumenta = [a['text'] for a in vse[:2] if a['text']]

    for a in vse[2:]:
        text, syroy, uroven, spisok = a['text'], a['syroy'], a['uroven'], a['spisok']
        if not text:
            continue

        if spisok == '1' and uroven == 0:
            zakryt_spisok()
            sec += 1
            punkt = podpunkt = 0
            razdel = {'nomer': str(sec), 'zagolovok': text, 'yakor': f'r{sec}', 'elementy': []}
            razdely.append(razdel)
            continue

        if spisok == '1' and uroven == 1:
            zakryt_spisok()
            punkt += 1
            podpunkt = 0
            # Подзаголовок внутри раздела («Права и обязанности Исполнителя:»)
            # отличается от пункта тем, что за ним идут подпункты, —
            # но по одному абзацу этого не видно, поэтому и то и другое
            # остаётся пунктом со своим номером. Так же, как в Word.
            text, pustyh = podstavit(text, syroy, pustyh)
            dobavit({'vid': 'punkt', 'nomer': f'{sec}.{punkt}', 'text': text})
            continue

        if spisok == '1' and uroven == 2:
            zakryt_spisok()
            podpunkt += 1
            text, pustyh = podstavit(text, syroy, pustyh)
            dobavit({'vid': 'punkt', 'nomer': f'{sec}.{punkt}.{podpunkt}', 'text': text})
            continue

        if spisok is not None:
            # Маркированный список (перечень конклюдентных действий).
            nabor_spiska = (nabor_spiska or []) + [text]
            continue

        zakryt_spisok()

        # Ненумерованные абзацы. До первого раздела их нет, внутри —
        # это либо вводные абзацы, либо термины, либо реквизиты.
        if razdel is None:
            raise SystemExit('ПЛОХО: абзац до первого раздела')

        if text.endswith(':') and '–' not in text and len(text) < 60:
            # «Термины и определения:» — подзаголовок внутри раздела.
            # Двоеточие остаётся В ДАННЫХ: файл обязан совпадать
            # с документом знак в знак, а убирать его при показе —
            # дело разметки, не хранения.
            dobavit({'vid': 'podzagolovok', 'text': text, 'yakor': 'terminy'})
            continue

        termin = re.match(r'^(.{3,70}?)(\s+[–—]\s+)(.+)$', text, re.S)
        if termin and razdel['nomer'] == '1':
            t, pustyh = podstavit(termin.group(3), syroy, pustyh)
            # Разделитель хранится вместе с термином: у «Договор – текст»
            # короткое тире, у «Конклюдентные действия — это» длинное.
            # Подставить одно за оба — переписать документ.
            dobavit({'vid': 'termin', 'termin': termin.group(1).strip(),
                     'tire': termin.group(2), 'text': t})
            continue

        rekvizit = re.match(r'^([^:]{3,40}):\s*(.+)$', text)
        if rekvizit and razdel['zagolovok'].startswith('Реквизиты'):
            dobavit({'vid': 'rekvizit', 'imya': rekvizit.group(1).strip(),
                     'znachenie': rekvizit.group(2).strip()})
            continue

        text, pustyh = podstavit(text, syroy, pustyh)
        dobavit({'vid': 'abzac', 'text': text})

    zakryt_spisok()

    if pustyh != ZHDEM_PUSTYH:
        raise SystemExit(
            f'ПЛОХО: мест под адрес сайта нашлось {pustyh}, а ждали {ZHDEM_PUSTYH}.\n'
            '  Это либо новая редакция оферты, либо разметка поехала.\n'
            '  Пустое место — абзац, который кончается двоеточием и больше ничем;\n'
            '  их два: определение «Сайт Исполнителя…» и пункт 4.1 про стоимость.\n'
            '  Разберитесь глазами и поправьте скрипт — подставлять наугад нельзя.'
        )
    return zagolovok_dokumenta, razdely


def podstavit(text: str, syroy: str, pustyh: int):
    """Двоеточие И пробел после него — здесь владелец оставил зазор."""
    hvost = syroy[len(syroy.rstrip()):]
    if syroy.rstrip().endswith(':') and hvost:
        return f'{text.rstrip()} {ADRES_SAYTA}', pustyh + 1
    return text, pustyh


def ts_stroka(s: str) -> str:
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n') + "'"


def sobrat_ts(zagolovok, razdely) -> str:
    kuski = []
    for r in razdely:
        el = []
        for e in r['elementy']:
            if e['vid'] == 'punkt':
                el.append(f"    {{ vid: 'punkt', nomer: {ts_stroka(e['nomer'])}, text: {ts_stroka(e['text'])} }},")
            elif e['vid'] == 'abzac':
                el.append(f"    {{ vid: 'abzac', text: {ts_stroka(e['text'])} }},")
            elif e['vid'] == 'podzagolovok':
                el.append(f"    {{ vid: 'podzagolovok', text: {ts_stroka(e['text'])}, yakor: {ts_stroka(e['yakor'])} }},")
            elif e['vid'] == 'termin':
                el.append(f"    {{ vid: 'termin', termin: {ts_stroka(e['termin'])}, "
                          f"tire: {ts_stroka(e['tire'])}, text: {ts_stroka(e['text'])} }},")
            elif e['vid'] == 'rekvizit':
                el.append(f"    {{ vid: 'rekvizit', imya: {ts_stroka(e['imya'])}, znachenie: {ts_stroka(e['znachenie'])} }},")
            elif e['vid'] == 'spisok':
                punkty = ', '.join(ts_stroka(p) for p in e['punkty'])
                el.append(f"    {{ vid: 'spisok', punkty: [{punkty}] }},")
        kuski.append(
            f"  {{\n    nomer: {ts_stroka(r['nomer'])},\n    zagolovok: {ts_stroka(r['zagolovok'])},\n"
            f"    yakor: {ts_stroka(r['yakor'])},\n    elementy: [\n"
            + '\n'.join('  ' + x for x in el)
            + '\n    ],\n  },'
        )

    shapka = f'''/**
 * Публичная оферта: текст документа как данные.
 *
 * ФАЙЛ СОБРАН МАШИНОЙ ИЗ `docs/Оферта Лев.docx` — РУКАМИ НЕ ПРАВИТЬ.
 * Правка здесь проживёт до первой пересборки, а главное — разойдётся
 * с документом, который подписан. Меняется оферта — меняется docx,
 * и дальше:
 *
 *     python3 scripts/oferta-iz-docx.py
 *
 * Единственное отличие страницы от исходного файла — адрес сайта
 * в двух местах, где в документе стояло двоеточие и пустота
 * (определение «Сайт Исполнителя…» и пункт 4.1 про стоимость услуг).
 * Это правка владельца, а не наша вольность.
 *
 * Номера пунктов взяты из разметки списка Word, а не проставлены
 * заново: текст ссылается сам на себя («согласно пункту 2.1»),
 * и сдвиг на единицу сделал бы ссылку неверной.
 */

/** Один кусок документа. */
export type Element =
  /** Нумерованный пункт: «2.1», «3.1.4». */
  | {{ vid: 'punkt'; nomer: string; text: string }}
  /** Абзац без номера. */
  | {{ vid: 'abzac'; text: string }}
  /** Подзаголовок внутри раздела — у него свой якорь. */
  | {{ vid: 'podzagolovok'; text: string; yakor: string }}
  /**
   * Определение термина: слово, разделитель и объяснение.
   * `tire` хранится потому, что в документе он разный — у одних
   * определений короткое тире, у других длинное.
   */
  | {{ vid: 'termin'; termin: string; tire: string; text: string }}
  /** Строка реквизитов: подпись и значение. */
  | {{ vid: 'rekvizit'; imya: string; znachenie: string }}
  /** Маркированный перечень. */
  | {{ vid: 'spisok'; punkty: string[] }};

export type Razdel = {{
  nomer: string;
  zagolovok: string;
  /** Якорь для оглавления: `r4` — четвёртый раздел. */
  yakor: string;
  elementy: Element[];
}};

/** Название документа: две строки шапки. */
export const NAZVANIE = {ts_stroka(zagolovok[0])};
export const PODZAGOLOVOK = {ts_stroka(zagolovok[1].strip())};

export const RAZDELY: Razdel[] = [
{chr(10).join(kuski)}
];
'''
    return shapka


def main():
    if not ISHODNIK.exists():
        raise SystemExit(f'ПЛОХО: нет файла {ISHODNIK}')
    zagolovok, razdely = razobrat()
    if len(razdely) < 5:
        raise SystemExit(f'ПЛОХО: разделов нашлось {len(razdely)} — разметка документа не та, что ждали')
    io.open(ITOG, 'w', encoding='utf-8').write(sobrat_ts(zagolovok, razdely))
    punktov = sum(len(r['elementy']) for r in razdely)
    print(f'Собрано: {len(razdely)} разделов, {punktov} элементов → {ITOG.relative_to(KOREN)}')
    for r in razdely:
        print(f'  {r["nomer"]}. {r["zagolovok"]}  ({len(r["elementy"])})')


if __name__ == '__main__':
    sys.exit(main())
