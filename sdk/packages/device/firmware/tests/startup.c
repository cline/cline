#include "host.h"
#include "app.h"
#include "freertos/task.h"
#include <assert.h>
#define configASSERT assert
static inline QueueHandle_t xQueueCreate(int length, int size) { return (void *)1; }
static inline void vTaskDelay(TickType_t ticks) {}
#include "../main/app_main.c"
uint32_t test_clock;
static esp_err_t storage_result;
static int erases, network_starts, ui_starts, notices;
esp_err_t board_init(void) { return ESP_OK; }
void board_poll_input(void) {}
esp_err_t audio_init(void) { return ESP_OK; }
esp_err_t nvs_flash_init(void) { return storage_result; }
esp_err_t nvs_flash_erase(void) { erases++; return ESP_OK; }
const char *esp_err_to_name(esp_err_t err) { return "test"; }
void ui_start(void) { ui_starts++; }
void net_start(void) { network_starts++; }
int xQueueSend(QueueHandle_t q, const void *raw, TickType_t wait) {
    const app_event_t *ev = raw;
    assert(ev->type == EV_SETUP && strstr(ev->text, "Storage unavailable"));
    notices++;
    return pdTRUE;
}
int main(void) {
    storage_result = ESP_ERR_NVS_NO_FREE_PAGES; app_main();
    storage_result = ESP_ERR_NVS_NEW_VERSION_FOUND; app_main();
    assert(erases == 0 && network_starts == 0 && notices == 2 && ui_starts == 2);
    storage_result = ESP_OK; app_main();
    assert(network_starts == 1 && erases == 0);
    return 0;
}
