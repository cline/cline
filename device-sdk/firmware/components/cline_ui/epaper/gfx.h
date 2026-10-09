#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

#define GFX_W 200
#define GFX_H 200
#define GFX_BYTES (GFX_W * GFX_H / 8)

#include "cline_assets.h"

/* Framebuffer in SSD1681 layout: 1 = white, 0 = black. */
extern uint8_t gfx_fb[GFX_BYTES];

void gfx_clear(void);
void gfx_pixel(int x, int y, bool black);
void gfx_fill_rect(int x, int y, int w, int h, bool black);
void gfx_rect(int x, int y, int w, int h);
void gfx_hline(int x, int y, int w);
/* Draw a sprite scaled by an integer factor; only black pixels are drawn. */
void gfx_sprite(const sprite_t *s, int x, int y, int scale);
/* 5x7 font, 6 px advance. Returns the x after the last glyph. */
int gfx_text(int x, int y, const char *text, int scale, bool inverted);
int gfx_text_width(const char *text, int scale);
void gfx_text_centered(int y, const char *text, int scale);
/* Word-wrap into at most max_lines lines; returns lines used. */
int gfx_text_wrapped(int x, int y, int w, const char *text, int max_lines);
const animation_t *gfx_animation(mood_t mood);
