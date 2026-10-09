#include "cline_board.h"
#include "cline_board_epaper.h"
#include "app.h"
#include "touch.h"
#include "epd.h"
#include "driver/gpio.h"
#include "esp_sleep.h"
#include "freertos/task.h"
#include "sdkconfig.h"
static const cline_board_info_t info = {"Waveshare ePaper 1.54", 200, 200, false, true, true};
const cline_board_info_t *board_info(void) { return &info; }
esp_err_t board_init(void) {
#if CONFIG_DEVICE_VBAT_HOLD >= 0
    /* Latch battery power first, or the board turns off when unplugged. */
    gpio_config_t hold = {.pin_bit_mask = 1ULL << CONFIG_DEVICE_VBAT_HOLD, .mode = GPIO_MODE_OUTPUT};
    gpio_config(&hold);
    gpio_set_level(CONFIG_DEVICE_VBAT_HOLD, 1);
#endif
#if CONFIG_DEVICE_EPD_PWR >= 0
    /* The panel rail also feeds the touch controller: power it before probing. */
    gpio_config_t epd_pwr = {.pin_bit_mask = 1ULL << CONFIG_DEVICE_EPD_PWR, .mode = GPIO_MODE_OUTPUT};
    gpio_config(&epd_pwr);
    gpio_set_level(CONFIG_DEVICE_EPD_PWR, CONFIG_DEVICE_EPD_PWR_ACTIVE_LEVEL);
    vTaskDelay(pdMS_TO_TICKS(50));
#endif

#if CONFIG_DEVICE_PTT_BUTTON >= 0
    gpio_config_t btn = {
        .pin_bit_mask = 1ULL << CONFIG_DEVICE_PTT_BUTTON,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    gpio_config(&btn);
#endif

    return touch_init();
}
void board_poll_input(void) {
    static bool was_down = false;
    static bool button_was_down = false;
    static touch_point_t last = {0};
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
#if CONFIG_DEVICE_PTT_BUTTON >= 0
        bool button = gpio_get_level(CONFIG_DEVICE_PTT_BUTTON) == 0;
        if (button != button_was_down) {
            app_event_t ev = {.type = button ? EV_ACTION_DOWN : EV_ACTION_UP, .action = ACTION_TALK_NEW};
            app_post(&ev);
            button_was_down = button;
        }
#else
        (void)button_was_down;
#endif

}
void board_epaper_init(void) { epd_init(); }
void board_epaper_refresh(const uint8_t *pixels, bool full) {
    if (full) epd_full_refresh(pixels); else epd_partial_refresh(pixels);
}
void board_epaper_sleep(void) { epd_sleep(); }
esp_err_t board_deep_sleep(void) {
    uint64_t mask = 0;
#if CONFIG_DEVICE_PTT_BUTTON >= 0
    mask |= 1ULL << CONFIG_DEVICE_PTT_BUTTON;
#endif
#if CONFIG_DEVICE_TOUCH_INT >= 0
    mask |= 1ULL << CONFIG_DEVICE_TOUCH_INT;
#endif
    if (mask) {
        esp_sleep_enable_ext1_wakeup(mask, ESP_EXT1_WAKEUP_ANY_LOW);
        esp_deep_sleep_start();
    }
    return ESP_ERR_NOT_SUPPORTED;
}
