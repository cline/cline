#include "gfx.h"

#include <string.h>

#include "font5x7.h"
#include "sprites.h"

uint8_t gfx_fb[GFX_BYTES];

void gfx_clear(void) { memset(gfx_fb, 0xFF, sizeof(gfx_fb)); }

void gfx_pixel(int x, int y, bool black)
{
    if (x < 0 || y < 0 || x >= GFX_W || y >= GFX_H) return;
    uint8_t *byte = &gfx_fb[(y * GFX_W + x) >> 3];
    uint8_t mask = 0x80 >> (x & 7);
    if (black) *byte &= ~mask;
    else *byte |= mask;
}

void gfx_fill_rect(int x, int y, int w, int h, bool black)
{
    for (int yy = y; yy < y + h; yy++)
        for (int xx = x; xx < x + w; xx++) gfx_pixel(xx, yy, black);
}

void gfx_hline(int x, int y, int w) { gfx_fill_rect(x, y, w, 1, true); }

void gfx_rect(int x, int y, int w, int h)
{
    gfx_fill_rect(x, y, w, 1, true);
    gfx_fill_rect(x, y + h - 1, w, 1, true);
    gfx_fill_rect(x, y, 1, h, true);
    gfx_fill_rect(x + w - 1, y, 1, h, true);
}

void gfx_sprite(const sprite_t *s, int x, int y, int scale)
{
    if (!s) return;
    int stride = (s->w + 7) / 8;
    for (int sy = 0; sy < s->h; sy++) {
        for (int sx = 0; sx < s->w; sx++) {
            if (s->bits[sy * stride + (sx >> 3)] & (0x80 >> (sx & 7))) {
                gfx_fill_rect(x + sx * scale, y + sy * scale, scale, scale, true);
            }
        }
    }
}

int gfx_text_width(const char *text, int scale) { return (int)strlen(text) * 6 * scale; }

int gfx_text(int x, int y, const char *text, int scale, bool inverted)
{
    for (const char *p = text; *p; p++) {
        unsigned char c = (unsigned char)*p;
        if (c < 0x20 || c > 0x7E) c = '?';
        const uint8_t *g = FONT5X7[c - 0x20];
        for (int col = 0; col < 5; col++) {
            for (int row = 0; row < 7; row++) {
                if (g[col] & (1 << row)) {
                    gfx_fill_rect(x + col * scale, y + row * scale, scale, scale, !inverted);
                }
            }
        }
        x += 6 * scale;
    }
    return x;
}

void gfx_text_centered(int y, const char *text, int scale)
{
    gfx_text((GFX_W - gfx_text_width(text, scale)) / 2, y, text, scale, false);
}

int gfx_text_wrapped(int x, int y, int w, const char *text, int max_lines)
{
    int per_line = w / 6;
    char line[GFX_W / 6 + 1];
    const char *p = text;
    int lines = 0;
    while (*p && lines < max_lines) {
        while (*p == ' ') p++;
        int len = (int)strlen(p);
        int take = len <= per_line ? len : per_line;
        if (len > per_line) {
            int brk = take;
            while (brk > 0 && p[brk] != ' ') brk--;
            if (brk > per_line / 2) take = brk;
        }
        bool last = lines == max_lines - 1 && len > take;
        memcpy(line, p, take);
        line[take] = '\0';
        if (last && take >= 1) line[take - 1] = '~'; /* truncated marker */
        gfx_text(x, y + lines * 9, line, 1, false);
        p += take;
        lines++;
    }
    return lines;
}

const animation_t *gfx_animation(mood_t mood)
{
    if (mood < MOOD_COUNT && ANIMATIONS[mood].count > 0) return &ANIMATIONS[mood];
    return &ANIMATIONS[MOOD_IDLE];
}
