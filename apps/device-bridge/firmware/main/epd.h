#pragma once
#include <stdint.h>

#include "gfx.h"

void epd_init(void);
/* Slow (~2 s), flashing refresh that clears ghosting. */
void epd_full_refresh(const uint8_t *fb);
/* Fast (~0.3 s) refresh; ghosts if overused, so callers interleave full ones. */
void epd_partial_refresh(const uint8_t *fb);
/* Panel deep sleep; the next refresh re-initialises the controller. */
void epd_sleep(void);
