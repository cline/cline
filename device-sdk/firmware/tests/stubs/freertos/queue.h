#pragma once
#include "FreeRTOS.h"
typedef void *QueueHandle_t;
int xQueueSend(QueueHandle_t q, const void *ev, TickType_t wait);
static inline int xQueueReceive(QueueHandle_t q, void *ev, TickType_t wait) { return 0; }
