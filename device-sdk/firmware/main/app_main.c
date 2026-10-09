#include "app.h"
#include "audio.h"
#include "cline_board.h"
#include "freertos/task.h"
#include "net.h"
#include "nvs_flash.h"
#include "esp_log.h"
#include "ui.h"
#include <string.h>
QueueHandle_t g_app_queue;
static void input_task(void *arg) {
    for (;;) {
        board_poll_input();
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
void app_main(void) {
    ESP_ERROR_CHECK(board_init());
    esp_err_t err = nvs_flash_init();
    /* NVS may be shared with M5Launcher and other apps. Never erase it as
     * automatic recovery; let the owner back up and repair its storage. */
    g_app_queue = xQueueCreate(12, sizeof(app_event_t));
    configASSERT(g_app_queue);
    ESP_ERROR_CHECK(audio_init());
    ui_start();
    if (err != ESP_OK) {
        ESP_LOGE("storage", "NVS unavailable: %s; no data erased", esp_err_to_name(err));
        app_event_t ev = {.type = EV_SETUP};
        strlcpy(ev.text, "Storage unavailable. Back up and repair NVS in your launcher.", sizeof(ev.text));
        app_post(&ev);
        return;
    }
    xTaskCreatePinnedToCore(input_task, "input", 3072, NULL, 5, NULL, 1);
    net_start();
}
