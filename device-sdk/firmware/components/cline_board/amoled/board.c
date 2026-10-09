#include "cline_board.h"
#include "cline_board_color.h"
#include "app.h"
#include "bsp/esp-bsp.h"
#include "bsp/touch.h"
#include "esp_check.h"
#include "esp_lcd_panel_io.h"
#include "esp_lv_adapter.h"
#include "freertos/task.h"
#include "driver/i2c_master.h"

static const cline_board_info_t info = {"Waveshare AMOLED 1.75C", BSP_LCD_H_RES, BSP_LCD_V_RES, true, true, true};
static esp_codec_dev_handle_t mic;
static esp_lcd_panel_io_handle_t panel_io;
static const char *TAG = "board";
/* AXP2101 rails from Waveshare's 01_AXP2101 example: DCDC1 powers
 * VCC3V3 and ALDO1 powers the audio codecs. The BSP only initializes I2C. */
static esp_err_t power_init(void) {
    i2c_master_dev_handle_t pmu;
    const i2c_device_config_t cfg = {.dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = 0x34, .scl_speed_hz = 400000};
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(bsp_i2c_get_handle(), &cfg, &pmu), TAG, "PMU");
    const struct { uint8_t reg, mask, value; } setup[] = {
        {0x82, 0x1f, (3300 - 1500) / 100}, /* DCDC1: 3.3 V */
        {0x80, 0x01, 0x01},               /* DCDC1 enabled */
        {0x92, 0x1f, (3300 - 500) / 100},  /* ALDO1: 3.3 V */
        {0x90, 0x01, 0x01},               /* ALDO1 enabled */
    };
    esp_err_t err = ESP_OK;
    for (unsigned i = 0; i < sizeof(setup) / sizeof(setup[0]); i++) {
        uint8_t value;
        err = i2c_master_transmit_receive(pmu, &setup[i].reg, 1, &value, 1, 50);
        if (err != ESP_OK) break;
        uint8_t bytes[] = {setup[i].reg, (value & ~setup[i].mask) | setup[i].value};
        err = i2c_master_transmit(pmu, bytes, sizeof(bytes), 50);
        if (err != ESP_OK) break;
    }
    i2c_master_bus_rm_device(pmu);
    if (err == ESP_OK) vTaskDelay(pdMS_TO_TICKS(20));
    return err;
}
const cline_board_info_t *board_info(void) { return &info; }
esp_err_t board_init(void) {
    ESP_RETURN_ON_ERROR(bsp_i2c_init(), TAG, "I2C");
    ESP_RETURN_ON_ERROR(power_init(), TAG, "power rails");
    gpio_config_t button = {.pin_bit_mask = 1ULL << GPIO_NUM_0, .mode = GPIO_MODE_INPUT,
                            .pull_up_en = GPIO_PULLUP_ENABLE};
    return gpio_config(&button);
}
void board_poll_input(void) {
    static bool pressed;
    bool down = gpio_get_level(GPIO_NUM_0) == 0;
    if (down != pressed) {
        app_event_t ev = {.type = down ? EV_ACTION_DOWN : EV_ACTION_UP, .action = ACTION_TALK_NEW};
        app_post(&ev);
        pressed = down;
    }
}
/* Keep the transport alive during display sleep. Deep sleep on this board is
 * deliberately disabled: the PMU owns the power key and touch wake requires
 * a different electrical wake policy than e-paper. */
esp_err_t board_deep_sleep(void) { return ESP_ERR_NOT_SUPPORTED; }

