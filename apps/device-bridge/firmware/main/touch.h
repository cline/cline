#pragma once
#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool pressed;
    int16_t x, y;
} touch_point_t;

/* CST816 / FT6x36-compatible I2C touch controller. */
esp_err_t touch_init(void);
/* Returns true on a successful read; `out->pressed` reflects contact. */
bool touch_read(touch_point_t *out);
