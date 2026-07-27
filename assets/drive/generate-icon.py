"""Emit a compact inline React icon for the Cline Drive mark.

The full asset path is ~25KB, which is right for a favicon and wrong for a
16-32px nav icon. Resample far more coarsely: at icon sizes the extra control
points are invisible, and the component ships in the JS bundle.
"""

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
VIEW = 24  # lucide-compatible viewBox so it drops into existing icon slots

img = Image.open(src).convert("L")
arr = np.array(img)
mask = (arr > 128).astype(np.uint8) * 255
ys, xs = np.where(mask > 0)
crop = mask[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]

side = max(crop.shape)
pad = int(side * 0.04)  # tighter padding than the standalone asset
canvas_side = side + 2 * pad
canvas = np.zeros((canvas_side, canvas_side), dtype=np.uint8)
oy = (canvas_side - crop.shape[0]) // 2
ox = (canvas_side - crop.shape[1]) // 2
canvas[oy : oy + crop.shape[0], ox : ox + crop.shape[1]] = crop

SS = 4
big = cv2.resize(canvas, (canvas_side * SS, canvas_side * SS), interpolation=cv2.INTER_CUBIC)
big = cv2.GaussianBlur(big, (0, 0), sigmaX=SS * 2.0)
_, big = cv2.threshold(big, 127, 255, cv2.THRESH_BINARY)

contours, _ = cv2.findContours(big, cv2.RETR_TREE, cv2.CHAIN_APPROX_NONE)
scale = VIEW / float(canvas_side * SS)


def resample_closed(points, step):
    pts = points.astype(np.float64)
    closed = np.vstack([pts, pts[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    dist = np.concatenate([[0.0], np.cumsum(seg)])
    total = dist[-1]
    n = max(8, int(round(total / step)))
    t = np.linspace(0.0, total, n, endpoint=False)
    return np.stack(
        [np.interp(t, dist, closed[:, 0]), np.interp(t, dist, closed[:, 1])], axis=1
    )


def catmull(pts):
    n = len(pts)
    d = [f"M{pts[0, 0]:.2f} {pts[0, 1]:.2f}"]
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = p1 + (p2 - p0) / 6.0
        c2 = p2 - (p3 - p1) / 6.0
        d.append(f"C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}")
    d.append("Z")
    return "".join(d)


parts = []
for c in contours:
    if cv2.contourArea(c) <= 10 * SS * SS:
        continue
    pts = c.reshape(-1, 2).astype(np.float64) * scale
    parts.append(catmull(resample_closed(pts, step=0.9)))

path_data = "".join(parts)

tsx = f'''/**
 * The Cline Drive mark as an inline icon.
 *
 * Inline rather than an <img> so it inherits `currentColor` and picks up nav
 * active/hover states like the lucide icons beside it. Traced at a coarse
 * resample: the full asset path is ~25KB, which is wasted detail below 32px.
 */

export function DriveMarkIcon({{ className }}: {{ className?: string }}) {{
\treturn (
\t\t<svg
\t\t\taria-hidden="true"
\t\t\tclassName={{className}}
\t\t\tfill="currentColor"
\t\t\theight="24"
\t\t\tviewBox="0 0 {VIEW} {VIEW}"
\t\t\twidth="24"
\t\t\txmlns="http://www.w3.org/2000/svg"
\t\t>
\t\t\t<path d="{path_data}" fillRule="evenodd" />
\t\t</svg>
\t);
}}
'''

dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(tsx, encoding="utf-8")
print(f"path chars: {len(path_data):,}")
print(f"wrote: {dst}")
