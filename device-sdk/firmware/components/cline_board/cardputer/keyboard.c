#include "keyboard.h"
#include "keys.h"
#include "app.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"
#include <string.h>
static i2c_master_dev_handle_t keyboard;
static bool held[128];
static const char *TAG = "keyboard";
static esp_err_t read_reg(uint8_t reg, uint8_t *value) {
    return i2c_master_transmit_receive(keyboard, &reg, 1, value, 1, 20);
}
static esp_err_t write_reg(uint8_t reg, uint8_t value) {
    uint8_t bytes[] = {reg, value};
    return i2c_master_transmit(keyboard, bytes, 2, 20);
}
static void release_keys(void) {
    for (unsigned i = 1; i < 128; i++) if (held[i]) {
        cline_action_t action = cardputer_key_action(i);
        if (action == ACTION_SETUP) {
            app_event_t ev = {.type = EV_ACTION_UP, .action = ACTION_SETUP};
            app_post(&ev);
        }
        if (action == ACTION_TALK) {
            /* A lost release must cancel recording, never send a partial task. */
            app_event_t ev = {.type = EV_AUDIO_ERROR};
            strlcpy(ev.text, "Keyboard disconnected", sizeof(ev.text));
            app_post(&ev);
        }
    }
    memset(held, 0, sizeof(held));
}
esp_err_t cardputer_keyboard_init(i2c_master_bus_handle_t bus) {
    const i2c_device_config_t cfg = {.dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = 0x34, .scl_speed_hz = 400000};
    ESP_RETURN_ON_ERROR(i2c_master_bus_add_device(bus, &cfg, &keyboard), TAG, "TCA8418");
    gpio_config_t irq = {.pin_bit_mask = 1ULL << 11, .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE};
    ESP_RETURN_ON_ERROR(gpio_config(&irq), TAG, "keyboard IRQ");
    /* Enable 7 rows/8 columns, debounce and key-event interrupts. */
    ESP_RETURN_ON_ERROR(write_reg(0x1d, 0x7f), TAG, "rows");
    ESP_RETURN_ON_ERROR(write_reg(0x1e, 0xff), TAG, "columns");
    ESP_RETURN_ON_ERROR(write_reg(0x1f, 0), TAG, "columns");
    for (uint8_t reg = 0x29; reg <= 0x2b; reg++)
        ESP_RETURN_ON_ERROR(write_reg(reg, 0), TAG, "debounce");
    uint8_t value;
    for (int i = 0; i < 10; i++) ESP_RETURN_ON_ERROR(read_reg(0x04, &value), TAG, "FIFO");
    ESP_RETURN_ON_ERROR(write_reg(0x02, 0xff), TAG, "IRQ clear");
    return write_reg(0x01, 0x01);
}
void cardputer_keyboard_poll(void) {
    /* Read count even if IRQ is missed. Bound each batch to the ten-entry FIFO. */
    uint8_t count, interrupts;
    if (read_reg(0x03, &count) != ESP_OK || read_reg(0x02, &interrupts) != ESP_OK) {
        release_keys();
        return;
    }
    if (interrupts & 0x08) { /* Overflow: held key state can no longer be trusted. */
        release_keys();
        ESP_LOGW(TAG, "Keyboard FIFO overflow");
        /* Discard stale presses so an overflow cannot restart recording. */
        for (unsigned i = 0; i < 10; i++) {
            uint8_t discarded;
            if (read_reg(0x04, &discarded) != ESP_OK) break;
        }
        write_reg(0x02, interrupts);
        return;
    }
    for (unsigned i = 0; i < (count & 0x0f) && i < 10; i++) {
        uint8_t raw;
        if (read_reg(0x04, &raw) != ESP_OK) { release_keys(); break; }
        unsigned key = raw & 0x7f;
        bool down = raw & 0x80;
        cline_action_t action = cardputer_key_action(raw);
        if (!key || key > 68 || (key - 1) % 10 >= 8 || held[key] == down) continue;
        held[key] = down;
        app_event_t ev = {.type = EV_KEY, .key = {
            .down = down, .action = action,
            .ch = cardputer_key_character(raw, held[cardputer_key_at(1, 2)], held[cardputer_key_at(0, 2)])}};
        app_post(&ev);
    }
    if (interrupts) write_reg(0x02, interrupts);
}
