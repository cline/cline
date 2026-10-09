#pragma once
#include <stdbool.h>
#include <stdint.h>
void board_epaper_init(void);
void board_epaper_refresh(const uint8_t *pixels, bool full);
void board_epaper_sleep(void);
