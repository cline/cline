/*
 * SSD1681 driver for 1.54" 200x200 black/white e-paper (GDEH0154D67 /
 * Waveshare 1.54" V2 class). Full refresh clears ghosting (~2 s, flashes);
 * partial refresh is ~0.3 s and diffs against the previous frame in RAM 0x26.
 */
#include "epd.h"

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "sdkconfig.h"

static const char *TAG = "epd";
static spi_device_handle_t s_spi;
static bool s_asleep;
static bool s_partial_mode;

static void wait_busy(void)
{
    int64_t start = xTaskGetTickCount();
    while (gpio_get_level(CONFIG_PET_EPD_BUSY) == 1) {
        vTaskDelay(pdMS_TO_TICKS(5));
        if ((xTaskGetTickCount() - start) > pdMS_TO_TICKS(5000)) {
            ESP_LOGW(TAG, "busy timeout");
            return;
        }
    }
}

static void send(bool data, const uint8_t *buf, size_t len)
{
    if (len == 0) return;
    gpio_set_level(CONFIG_PET_EPD_DC, data);
    spi_transaction_t t = {.length = len * 8, .tx_buffer = buf};
    ESP_ERROR_CHECK(spi_device_polling_transmit(s_spi, &t));
}

static void cmd(uint8_t c) { send(false, &c, 1); }
static void data1(uint8_t d) { send(true, &d, 1); }

static void cmd_data(uint8_t c, const uint8_t *d, size_t n)
{
    cmd(c);
    send(true, d, n);
}

static void hw_reset(void)
{
    gpio_set_level(CONFIG_PET_EPD_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level(CONFIG_PET_EPD_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(10));
}

static void set_window(void)
{
    cmd_data(0x11, (const uint8_t[]){0x03}, 1);                 /* X+, Y+ */
    cmd_data(0x44, (const uint8_t[]){0x00, (GFX_W / 8) - 1}, 2); /* X range */
    cmd_data(0x45, (const uint8_t[]){0x00, 0x00, (GFX_H - 1) & 0xFF, (GFX_H - 1) >> 8}, 4);
    cmd_data(0x4E, (const uint8_t[]){0x00}, 1);
    cmd_data(0x4F, (const uint8_t[]){0x00, 0x00}, 2);
}

static void controller_init(void)
{
    hw_reset();
    wait_busy();
    cmd(0x12); /* SW reset */
    wait_busy();
    cmd_data(0x01, (const uint8_t[]){(GFX_H - 1) & 0xFF, (GFX_H - 1) >> 8, 0x00}, 3);
    cmd_data(0x3C, (const uint8_t[]){0x05}, 1); /* border: white */
    cmd_data(0x18, (const uint8_t[]){0x80}, 1); /* internal temp sensor */
    set_window();
    wait_busy();
    s_asleep = false;
    s_partial_mode = false;
}

void epd_init(void)
{
    gpio_config_t out = {
        .pin_bit_mask = (1ULL << CONFIG_PET_EPD_DC) | (1ULL << CONFIG_PET_EPD_RST),
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&out));
    gpio_config_t in = {.pin_bit_mask = 1ULL << CONFIG_PET_EPD_BUSY, .mode = GPIO_MODE_INPUT};
    ESP_ERROR_CHECK(gpio_config(&in));

#if CONFIG_PET_EPD_PWR >= 0
    gpio_set_direction(CONFIG_PET_EPD_PWR, GPIO_MODE_OUTPUT);
    gpio_set_level(CONFIG_PET_EPD_PWR, CONFIG_PET_EPD_PWR_ACTIVE_LEVEL);
    vTaskDelay(pdMS_TO_TICKS(20));
#endif

    spi_bus_config_t bus = {
        .mosi_io_num = CONFIG_PET_EPD_MOSI,
        .miso_io_num = -1,
        .sclk_io_num = CONFIG_PET_EPD_SCLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = GFX_BYTES + 8,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));
    spi_device_interface_config_t dev = {
        .clock_speed_hz = 10 * 1000 * 1000,
        .mode = 0,
        .spics_io_num = CONFIG_PET_EPD_CS,
        .queue_size = 1,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SPI2_HOST, &dev, &s_spi));
    controller_init();
}

static void write_ram(uint8_t reg, const uint8_t *fb)
{
    set_window();
    cmd(reg);
    /* Chunk to stay well inside the DMA transfer limit. */
    for (size_t off = 0; off < GFX_BYTES; off += 1000) {
        size_t n = GFX_BYTES - off < 1000 ? GFX_BYTES - off : 1000;
        send(true, fb + off, n);
    }
}

void epd_full_refresh(const uint8_t *fb)
{
    if (s_asleep || s_partial_mode) controller_init();
    write_ram(0x24, fb);
    write_ram(0x26, fb);
    cmd_data(0x22, (const uint8_t[]){0xF7}, 1);
    cmd(0x20);
    wait_busy();
}

void epd_partial_refresh(const uint8_t *fb)
{
    if (s_asleep) {
        /* Waking from deep sleep loses RAM; a partial diff would be garbage. */
        epd_full_refresh(fb);
        return;
    }
    if (!s_partial_mode) {
        cmd_data(0x3C, (const uint8_t[]){0x80}, 1); /* border: follow LUT */
        s_partial_mode = true;
    }
    write_ram(0x24, fb);
    cmd_data(0x22, (const uint8_t[]){0xFC}, 1);
    cmd(0x20);
    wait_busy();
    /* Keep "previous" RAM in sync so the next diff is against this frame. */
    write_ram(0x26, fb);
}

void epd_sleep(void)
{
    if (s_asleep) return;
    cmd(0x10);
    data1(0x01);
    s_asleep = true;
}
