#pragma once
#include "FreeRTOS.h"
extern uint32_t test_clock;
typedef void *TaskHandle_t;
static inline TickType_t xTaskGetTickCount(void) { return test_clock; }
static inline int xTaskCreatePinnedToCore(void (*task)(void *), const char *name, int stack, void *arg, int priority, void *handle, int core) {
    if (handle) *(TaskHandle_t *)handle = (void *)1;
    return pdPASS;
}
unsigned ulTaskNotifyTake(int clear, TickType_t wait);
static inline void xTaskNotifyGive(TaskHandle_t task) {}
