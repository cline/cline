/*
 * Cline Pet firmware entry point.
 *
 * Tasks:
 *   ui     (core 1, prio 4)  display, state machine, touch hit-testing
 *   input  (core 1, prio 5)  polls touch + push-to-talk button at 50 Hz
 *   audio  (core 1, prio 6)  I2S capture -> WebSocket, only while recording
 *   net    (core 0, prio 5)  Wi-Fi, mDNS discovery, bridge WebSocket
 * Everything reaches the ui task through g_app_queue, so slow network or
 * audio work never blocks drawing or touch handling.
 */
#include "app.h"
#include "audio.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/task.h"
#include "net.h"
#include "nvs_flash.h"
#include "sdkconfig.h"
#include "touch.h"
#include "ui.h"

static const char *TAG = "pet";
QueueHandle_t g_app_queue;

static void input_task(void *arg)
{
    bool was_down = false;
    bool button_was_down = false;
    touch_point_t last = {0};
    for (;;) {
        touch_point_t p;
        if (touch_read(&p)) {
            if (p.pressed) last = p;
            if (p.pressed != was_down) {
                app_event_t ev = {.type = p.pressed ? EV_TOUCH_DOWN : EV_TOUCH_UP};
                ev.touch.x = last.x;
                ev.touch.y = last.y;
                app_post(&ev);
                was_down = p.pressed;
            }
        }
#if CONFIG_PET_PTT_BUTTON >= 0
        bool button = gpio_get_level(CONFIG_PET_PTT_BUTTON) == 0;
        if (button != button_was_down) {
            app_event_t ev = {.type = button ? EV_BUTTON_DOWN : EV_BUTTON_UP};
            app_post(&ev);
            button_was_down = button;
        }
#else
        (void)button_was_down;
#endif
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

void app_main(void)
{
#if CONFIG_PET_VBAT_HOLD >= 0
    /* Latch battery power first, or the board turns off when unplugged. */
    gpio_config_t hold = {.pin_bit_mask = 1ULL << CONFIG_PET_VBAT_HOLD, .mode = GPIO_MODE_OUTPUT};
    gpio_config(&hold);
    gpio_set_level(CONFIG_PET_VBAT_HOLD, 1);
#endif
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    g_app_queue = xQueueCreate(12, sizeof(app_event_t));

#if CONFIG_PET_EPD_PWR >= 0
    /* The panel rail also feeds the touch controller: power it before probing. */
    gpio_config_t epd_pwr = {.pin_bit_mask = 1ULL << CONFIG_PET_EPD_PWR, .mode = GPIO_MODE_OUTPUT};
    gpio_config(&epd_pwr);
    gpio_set_level(CONFIG_PET_EPD_PWR, CONFIG_PET_EPD_PWR_ACTIVE_LEVEL);
    vTaskDelay(pdMS_TO_TICKS(50));
#endif

#if CONFIG_PET_PTT_BUTTON >= 0
    gpio_config_t btn = {
        .pin_bit_mask = 1ULL << CONFIG_PET_PTT_BUTTON,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&btn);
#endif

    ui_start();
    if (touch_init() != ESP_OK) ESP_LOGE(TAG, "touch init failed");
    if (audio_init() != ESP_OK) ESP_LOGE(TAG, "audio init failed");
    xTaskCreatePinnedToCore(input_task, "input", 3072, NULL, 5, NULL, 1);
    net_start();
}
