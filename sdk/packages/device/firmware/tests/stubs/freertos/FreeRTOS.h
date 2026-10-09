#pragma once
#include <stdint.h>
#include <stddef.h>
typedef uint32_t TickType_t;
#define portTICK_PERIOD_MS 1
#define pdMS_TO_TICKS(n) (n)
#define pdTRUE 1
#define pdPASS 1
#define portMAX_DELAY UINT32_MAX
