#pragma once
#include <stdint.h>
/* 1-bit sprite, row-major, MSB first, 1 = black. */
typedef struct {
    uint8_t w, h;
    const uint8_t *bits;
} sprite_t;

typedef enum {
    MOOD_IDLE,
    MOOD_WORKING,
    MOOD_WAITING,
    MOOD_LISTENING,
    MOOD_THINKING,
    MOOD_DONE,
    MOOD_ERROR,
    MOOD_SLEEPING,
    MOOD_OFFLINE,
    MOOD_COUNT,
} mood_t;

typedef struct {
    const sprite_t *const *frames;
    uint8_t count;
} animation_t;

const animation_t *gfx_animation(mood_t mood);
