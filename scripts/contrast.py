#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка контраста по WCAG 2.1. Порог для обычного текста 4.5:1, для крупного 3:1."""
import sys, json, re

def srgb(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lum(hex_):
    h = hex_.lstrip('#')
    r, g, b = (int(h[i:i+2], 16) for i in (0, 2, 4))
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def check(pairs, title):
    print(f'\n=== {title} ===')
    worst = 99
    bad = 0
    for fg, bg, label, need in pairs:
        r = ratio(fg, bg)
        ok = r >= need
        if not ok: bad += 1
        worst = min(worst, r / need)
        mark = 'ok ' if ok else 'НЕТ'
        print(f'  {mark} {r:5.2f}:1 (нужно {need}) — {label}  {fg} на {bg}')
    return bad

if __name__ == '__main__':
    data = json.load(open(sys.argv[1]))
    total = 0
    for group in data:
        total += check([(p['fg'], p['bg'], p['label'], p.get('need', 4.5)) for p in group['pairs']], group['title'])
    print(f'\nПровалов: {total}')
    sys.exit(1 if total else 0)
