#!/usr/bin/env python3
"""Draw the placeholder pet frames procedurally and write them as editable
ASCII art (sprites/<name>.txt, '#' = black, '.' = white, 32x32).

Run once to regenerate the placeholders; after that, edit the .txt files by
hand or drop in PNGs and run tools/sprites.py."""
import math
import os

W = H = 32
OUT = os.path.join(os.path.dirname(__file__), "..", "sprites")


class Canvas:
    def __init__(self):
        self.px = [[0] * W for _ in range(H)]

    def set(self, x, y, v=1):
        x, y = int(round(x)), int(round(y))
        if 0 <= x < W and 0 <= y < H:
            self.px[y][x] = v

    def line(self, x0, y0, x1, y1):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            t = i / n
            self.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)

    def ellipse(self, cx, cy, rx, ry, dotted=False):
        # white fill, then outline
        for y in range(H):
            for x in range(W):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                    self.px[y][x] = 0
        steps = 120
        for i in range(steps):
            if dotted and i % 6 >= 3:
                continue
            a = 2 * math.pi * i / steps
            self.set(cx + rx * math.cos(a), cy + ry * math.sin(a))

    def rect(self, x, y, w, h):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy)

    def text(self, rows, x, y):
        for dy, row in enumerate(rows):
            for dx, ch in enumerate(row):
                if ch == "#":
                    self.set(x + dx, y + dy)

    def dump(self, name):
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, f"{name}.txt"), "w") as f:
            for row in self.px:
                f.write("".join("#" if v else "." for v in row) + "\n")


# ---- Cline robot ---------------------------------------------------------
# Rounded-square head, antenna knob on top, ears on both sides and two tall
# pill eyes, after the Cline logo. Expressions only change eyes/accessories.

HEAD_X, HEAD_W, HEAD_H = 5, 22, 20


