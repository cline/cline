/*
 * Polled driver for CST816S / FT6336-style capacitive controllers. Both expose
 * touch count at 0x02 and X/Y (12-bit, big-endian, top nibble = flags) at
 * 0x03..0x06, so one read covers either part.
 */
#include "touch.h"

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "cline_board.h"
#include "sdkconfig.h"

static const char *TAG = "touch";
static i2c_master_dev_handle_t s_dev;
i2c_master_bus_handle_t g_i2c_bus; /* shared with the audio codec, if any */

esp_err_t touch_init(void)
{
#if CONFIG_DEVICE_TOUCH_RST >= 0
    /* FT6336 wants long reset pulses (matches Waveshare's BSP). */
    gpio_set_direction(CONFIG_DEVICE_TOUCH_RST, GPIO_MODE_OUTPUT);
    gpio_set_level(CONFIG_DEVICE_TOUCH_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(100));
    gpio_set_level(CONFIG_DEVICE_TOUCH_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(100));
    gpio_set_level(CONFIG_DEVICE_TOUCH_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(200));
#endif
    i2c_master_bus_config_t bus = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = CONFIG_DEVICE_I2C_SDA,
        .scl_io_num = CONFIG_DEVICE_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    esp_err_t err = i2c_new_master_bus(&bus, &g_i2c_bus);
    if (err != ESP_OK) return err;
    i2c_device_config_t dev = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = CONFIG_DEVICE_TOUCH_ADDR,
        .scl_speed_hz = 400000,
    };
    err = i2c_master_bus_add_device(g_i2c_bus, &dev, &s_dev);
    if (err == ESP_OK) {
        bool found = false;
        for (int i = 0; i < 5 && !found; i++) {
            found = i2c_master_probe(g_i2c_bus, CONFIG_DEVICE_TOUCH_ADDR, 50) == ESP_OK;
            if (!found) vTaskDelay(pdMS_TO_TICKS(100));
        }
        if (found) ESP_LOGI(TAG, "touch controller at 0x%02x", CONFIG_DEVICE_TOUCH_ADDR);
        else ESP_LOGW(TAG, "no touch controller at 0x%02x (check Kconfig)", CONFIG_DEVICE_TOUCH_ADDR);
    }
#if CONFIG_DEVICE_TOUCH_INT >= 0
    gpio_set_direction(CONFIG_DEVICE_TOUCH_INT, GPIO_MODE_INPUT);
    gpio_set_pull_mode(CONFIG_DEVICE_TOUCH_INT, GPIO_PULLUP_ONLY);
#endif
    return err;
}

bool touch_read(touch_point_t *out)
{
    uint8_t reg = 0x02, buf[5];
    if (i2c_master_transmit_receive(s_dev, &reg, 1, buf, sizeof(buf), 20) != ESP_OK) return false;
    uint8_t count = buf[0] & 0x0F;
    out->pressed = count > 0 && count < 3;
    if (!out->pressed) return true;
    int x = ((buf[1] & 0x0F) << 8) | buf[2];
    int y = ((buf[3] & 0x0F) << 8) | buf[4];
#if CONFIG_DEVICE_TOUCH_SWAP_XY
    int t = x; x = y; y = t;
#endif
#if CONFIG_DEVICE_TOUCH_INVERT_X
    x = board_info()->width - 1 - x;
#endif
#if CONFIG_DEVICE_TOUCH_INVERT_Y
    y = board_info()->height - 1 - y;
#endif
    out->x = x;
    out->y = y;
    return true;
}