static void round_area(lv_event_t *ev) {
    lv_area_t *a = lv_event_get_param(ev);
    a->x1 &= ~1; a->y1 &= ~1; a->x2 |= 1; a->y2 |= 1;
}
esp_err_t board_color_init(void) {
    esp_lv_adapter_config_t cfg = ESP_LV_ADAPTER_DEFAULT_CONFIG();
    cfg.task_core_id = 1;
    ESP_RETURN_ON_ERROR(esp_lv_adapter_init(&cfg), TAG, "LVGL adapter");
    esp_lcd_panel_handle_t panel;
    const bsp_display_config_t panel_cfg = {.max_transfer_sz = BSP_LCD_H_RES * 8 * 2};
    ESP_RETURN_ON_ERROR(bsp_display_new(&panel_cfg, &panel, &panel_io), TAG, "panel");
    /* Small permanent internal DMA buffers avoid allocating a PSRAM bounce
     * buffer on every flush while Wi-Fi and microphone capture are active. */
    const esp_lv_adapter_display_config_t display_cfg = {
        .panel = panel, .panel_io = panel_io,
        .profile = {.interface = ESP_LV_ADAPTER_PANEL_IF_OTHER,
                    .rotation = ESP_LV_ADAPTER_ROTATE_0,
                    .hor_res = BSP_LCD_H_RES, .ver_res = BSP_LCD_V_RES, .buffer_height = 8,
                    .use_psram = false, .require_double_buffer = true},
        .tear_avoid_mode = ESP_LV_ADAPTER_TEAR_AVOID_MODE_NONE,
    };
    lv_display_t *display = esp_lv_adapter_register_display(&display_cfg);
    ESP_RETURN_ON_FALSE(display, ESP_ERR_NO_MEM, TAG, "display buffers");
    lv_display_add_event_cb(display, round_area, LV_EVENT_INVALIDATE_AREA, NULL);
    const bsp_display_cfg_t touch_cfg = {.touch_flags = {.mirror_x = 1, .mirror_y = 1}};
    esp_lcd_touch_handle_t touch;
    ESP_RETURN_ON_ERROR(bsp_touch_new(&touch_cfg, &touch), TAG, "touch");
    const esp_lv_adapter_touch_config_t input_cfg = ESP_LV_ADAPTER_TOUCH_DEFAULT_CONFIG(display, touch);
    ESP_RETURN_ON_FALSE(esp_lv_adapter_register_touch(&input_cfg), ESP_FAIL, TAG, "touch input");
    ESP_RETURN_ON_ERROR(esp_lv_adapter_start(), TAG, "display task");
    return ESP_OK;
}
bool board_color_lock(void) { return esp_lv_adapter_lock(-1) == ESP_OK; }
void board_color_unlock(void) { esp_lv_adapter_unlock(); }
void board_color_sleep(bool sleep) {
    if (esp_lv_adapter_pause(-1) != ESP_OK) return;
    /* SLPIN keeps touch scanning so a tap can wake without a shared reset. */
    esp_lcd_panel_io_tx_param(panel_io, (0x02 << 24) | ((sleep ? 0x10 : 0x11) << 8), NULL, 0);
    vTaskDelay(pdMS_TO_TICKS(120));
    esp_lv_adapter_resume();
}
esp_err_t board_audio_init(void) {
    /* Initialize both codecs: they share the BSP's duplex I2S data interface.
     * The output device remains closed, so no speaker audio is played. */
    esp_codec_dev_handle_t speaker = bsp_audio_codec_speaker_init();
    mic = bsp_audio_codec_microphone_init();
    return speaker && mic ? ESP_OK : ESP_FAIL;
}
bool board_audio_open(void) {
    esp_codec_dev_sample_info_t format = {.sample_rate = 16000, .channel = 2, .bits_per_sample = 16};
    if (esp_codec_dev_open(mic, &format) != ESP_CODEC_DEV_OK) return false;
    return esp_codec_dev_set_in_gain(mic, 30.0f) == ESP_CODEC_DEV_OK;
}
size_t board_audio_read(int16_t *pcm, size_t capacity) {
    int16_t stereo[512];
    size_t samples = capacity < 256 ? capacity : 256;
    if (esp_codec_dev_read(mic, stereo, samples * 4) != ESP_CODEC_DEV_OK) return 0;
    for (size_t i = 0; i < samples; i++) pcm[i] = ((int32_t)stereo[i * 2] + stereo[i * 2 + 1]) / 2;
    return samples;
}
void board_audio_close(void) { esp_codec_dev_close(mic); }
