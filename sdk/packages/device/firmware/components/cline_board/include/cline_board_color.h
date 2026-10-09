#pragma once
#include <stdbool.h>
#include "esp_err.h"
/* Only the LVGL renderer uses this interface; native handles stay in the BSP. */
esp_err_t board_color_init(void);
bool board_color_lock(void);
void board_color_unlock(void);
void board_color_sleep(bool sleep);
