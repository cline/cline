#include "cline_board_color.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lvgl.h"
#include <stdlib.h>

#define WIDTH 240
#define HEIGHT 135
#define BUFFER_PIXELS (WIDTH * 12)
static SemaphoreHandle_t lock;
static esp_lcd_panel_handle_t panel;
static const char *TAG = "display";
static uint32_t tick(void) { return (uint32_t)(esp_timer_get_time() / 1000); }
static bool flush_done(esp_lcd_panel_io_handle_t io, esp_lcd_panel_io_event_data_t *ev, void *ctx) {
    lv_display_flush_ready(ctx);
    return false;
}
static void flush(lv_display_t *display, const lv_area_t *area, uint8_t *pixels) {
    lv_draw_sw_rgb565_swap(pixels, (area->x2 - area->x1 + 1) * (area->y2 - area->y1 + 1));
    if (esp_lcd_panel_draw_bitmap(panel, area->x1, area->y1, area->x2 + 1, area->y2 + 1, pixels) != ESP_OK)
        lv_display_flush_ready(display);
}
static void display_task(void *arg) {
    for (;;) {
        if (board_color_lock()) { lv_timer_handler(); board_color_unlock(); }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}
esp_err_t board_color_init(void) {
    lock = xSemaphoreCreateMutex();
    if (!lock) return ESP_ERR_NO_MEM;
    const spi_bus_config_t spi = {.sclk_io_num = 36, .mosi_io_num = 35, .miso_io_num = -1,
        .quadwp_io_num = -1, .quadhd_io_num = -1, .max_transfer_sz = BUFFER_PIXELS * 2};
    ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI3_HOST, &spi, SPI_DMA_CH_AUTO), TAG, "SPI");
    esp_lcd_panel_io_handle_t io;
    const esp_lcd_panel_io_spi_config_t io_cfg = {.dc_gpio_num = 34, .cs_gpio_num = 37,
        .pclk_hz = 40000000, .lcd_cmd_bits = 8, .lcd_param_bits = 8, .trans_queue_depth = 4};
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi(SPI3_HOST, &io_cfg, &io), TAG, "panel IO");
    const esp_lcd_panel_dev_config_t panel_cfg = {.reset_gpio_num = 33,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB, .bits_per_pixel = 16};
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_st7789(io, &panel_cfg, &panel), TAG, "ST7789");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(panel), TAG, "reset");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(panel), TAG, "init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_invert_color(panel, true), TAG, "invert");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_swap_xy(panel, true), TAG, "landscape");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_mirror(panel, true, false), TAG, "mirror");
    /* Native 135x240 window is at (52,40); rotation 1 uses (40,53). */
    ESP_RETURN_ON_ERROR(esp_lcd_panel_set_gap(panel, 40, 53), TAG, "window");
    gpio_config_t backlight = {.pin_bit_mask = 1ULL << 38, .mode = GPIO_MODE_OUTPUT};
    ESP_RETURN_ON_ERROR(gpio_config(&backlight), TAG, "backlight");
    /* Start with the backlight off during panel initialization. */
    gpio_set_level(38, 0);
    ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(panel, true), TAG, "display on");
    lv_init();
    lv_tick_set_cb(tick);
    lv_display_t *display = lv_display_create(WIDTH, HEIGHT);
    if (!display) return ESP_ERR_NO_MEM;
    void *a = heap_caps_malloc(BUFFER_PIXELS * 2, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    void *b = heap_caps_malloc(BUFFER_PIXELS * 2, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    if (!a || !b) { free(a); free(b); return ESP_ERR_NO_MEM; }
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(display, a, b, BUFFER_PIXELS * 2, LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(display, flush);
    const esp_lcd_panel_io_callbacks_t callbacks = {.on_color_trans_done = flush_done};
    ESP_RETURN_ON_ERROR(esp_lcd_panel_io_register_event_callbacks(io, &callbacks, display), TAG, "flush callback");
    if (xTaskCreatePinnedToCore(display_task, "lcd", 4096, NULL, 4, NULL, 1) != pdPASS) return ESP_ERR_NO_MEM;
    gpio_set_level(38, 1);
    return ESP_OK;
}
bool board_color_lock(void) { return xSemaphoreTake(lock, portMAX_DELAY) == pdTRUE; }
void board_color_unlock(void) { xSemaphoreGive(lock); }
void board_color_sleep(bool sleep) {
    if (!board_color_lock()) return;
    gpio_set_level(38, !sleep);
    /* Backlight-off sleep avoids resetting the panel while DMA is active. */
    board_color_unlock();
}