def rounded_rect(c, x, y, w, h, r, fill_white=True, dotted=False):
    inside = lambda px, py: not (
        (px < x + r and py < y + r and (px - (x + r)) ** 2 + (py - (y + r)) ** 2 > r * r)
        or (px > x + w - 1 - r and py < y + r and (px - (x + w - 1 - r)) ** 2 + (py - (y + r)) ** 2 > r * r)
        or (px < x + r and py > y + h - 1 - r and (px - (x + r)) ** 2 + (py - (y + h - 1 - r)) ** 2 > r * r)
        or (px > x + w - 1 - r and py > y + h - 1 - r and (px - (x + w - 1 - r)) ** 2 + (py - (y + h - 1 - r)) ** 2 > r * r)
    )
    cells = [(px, py) for py in range(y, y + h) for px in range(x, x + w) if inside(px, py)]
    cellset = set(cells)
    if fill_white:
        for px, py in cells:
            c.set(px, py, 0)
    i = 0
    for px, py in cells:
        edge = any((px + dx, py + dy) not in cellset for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if edge:
            i += 1
            if not dotted or (px + py) % 3 != 0:
                c.set(px, py)


def pet(dy=0, ears_tall=False, dotted=False, antenna_lit=False):
    c = Canvas()
    top = 9 + dy
    # ears: outlined pointy wedges, wide against the head, tapering outward
    ey, eh = (top + 3, 14) if ears_tall else (top + 5, 10)
    mid = (eh - 1) / 2
    wedge = set()
    for row in range(eh):
        reach = round(4 * (1 - abs(row - mid) / (mid + 0.5)))  # 0..4 px out
        for k in range(reach + 1):
            wedge.add((k, ey + row))
    for k, yy in wedge:
        edge = k == 0 or any(n not in wedge for n in ((k + 1, yy), (k, yy - 1), (k, yy + 1)))
        if not edge or (dotted and (k + yy) % 2):
            continue
        c.set(5 - k, yy)   # left ear grows leftwards
        c.set(26 + k, yy)  # right ear grows rightwards
    # antenna stem + knob
    c.rect(15, top - 2, 2, 2)
    rounded_rect(c, 13, top - 6, 6, 4, 1, fill_white=not antenna_lit, dotted=dotted)
    if antenna_lit:
        c.rect(14, top - 5, 4, 2)
    rounded_rect(c, HEAD_X, top, HEAD_W, HEAD_H, 5, dotted=dotted)
    return c, top


def eyes(c, top, kind="open", dx=0, dy=0):
    y = top + 6 + dy
    for x in (10 + dx, 18 + dx):
        if kind == "open":       # chunky tall pills, like the logo
            c.rect(x, y + 1, 4, 6)
            c.rect(x + 1, y, 2, 8)
        elif kind == "closed":
            c.rect(x, y + 5, 4, 1)
        elif kind == "happy":     # ^ ^
            c.set(x, y + 5); c.set(x + 1, y + 4); c.set(x + 2, y + 4); c.set(x + 3, y + 5)
            c.set(x - 1, y + 6); c.set(x + 4, y + 6)
        elif kind == "x":
            c.line(x, y + 2, x + 4, y + 6)
            c.line(x + 4, y + 2, x, y + 6)


BANG = ["##", "##", "##", "##", "..", "##"]
ZZ = ["####", "..#.", ".#..", "####"]
Q = ["###", "..#", ".#.", "...", ".#."]


def main():
    # idle: pill eyes / blink
    c, t = pet(); eyes(c, t); c.dump("idle_0")
    c, t = pet(); eyes(c, t, "closed"); c.dump("idle_1")
    # working: bob up and down, eyes glance left/right, antenna blinks
    for i, (dy, dx, lit) in enumerate(((0, 0, False), (-2, 1, True), (0, -1, False))):
        c, t = pet(dy=dy, antenna_lit=lit); eyes(c, t, dx=dx); c.dump(f"working_{i}")
    # waiting: "!" beside the head, antenna lit
    for i in range(2):
        c, t = pet(dy=-i, antenna_lit=True); eyes(c, t)
        c.text(BANG, 29, 1 + i)
        c.dump(f"waiting_{i}")
    # listening: tall ears + sound waves on the right
    c, t = pet(ears_tall=True); eyes(c, t, dy=-1)
    for r in (2, 4):
        for a in range(-50, 51, 10):
            th = math.radians(a)
            c.set(29 + r * math.cos(th), 4 + r * math.sin(th))
    c.dump("listening_0")
    # thinking: eyes look up-right + thought bubble dots
    c, t = pet(); eyes(c, t, dx=1, dy=-2)
    c.rect(24, 3, 2, 2); c.rect(27, 0, 3, 3); c.dump("thinking_0")
    # celebrate: happy eyes, bounce, sparkles
    for i in range(2):
        c, t = pet(dy=-2 * i, antenna_lit=True); eyes(c, t, "happy")
        for sx, sy in ((3, 3), (28, 4)) if i == 0 else ((6, 1), (25, 2)):
            c.set(sx, sy - 1); c.set(sx, sy + 1); c.set(sx - 1, sy); c.set(sx + 1, sy); c.set(sx, sy)
        c.dump(f"celebrate_{i}")
    # error: X eyes, wobbly mouth, dizzy swirl
    c, t = pet(); eyes(c, t, "x")
    for x in range(13, 20):
        c.set(x, t + 16 + (1 if x % 2 else 0))
    for i in range(30):
        a = i * 0.5; r = 0.5 + i * 0.07
        c.set(27 + r * math.cos(a), 3 + r * math.sin(a) * 0.7)
    c.dump("error_0")
    # sleeping: closed eyes, droop, Zz
    c, t = pet(dy=1); eyes(c, t, "closed", dy=1)
    c.text(ZZ, 27, 0); c.text(["###", ".#.", "###"], 23, 5); c.dump("sleeping_0")
    # offline: dotted ghost of the robot with a "?"
    c, t = pet(dotted=True)
    c.text(Q, 15, t + 7); c.dump("offline_0")


if __name__ == "__main__":
    main()
