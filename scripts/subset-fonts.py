#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скачивает исходные бинарники гарнитур и режет их до нужного репертуара.
Запускать вручную при смене набора шрифтов:  python3 scripts/subset-fonts.py
Результат (src/fonts/*.woff2) коммитится, поэтому сборке Python не нужен.
"""
import os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'fonts')
CACHE = os.path.join(ROOT, '.fontcache')

# Репертуар: кириллица (вкл. Ё и укр./бел.), базовая латиница для имён брендов,
# типографика, знак рубля, номер, минус, стрелка.
UNICODES = ','.join([
    'U+0000-00FF', 'U+0131', 'U+0152-0153', 'U+02BB-02BC', 'U+02C6', 'U+02DA', 'U+02DC',
    'U+0304', 'U+0308', 'U+0329', 'U+0400-045F', 'U+0490-0491', 'U+04B0-04B1',
    'U+2000-206F', 'U+20BD', 'U+2116', 'U+2190-2193', 'U+2212', 'U+2010-2011',
    'U+25CF', 'U+2713',
])

FEATURES = 'kern,liga,calt,ccmp,locl,mark,mkmk,case,tnum,lnum,frac,ss01,ss02,cv01,cv02'

FONTS = [
    # (имя файла на выходе, url исходника)
    ('golos-text', 'https://raw.githubusercontent.com/google/fonts/main/ofl/golostext/GolosText%5Bwght%5D.ttf'),
    ('akt',        'https://raw.githubusercontent.com/google/fonts/main/ofl/akt/Akt%5Bwght%5D.ttf'),
    ('onest',      'https://raw.githubusercontent.com/google/fonts/main/ofl/onest/Onest%5Bwght%5D.ttf'),
]

def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    for name, url in FONTS:
        src = os.path.join(CACHE, name + '.ttf')
        if not os.path.exists(src):
            print(f'качаю {name}…')
            urllib.request.urlretrieve(url, src)
        dst = os.path.join(OUT, name + '.woff2')
        cmd = [
            sys.executable, '-m', 'fontTools.subset', src,
            f'--unicodes={UNICODES}',
            f'--layout-features+={FEATURES}',
            '--flavor=woff2',
            '--harfbuzz-repacker',
            '--no-hinting',
            '--desubroutinize',
            '--name-IDs=1,2,3,4,5,6,13,14',
            '--drop-tables+=DSIG',
            f'--output-file={dst}',
        ]
        subprocess.run(cmd, check=True)
        before = os.path.getsize(src) / 1024
        after = os.path.getsize(dst) / 1024
        print(f'{name:<12} {before:7.1f} КБ → {after:6.1f} КБ woff2')

if __name__ == '__main__':
    main()
