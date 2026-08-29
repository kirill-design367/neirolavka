# -*- coding: utf-8 -*-
import sys, glob, os, json
from fontTools.ttLib import TTFont

RU = [chr(c) for c in range(0x410, 0x450)] + ['Ё','ё']          # А-я + Ё ё  (66)
EXT = list('ІЇЄҐіїєґЎўЈЉЊЋЏЂјљњћџЅѕ')                            # укр/бел/серб
TYPO = {'₽':0x20BD,'«':0xAB,'»':0xBB,'—':0x2014,'–':0x2013,'№':0x2116,'…':0x2026,'‑':0x2011,
        '„':0x201E,'“':0x201C,'”':0x201D,'×':0xD7,'−':0x2212,' ':0xA0,' ':0x202F}
# Кириллические буквы, которых НЕТ в латинице по форме — «настоящая» работа видна тут
CYR_ONLY = list('бвгдёжзийлптфцчшщъыьэюяБГДЁЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯ')

def contours(glyf, name, seen=None):
    """число контуров с учётом композитов"""
    if seen is None: seen = set()
    if name in seen: return 0
    seen.add(name)
    try: g = glyf[name]
    except Exception: return 0
    if g.numberOfContours > 0: return g.numberOfContours
    if g.isComposite():
        return sum(contours(glyf, c.glyphName, seen) for c in g.components)
    return 0

def audit(path):
    f = TTFont(path, fontNumber=0, lazy=False)
    cmap = f.getBestCmap()
    upem = f['head'].unitsPerEm
    glyf = f['glyf'] if 'glyf' in f else None
    hmtx = f['hmtx']
    r = {'file': os.path.basename(path), 'glyphs': len(f.getGlyphOrder()), 'upem': upem}

    def cover(chars):
        miss, blank = [], []
        for ch in chars:
            cp = ord(ch)
            gn = cmap.get(cp)
            if gn is None:
                miss.append(ch); continue
            if glyf is not None and contours(glyf, gn) == 0 and hmtx[gn][0] > 0 and ch.strip():
                blank.append(ch)
        return miss, blank

    for label, chars in (('ru', RU), ('ext', EXT), ('typo', list(TYPO.keys()))):
        miss, blank = cover(chars)
        r[label] = {'total': len(chars), 'missing': ''.join(miss), 'blank': ''.join(blank),
                    'ok': len(chars) - len(miss) - len(blank)}

    # сколько кодпоинтов кириллических блоков вообще покрыто
    cyr_cps = [cp for cp in cmap if 0x400 <= cp <= 0x52F or 0x2DE0 <= cp <= 0x2DFF or 0xA640 <= cp <= 0xA69F]
    r['cyrillic_codepoints'] = len(cyr_cps)

    # уникальность очертаний кириллицы: сколько РАЗНЫХ глифов на 44 «некириллично-неповторимых» буквы
    gn_set, zero = set(), []
    for ch in CYR_ONLY:
        gn = cmap.get(ord(ch))
        if gn:
            gn_set.add(gn)
            if glyf is not None and contours(glyf, gn) == 0: zero.append(ch)
    r['cyr_only_unique_glyphs'] = f'{len(gn_set)}/{len(CYR_ONLY)}'
    r['cyr_only_empty'] = ''.join(zero)

    # локализованные формы (locl) — признак серьёзной работы над кириллицей
    locl_langs = set()
    if 'GSUB' in f:
        gs = f['GSUB'].table
        for fr in (gs.FeatureList.FeatureRecord if gs.FeatureList else []):
            if fr.FeatureTag == 'locl': locl_langs.add('locl')
        for sr in (gs.ScriptList.ScriptRecord if gs.ScriptList else []):
            if sr.ScriptTag in ('cyrl','DFLT','latn'):
                for lsr in (sr.Script.LangSysRecord or []):
                    locl_langs.add(f'{sr.ScriptTag}/{lsr.LangSysTag.strip()}')
    r['gsub_scripts_langs'] = sorted(x for x in locl_langs if '/' in x)
    r['has_locl'] = 'locl' in locl_langs

    # кернинг с участием кириллицы
    kern_cyr = 0
    cyr_glyphs = {cmap[cp] for cp in cyr_cps if cp in cmap}
    if 'GPOS' in f:
        try:
            gp = f['GPOS'].table
            for lu in gp.LookupList.Lookup:
                if lu.LookupType not in (2, 9): continue
                for st in lu.SubTable:
                    st = getattr(st, 'ExtSubTable', st)
                    if getattr(st, 'Format', None) == 1 and hasattr(st, 'PairSet'):
                        for gname, ps in zip(st.Coverage.glyphs, st.PairSet):
                            if gname in cyr_glyphs: kern_cyr += ps.PairValueCount
                    elif getattr(st, 'Format', None) == 2 and hasattr(st, 'ClassDef1'):
                        cov = set(st.Coverage.glyphs)
                        if cov & cyr_glyphs: kern_cyr += len(cov & cyr_glyphs)
        except Exception as e:
            r['kern_err'] = str(e)[:60]
    r['cyr_kern_signal'] = kern_cyr

    n = f['name']
    def nm(i):
        rec = n.getDebugName(i)
        return rec or ''
    r['family'] = nm(1); r['designer'] = nm(9); r['license'] = nm(13)[:60]; r['version'] = nm(5)
    f.close()
    return r

out = [audit(p) for p in sorted(glob.glob(sys.argv[1] + '/*.ttf'))]
print(json.dumps(out, ensure_ascii=False, indent=1))
