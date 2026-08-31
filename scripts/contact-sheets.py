#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собирает скриншоты блоков в контактные листы: по одному на разрешение и тему."""
import sys, os
from PIL import Image, ImageDraw, ImageFont

SHOTS, OUT = sys.argv[1], sys.argv[2]
FONT = sys.argv[3] if len(sys.argv) > 3 else '.fontcache/golos-text.ttf'
os.makedirs(OUT, exist_ok=True)

BG = {'светлая': (244, 219, 197), 'тёмная': (12, 34, 35)}
FG = {'светлая': (27, 33, 28), 'тёмная': (232, 230, 224)}

ORDER = ['1-первый-экран', '2-тарифы-claude', '3-заказ-собран', '4-chatgpt-скоро',
         '5-как-устроено', '6-рефералка', '7-отзывы', '8-подвал']
TITLES = {
    '1-первый-экран': 'Навигация, шапка, первый экран, пустой чек',
    '2-тарифы-claude': 'Тарифы Claude: по месяцам и по токенам',
    '3-заказ-собран': 'Заказ собран: товар, оплата, сумма, кнопка',
    '4-chatgpt-скоро': 'ChatGPT помечен «скоро» и недоступен',
    '5-как-устроено': 'Как это устроено — шаги на нити',
    '6-рефералка': 'Реферальная программа',
    '7-отзывы': 'Отзывы',
    '8-подвал': 'Подвал',
}

try:
    font = ImageFont.truetype(FONT, 19)
except OSError:
    font = ImageFont.load_default()
    print('внимание: кириллического шрифта нет, подписи будут квадратами')

PAD, GAP, HDR = 28, 22, 38
for vp in ['1920x1080', '1512x820', '390x844']:
    for theme in ['светлая', 'тёмная']:
        imgs = []
        for key in ORDER:
            f = os.path.join(SHOTS, f'{vp}-{theme}-{key}.png')
            if os.path.exists(f):
                imgs.append((TITLES[key], Image.open(f).convert('RGB')))
        if not imgs:
            continue
        w = max(i.width for _, i in imgs)
        cols = 4 if vp == '390x844' else 1
        rows = (len(imgs) + cols - 1) // cols
        colw = w + GAP
        rowhs = [max(i.height for _, i in imgs[r * cols:(r + 1) * cols]) + HDR + GAP for r in range(rows)]
        sheet = Image.new('RGB', (PAD * 2 + cols * colw - GAP, PAD * 2 + sum(rowhs) - GAP), BG[theme])
        d = ImageDraw.Draw(sheet)
        y = PAD
        for r in range(rows):
            x = PAD
            for title, im in imgs[r * cols:(r + 1) * cols]:
                d.text((x, y + 4), f'{title}  ·  {vp}  ·  {theme} тема', fill=FG[theme], font=font)
                sheet.paste(im, (x, y + HDR))
                x += colw
            y += rowhs[r]
        out = os.path.join(OUT, f'{vp}-{theme}.png')
        sheet.save(out, optimize=True)
        print(f'{os.path.basename(out)}: {sheet.width}×{sheet.height}, {os.path.getsize(out)//1024} КБ')
