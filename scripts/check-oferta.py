#!/usr/bin/env python3
"""
Оферта на странице совпадает с docx ДОСЛОВНО.

Зачем отдельная проверка, если файл собирает машина. Затем, что
собранный файл лежит в репозитории и его можно поправить руками —
случайно при слиянии, нарочно «подчистить формулировку», автозаменой
по всему проекту. Оферта — договор: страница, разошедшаяся с
подписанным документом, это не опечатка, а другое обязательство.
Сборщик гарантирует перенос в момент запуска, проверка — что с тех
пор никто ничего не трогал.

Сверяются ВСЕ слова документа, а не выборка: текст docx и текст
`oferta.ts` приводятся к одному виду (пробелы схлопываются,
неразрывный пробел равен обычному) и сравниваются целиком.

Разрешено РОВНО ОДНО расхождение — адрес сайта в двух местах, где
владелец оставил зазор. Оно объявлено списком: любое другое слово
не на месте роняет проверку.

    python3 scripts/check-oferta.py
"""

import html
import io
import re
import sys
import zipfile
from pathlib import Path

KOREN = Path(__file__).resolve().parent.parent
DOCX = KOREN / 'docs' / 'Оферта Лев.docx'
TS = KOREN / 'src' / 'lib' / 'oferta.ts'

# Единственная разрешённая правка при переносе. Слева — как в docx,
# справа — как на странице. Список закрытый: всё остальное обязано
# совпадать знак в знак.
PRAVKI = [
    ('по доменному имени и сетевому адресу:', 'по доменному имени и сетевому адресу: neirolavka.ru'),
    ('устанавливаются на Сайте Исполнителя в сети «Интернет»:',
     'устанавливаются на Сайте Исполнителя в сети «Интернет»: neirolavka.ru'),
]


def rovno(s: str) -> str:
    """Один вид для сравнения: пробелы схлопнуты, неразрывные — обычные."""
    return re.sub(r'\s+', ' ', s.replace('\xa0', ' ')).strip()


def iz_docx() -> str:
    with zipfile.ZipFile(DOCX) as z:
        xml = z.read('word/document.xml').decode('utf-8')
    kuski = []
    for p in re.findall(r'<w:p\b[^>]*>(.*?)</w:p>', xml, re.S):
        p = p.replace('<w:tab/>', ' ').replace('<w:br/>', ' ')
        kuski.append(html.unescape(''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', p, re.S))))
    return rovno(' '.join(kuski))


def snyat(l: str) -> str:
    return l.replace("\\'", "'").replace('\\\\', '\\').replace('\\n', ' ')


def iz_ts() -> str:
    """Собранный файл обратно в сплошной текст документа.

    Разбор СТРУКТУРНЫЙ, а не «все строки подряд»: у реквизита между
    подписью и значением стоит двоеточие, у термина — тире, и плоский
    сбор литералов потерял бы и то и другое. Файл машинный и потому
    строго построчный — этого хватает.
    """
    kuski = []
    for stroka in io.open(TS, encoding='utf-8'):
        st = stroka.strip()
        if st.startswith('export const NAZVANIE') or st.startswith('export const PODZAGOLOVOK'):
            kuski.append(snyat(re.search(r"= '((?:[^'\\]|\\.)*)'", st).group(1)))
            continue
        if not st.startswith('{ vid:'):
            # Заголовок раздела — отдельной строкой вида `zagolovok: '…'`.
            z = re.match(r"zagolovok: '((?:[^'\\]|\\.)*)',$", st)
            if z:
                kuski.append(snyat(z.group(1)))
            continue

        vid = re.match(r"\{ vid: '(\w+)'", st).group(1)
        pole = lambda imya: (lambda m: snyat(m.group(1)) if m else '')(
            re.search(imya + r": '((?:[^'\\]|\\.)*)'", st))

        if vid == 'termin':
            kuski.append(pole('termin') + pole('tire') + pole('text'))
        elif vid == 'rekvizit':
            # В документе это «ИНН: 526324111452» одной строкой.
            kuski.append(pole('imya') + ': ' + pole('znachenie'))
        elif vid == 'spisok':
            vnutri = re.search(r'punkty: \[(.*)\]', st).group(1)
            kuski += [snyat(x) for x in re.findall(r"'((?:[^'\\]|\\.)*)'", vnutri)]
        else:
            # punkt / abzac / podzagolovok — номер в документе рисует
            # Word разметкой списка, в тексте его нет.
            kuski.append(pole('text'))
    return rovno(' '.join(kuski))


def main() -> int:
    if not DOCX.exists():
        print(f'ПЛОХО: нет исходника {DOCX}')
        return 1
    if not TS.exists():
        print(f'ПЛОХО: нет собранного файла {TS}')
        return 1

    d = iz_docx()
    t = iz_ts()

    # Применяем разрешённые правки к тексту docx и ждём совпадения.
    ozhidaem = d
    for bylo, stalo in PRAVKI:
        if bylo not in ozhidaem:
            print(f'ПЛОХО: в docx не нашлось места под правку «{bylo[:40]}…»')
            print('  Похоже, пришла новая редакция оферты — пересоберите страницу')
            print('  и обновите список PRAVKI в этой проверке.')
            return 1
        ozhidaem = ozhidaem.replace(bylo, stalo, 1)

    if ozhidaem == t:
        znakov = len(t)
        print(f'Оферта совпадает с docx дословно: {znakov} знаков, '
              f'правок при переносе {len(PRAVKI)} (адрес сайта)')
        # Заодно печатаем, СКОЛЬКО текста проверено: проверка, которая
        # перестала что-либо сверять, опаснее упавшей.
        tekst_ts = io.open(TS, encoding='utf-8').read()
        razdelov = len(re.findall(r"yakor: 'r\d+'", tekst_ts))
        punktov = len(re.findall(r"vid: 'punkt'", tekst_ts))
        print(f'  разделов {razdelov}, нумерованных пунктов {punktov}')
        return 0

    # Не совпало — показать ПЕРВОЕ расхождение, а не «где-то что-то».
    n = next((i for i in range(min(len(ozhidaem), len(t))) if ozhidaem[i] != t[i]),
             min(len(ozhidaem), len(t)))
    print('ПЛОХО: страница разошлась с документом')
    print(f'  первое расхождение на знаке {n}')
    print(f'  в docx    : …{ozhidaem[max(0, n - 60):n + 60]}…')
    print(f'  на странице: …{t[max(0, n - 60):n + 60]}…')
    print('  Страницу правят пересборкой: python3 scripts/oferta-iz-docx.py')
    return 1


if __name__ == '__main__':
    sys.exit(main())
