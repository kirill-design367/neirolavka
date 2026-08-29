# -*- coding: utf-8 -*-
import sys, glob, os
from fontTools.ttLib import TTFont

# пары, которые обязаны быть откернены в НАСТОЯЩЕЙ кириллице,
# и которых физически нет в латинице — значит их нельзя получить «бесплатно»
PAIRS = ['Гу','Гд','Ту','Ту','АУ','УА','ГА','ЛТ','ТЛ','уж','ая','гу','ду','ъе','ы,','я.','Ль','Ръ',
         'Уф','Фу','Зу','Эу','Ущ','Чт','Тя','Ая','Ял','Кж','жд','щу','цу','ць','ню','юл','ёж']

def expand(font):
    """все кернинг-пары как множество (glyph1, glyph2) — и format1, и format2 через классы"""
    pairs = set()
    if 'GPOS' not in font: return pairs
    gp = font['GPOS'].table
    order = font.getGlyphOrder()
    for lu in gp.LookupList.Lookup:
        subs = lu.SubTable
        lt = lu.LookupType
        for st in subs:
            st = getattr(st, 'ExtSubTable', st) or st
            t = getattr(st, 'LookupType', lt)
            if not hasattr(st, 'Format'): continue
            if hasattr(st, 'PairSet') and st.Format == 1:
                for gname, ps in zip(st.Coverage.glyphs, st.PairSet):
                    for pvr in ps.PairValueRecord:
                        if (pvr.Value1 and getattr(pvr.Value1,'XAdvance',0)) or (pvr.Value2 and getattr(pvr.Value2,'XAdvance',0)):
                            pairs.add((gname, pvr.SecondGlyph))
            elif hasattr(st, 'ClassDef1') and st.Format == 2:
                cd1 = st.ClassDef1.classDefs; cd2 = st.ClassDef2.classDefs
                cov = set(st.Coverage.glyphs)
                c1map, c2map = {}, {}
                for g in cov: c1map.setdefault(cd1.get(g,0), []).append(g)
                for g in order: c2map.setdefault(cd2.get(g,0), []).append(g)
                for i, c1rec in enumerate(st.Class1Record):
                    for j, c2rec in enumerate(c1rec.Class2Record):
                        v = c2rec.Value1
                        if v is not None and getattr(v,'XAdvance',0):
                            for a in c1map.get(i, []):
                                for b in c2map.get(j, []):
                                    pairs.add((a,b))
    return pairs

print(f"{'шрифт':<22}{'кир.пар':>9}{'из 36 проб':>12}{'лат.пар':>9}  доля кириллицы")
for p in sorted(glob.glob(sys.argv[1]+'/*.ttf')):
    f = TTFont(p, lazy=False)
    cmap = f.getBestCmap()
    cyr = {cmap[c] for c in cmap if 0x400 <= c <= 0x52F}
    lat = {cmap[c] for c in cmap if 0x41 <= c <= 0x7A}
    pr = expand(f)
    cc = sum(1 for a,b in pr if a in cyr and b in cyr)
    ll = sum(1 for a,b in pr if a in lat and b in lat)
    hit = 0
    for s in PAIRS:
        g1, g2 = cmap.get(ord(s[0])), cmap.get(ord(s[1]))
        if g1 and g2 and (g1,g2) in pr: hit += 1
    share = cc/(cc+ll)*100 if (cc+ll) else 0
    print(f"{os.path.basename(p)[:-4]:<22}{cc:>9}{hit:>12}{ll:>9}  {share:5.1f}%")
    f.close()
