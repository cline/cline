#pragma once
/* Coordinates in the 466x466 round screen's reference space. Rectangles stay
 * inside the circular panel; keep the avatar clear of text and controls. */
typedef struct { int x, y, w, h; } cline_layout_rect_t;
typedef enum {
    ROUND_COUNTS, ROUND_SPEECH, ROUND_AVATAR, ROUND_STATUS,
    ROUND_NEW, ROUND_STOP, ROUND_TALK, ROUND_LEFT, ROUND_RIGHT, ROUND_LAYOUT_COUNT,
} cline_round_region_t;
static const cline_layout_rect_t cline_round_layout[ROUND_LAYOUT_COUNT] = {
    [ROUND_COUNTS] = {113, 36, 240, 24},
    [ROUND_SPEECH] = {73, 78, 320, 78},
    [ROUND_AVATAR] = {153, 172, 160, 160},
    [ROUND_STATUS] = {113, 337, 240, 24},
    [ROUND_NEW] = {115, 366, 108, 36},
    [ROUND_STOP] = {243, 366, 108, 36},
    [ROUND_TALK] = {139, 409, 188, 36},
    [ROUND_LEFT] = {105, 376, 118, 44},
    [ROUND_RIGHT] = {243, 376, 118, 44},
};
