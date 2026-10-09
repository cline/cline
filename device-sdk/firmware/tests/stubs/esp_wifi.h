#pragma once
#define WIFI_PS_MIN_MODEM 0
#define WIFI_PS_MAX_MODEM 1
static inline int esp_wifi_set_ps(int mode) { return 0; }
#define WIFI_PS_NONE 2
