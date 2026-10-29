#!/usr/bin/env python3
"""يولّد لوجو WeeklyPlanner (SVG + PNG) — حلقة من 7 أجزاء = أيام الأسبوع، وعلامة صح في المنتصف.
الاستخدام:  python3 tools/make_icons.py
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
OUT.mkdir(exist_ok=True)

COLORS = ["#4f8df7", "#4f8df7", "#34b27b", "#34b27b", "#f4b43c", "#ef6a5b", "#ef6a5b"]
BG = "#fbfaf7"
INK = "#2b2d33"
N = 7
SPAN = 27.4          # امتداد كل جزء بالدرجات (قبل الأطراف الدائرية)
R = 168              # نصف قطر الحلقة (على لوحة 512)
W = 46               # سماكة الحلقة


def seg_angles(i):
    c = -90 + i * 360 / N
    return c - SPAN / 2, c + SPAN / 2


def pt(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


# ---------------------------------------------------------------- SVG
def build_svg(ring_scale=1.0, rounded=True):
    c = 256
    r = R * ring_scale
    w = W * ring_scale
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">']
    parts.append(f'<rect width="512" height="512" rx="{120 if rounded else 0}" fill="{BG}"/>')
    parts.append(f'<g fill="none" stroke-width="{w:.1f}" stroke-linecap="round">')
    for i in range(N):
        a0, a1 = seg_angles(i)
        x0, y0 = pt(c, c, r, a0)
        x1, y1 = pt(c, c, r, a1)
        parts.append(f'<path d="M{x0:.1f} {y0:.1f} A{r:.1f} {r:.1f} 0 0 1 {x1:.1f} {y1:.1f}" stroke="{COLORS[i]}"/>')
    parts.append('</g>')
    k = ring_scale
    chk = [(c - 60 * k, c + 6 * k), (c - 16 * k, c + 50 * k), (c + 66 * k, c - 42 * k)]
    d = f'M{chk[0][0]:.1f} {chk[0][1]:.1f} L{chk[1][0]:.1f} {chk[1][1]:.1f} L{chk[2][0]:.1f} {chk[2][1]:.1f}'
    parts.append(f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{40 * k:.1f}" stroke-linecap="round" stroke-linejoin="round"/>')
    parts.append('</svg>')
    return "\n".join(parts)


# ---------------------------------------------------------------- PNG
def build_png(size, ring_scale=1.0, rounded=True, ss=4):
    S = size * ss
    k = S / 512
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=120 * k, fill=BG)
    else:
        d.rectangle([0, 0, S, S], fill=BG)
    c = 256 * k
    r = R * ring_scale * k
    w = W * ring_scale * k
    for i in range(N):
        a0, a1 = seg_angles(i)
        box = [c - r - w / 2, c - r - w / 2, c + r + w / 2, c + r + w / 2]
        # arc يرسم حول نصف قطر المنتصف بسماكة w (من الخارج للداخل)
        d.arc([c - r - w / 2, c - r - w / 2, c + r + w / 2, c + r + w / 2], a0, a1, fill=COLORS[i], width=int(w))
        for a in (a0, a1):
            x, y = pt(c, c, r, a)
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=COLORS[i])
    kk = ring_scale * k
    chk = [(c - 60 * kk, c + 6 * kk), (c - 16 * kk, c + 50 * kk), (c + 66 * kk, c - 42 * kk)]
    cw = 40 * kk
    d.line(chk, fill=INK, width=int(cw), joint="curve")
    for x, y in (chk[0], chk[2]):
        d.ellipse([x - cw / 2, y - cw / 2, x + cw / 2, y + cw / 2], fill=INK)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    (OUT / "logo.svg").write_text(build_svg(1.0, True), encoding="utf-8")
    (OUT / "logo-maskable.svg").write_text(build_svg(0.78, False), encoding="utf-8")
    build_png(512, 1.0, True).save(OUT / "icon-512.png")
    build_png(192, 1.0, True).save(OUT / "icon-192.png")
    build_png(512, 0.78, False).save(OUT / "icon-maskable-512.png")
    build_png(180, 0.86, False).save(OUT / "apple-touch-icon.png")
    build_png(48, 1.0, True).save(OUT / "favicon-48.png")
    print("done:", sorted(p.name for p in OUT.iterdir()))
