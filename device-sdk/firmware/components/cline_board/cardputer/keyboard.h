#pragma once
#include "driver/i2c_master.h"
esp_err_t cardputer_keyboard_init(i2c_master_bus_handle_t bus);
void cardputer_keyboard_poll(void);
