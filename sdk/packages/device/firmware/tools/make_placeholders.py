#!/usr/bin/env python3
"""Generate stock Cline sprites on a 48x48 design grid, stored at 96x96.

The silhouette follows the reference's broad head, low oval eyes, domed cap
and small ear pods. Fine monochrome dithering replaces its purple shading
on the monochrome e-ink panel. Firmware builds compile the manifest-selected frames automatically.
"""
from pathlib import Path

W = H = 48
OUT = Path(__file__).resolve().parents[2] / "assets" / "avatars" / "cline" / "mono-v1"


class Canvas:
    def __init__(self):
        self.px = [[False] * W for _ in range(H)]

    def set(self, x, y, value=True):
        if 0 <= x < W and 0 <= y < H:
            self.px[y][x] = value

    def rect(self, x, y, w, h, black=True):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, black)

    def text(self, rows, x, y):
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch == "#":
                    self.set(x + dx, y + dy)

    def dump(self, name):
        OUT.mkdir(exist_ok=True)
        # Each design pixel is a 2x2 block. Outlines stay chunky, while the
        # shaded rim uses individual display pixels for a softer gray tone.
        rows = []
        for row in self.px:
            for sub_y in range(2):
                rows.append("".join(
                    ("#." if sub_y == 0 else ".#") if v == 2
                    else "##" if v else ".." for v in row
                ))
        (OUT / f"{name}.txt").write_text("\n".join(rows) + "\n")


# Inclusive horizontal spans, one per pixel row. Explicit contours avoid
# smooth curves or antialiasing and keep every animation on the same grid.
HEAD = (
    (11, 24), (7, 28), (5, 30), (4, 31), (3, 32), (2, 33),
    (2, 33), (1, 34), (1, 34), (0, 35), (0, 35), (0, 35),
    (0, 35), (0, 35), (0, 35), (0, 35), (0, 35), (0, 35),
    (0, 35), (0, 35), (0, 35), (0, 35), (1, 34), (1, 34),
    (2, 33), (3, 32), (4, 31), (5, 30), (7, 28), (11, 24),
)
CAP = ((3, 8), (2, 9), (1, 10), (0, 11), (0, 11), (0, 11), (0, 11))
EAR = ((3, 5), (2, 6), (1, 7), (0, 7), (0, 7), (0, 7), (0, 7), (1, 7), (2, 6), (3, 5))
PUPIL = ("..##..", ".####.") + ("######",) * 6 + (".####.", "..##..")
HAPPY = ("..##..", ".####.", "##..##", "#....#")
CROSS = ("##..##", "######", ".####.", ".####.", "######", "##..##")
BANG = ("##", "##", "##", "##", "##", "..", "##", "##")
ZZ = ("#####", "...##", "..##.", ".##..", "#####")
QUESTION = (".####.", "##..##", "....##", "...##.", "..##..", "......", "..##..", "..##..")
SPARKLE = ("..#..", "..#..", "#####", "..#..", "..#..")
SWIRL = (".#####.", "##...##", "#..#..#", "#.##..#", "#....##", ".####..")


def pixel_shape(c, spans, x, y, ghost=False):
    cells = {(xx, yy) for yy, (left, right) in enumerate(spans)
             for xx in range(left, right + 1)}
    for xx, yy in cells:
        outline = any((xx + dx, yy + dy) not in cells
                      for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        # Shade only the lower/left rim, leaving the face and top highlight white.
        shadow = (xx - 3, yy) not in cells or (xx, yy + 3) not in cells
        if ghost:
            tone = outline and (xx + yy) % 4 < 2
        else:
            tone = 1 if outline else 2 if shadow else 0
        c.set(x + xx, y + yy, tone)


def device(dy=0, listening=False, ghost=False, antenna_lit=False):
    c = Canvas()
    top = 12 + dy
    ears = EAR[:4] + ((0, 7),) * 4 + EAR[4:] if listening else EAR
    ear_y = top + (11 if listening else 14)
    pixel_shape(c, ears, 2, ear_y, ghost)
    pixel_shape(c, tuple((7 - right, 7 - left) for left, right in ears), 38, ear_y, ghost)
    pixel_shape(c, CAP, 18, top - 7, ghost)
    pixel_shape(c, HEAD, 6, top, ghost)
    if antenna_lit:
        # Keep the cap's white highlight instead of filling the whole dome.
        c.rect(22, top - 3, 4, 1)
    return c, top


def eyes(c, top, kind="open", dx=0, dy=0):
    y = top + 12 + dy
    for x in (14 + dx, 28 + dx):
        if kind == "open":
            c.text(PUPIL, x, y)
        elif kind == "closed":
            c.rect(x, y + 6, 6, 2)
        elif kind == "happy":
            c.text(HAPPY, x, y + 3)
        elif kind == "x":
            c.text(CROSS, x, y + 2)


def main():
    c, t = device(); eyes(c, t); c.dump("idle_0")
    c, t = device(); eyes(c, t, "closed"); c.dump("idle_1")
    for i, (dy, dx, lit) in enumerate(((0, 0, False), (-2, 1, True), (0, -1, False))):
        c, t = device(dy=dy, antenna_lit=lit); eyes(c, t, dx=dx); c.dump(f"working_{i}")
    for i in range(2):
        c, t = device(dy=-i, antenna_lit=True); eyes(c, t)
        c.text(BANG, 41, 4 + i); c.dump(f"waiting_{i}")
    c, t = device(listening=True); eyes(c, t, dy=-1)
    c.text(("#...#..", ".#...#.", "..#...#", "..#...#", ".#...#.", "#...#.."), 40, 14)
    c.dump("listening_0")
    c, t = device(); eyes(c, t, dx=1, dy=-2)
    c.rect(36, 9, 2, 2); c.rect(40, 4, 4, 4); c.dump("thinking_0")
    for i in range(2):
        c, t = device(dy=-2 * i, antenna_lit=True); eyes(c, t, "happy")
        for x, y in ((5, 6), (39, 8)) if i == 0 else ((8, 3), (36, 4)):
            c.text(SPARKLE, x, y)
        c.dump(f"done_{i}")
    c, t = device(); eyes(c, t, "x")
    c.text(("##..##..##", ".####.###."), 19, t + 24)
    c.text(SWIRL, 38, 4); c.dump("error_0")
    c, t = device(dy=1); eyes(c, t, "closed", dy=1)
    c.text(ZZ, 40, 3); c.text(("###", ".#.", "###"), 35, 10); c.dump("sleeping_0")
    c, t = device(ghost=True)
    c.text(QUESTION, 21, t + 12); c.dump("offline_0")


if __name__ == "__main__":
    main()
