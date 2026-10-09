#include "cline_assets.h"
#include "sprites.h"
const animation_t *gfx_animation(mood_t mood)
{
    if (mood < MOOD_COUNT && ANIMATIONS[mood].count > 0) return &ANIMATIONS[mood];
    return &ANIMATIONS[MOOD_IDLE];
}
