"""Vectorize the Cline Drive steering-wheel mark into an asset pack.

Based on Harrison's script. Two changes to the tracing stage, because the
straight-segment version rendered visibly lumpy at logo sizes:

1. The source PNG is anti-aliased, so a hard >128 threshold leaves a ragged
   boundary. Upscale, blur, then re-threshold to recover a smooth edge before
   tracing.
2. approxPolyDP emits polylines. Resample each contour and fit a closed
   Catmull-Rom spline converted to cubic Beziers, so circles read as circles.
"""

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

src = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

# Cline-inspired monochrome palette based on official light/dark brand assets.
DARK = "#1F2024"
LIGHT = "#FAFAF8"
VIEW = 1024  # clean power-of-two viewBox

img = Image.open(src).convert("L")
arr = np.array(img)

mask = (arr > 128).astype(np.uint8) * 255

ys, xs = np.where(mask > 0)
x0, x1 = xs.min(), xs.max()
y0, y1 = ys.min(), ys.max()
crop = mask[y0 : y1 + 1, x0 : x1 + 1]

pad_ratio = 0.10
side = max(crop.shape)
pad = int(side * pad_ratio)
canvas_side = side + 2 * pad
canvas = np.zeros((canvas_side, canvas_side), dtype=np.uint8)
oy = (canvas_side - crop.shape[0]) // 2
ox = (canvas_side - crop.shape[1]) // 2
canvas[oy : oy + crop.shape[0], ox : ox + crop.shape[1]] = crop

canvas = cv2.morphologyEx(canvas, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
canvas = cv2.morphologyEx(canvas, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

# --- smooth the stencil boundary before tracing -------------------------
SS = 4  # supersample factor
big = cv2.resize(canvas, (canvas_side * SS, canvas_side * SS), interpolation=cv2.INTER_CUBIC)
big = cv2.GaussianBlur(big, (0, 0), sigmaX=SS * 1.6)
_, big = cv2.threshold(big, 127, 255, cv2.THRESH_BINARY)

contours, _ = cv2.findContours(big, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
scale = VIEW / float(canvas_side * SS)


def resample_closed(points: np.ndarray, step_px: float) -> np.ndarray:
    """Even arc-length resampling of a closed contour."""
    pts = points.astype(np.float64)
    closed = np.vstack([pts, pts[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    dist = np.concatenate([[0.0], np.cumsum(seg)])
    total = dist[-1]
    n = max(8, int(round(total / step_px)))
    targets = np.linspace(0.0, total, n, endpoint=False)
    xs = np.interp(targets, dist, closed[:, 0])
    ys = np.interp(targets, dist, closed[:, 1])
    return np.stack([xs, ys], axis=1)


def catmull_rom_path(pts: np.ndarray) -> str:
    """Closed Catmull-Rom through pts, emitted as cubic Beziers."""
    n = len(pts)
    d = [f"M {pts[0, 0]:.2f} {pts[0, 1]:.2f}"]
    for i in range(n):
        p0 = pts[(i - 1) % n]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n]
        c1 = p1 + (p2 - p0) / 6.0
        c2 = p2 - (p3 - p1) / 6.0
        d.append(
            f"C {c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}"
        )
    d.append("Z")
    return " ".join(d)


subpaths = []
kept = 0
for c in contours:
    if cv2.contourArea(c) <= 10 * SS * SS:
        continue
    pts = c.reshape(-1, 2).astype(np.float64) * scale
    # ~14px spacing in viewBox units keeps curvature without overfitting noise.
    pts = resample_closed(pts, step_px=14.0)
    subpaths.append(catmull_rom_path(pts))
    kept += 1

path_data = " ".join(subpaths)


def make_svg(fg, bg=None):
    bg_rect = "" if bg is None else f'<rect width="{VIEW}" height="{VIEW}" fill="{bg}"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEW} {VIEW}" role="img" aria-label="Cline Drive steering wheel logo">
  {bg_rect}
  <path d="{path_data}" fill="{fg}" fill-rule="evenodd"/>
</svg>
'''


for name, data in {
    "cline-drive-light.svg": make_svg(DARK, LIGHT),
    "cline-drive-dark.svg": make_svg(LIGHT, DARK),
    "cline-drive-dark-on-transparent.svg": make_svg(DARK, None),
    "cline-drive-light-on-transparent.svg": make_svg(LIGHT, None),
}.items():
    (out / name).write_text(data, encoding="utf-8")


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def raster(size, fg, bg=None):
    m = Image.fromarray(big).resize((size, size), Image.Resampling.LANCZOS)
    alpha = np.array(m, dtype=np.uint8)
    fg_rgb = np.array(hex_rgb(fg), dtype=np.uint8)
    if bg is None:
        rgba = np.zeros((size, size, 4), dtype=np.uint8)
        rgba[..., :3] = fg_rgb
        rgba[..., 3] = alpha
        return Image.fromarray(rgba, "RGBA")
    bg_rgb = np.array(hex_rgb(bg), dtype=np.uint8)
    a = alpha[..., None] / 255.0
    rgb = (fg_rgb * a + bg_rgb * (1 - a)).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


for size in (256, 512, 1024):
    raster(size, DARK, LIGHT).save(out / f"cline-drive-light-{size}.png", optimize=True)
    raster(size, LIGHT, DARK).save(out / f"cline-drive-dark-{size}.png", optimize=True)
    raster(size, DARK, None).save(out / f"cline-drive-dark-transparent-{size}.png", optimize=True)
    raster(size, LIGHT, None).save(out / f"cline-drive-light-transparent-{size}.png", optimize=True)

for mode, fg, bg in [("light", DARK, LIGHT), ("dark", LIGHT, DARK)]:
    sizes = [16, 32, 48, 64, 128, 256]
    imgs = [raster(s, fg, bg).convert("RGBA") for s in sizes]
    imgs[-1].save(out / f"favicon-{mode}.ico", format="ICO", sizes=[(s, s) for s in sizes])

favicon_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEW} {VIEW}">
<style>
  .bg {{ fill: {LIGHT}; }}
  .mark {{ fill: {DARK}; }}
  @media (prefers-color-scheme: dark) {{
    .bg {{ fill: {DARK}; }}
    .mark {{ fill: {LIGHT}; }}
  }}
</style>
<rect class="bg" width="{VIEW}" height="{VIEW}"/>
<path class="mark" d="{path_data}" fill-rule="evenodd"/>
</svg>
'''
(out / "favicon.svg").write_text(favicon_svg, encoding="utf-8")

print(f"viewBox: {VIEW}")
print(f"path chars: {len(path_data):,}")
print(f"contours kept: {kept}")
