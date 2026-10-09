#include "cline_board.h"
#include "app.h"
#include "driver/i2c_master.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "keyboard.h"

/* K132-Adv: ES8311 and TCA8418 share SDA8/SCL9. See M5Stack's ADV pin map. */
i2c_master_bus_handle_t cardputer_i2c;
static const cline_board_info_t info = {"M5Stack Cardputer ADV", 240, 135, false, false, true};
const cline_board_info_t *board_info(void) { return &info; }
esp_err_t board_init(void) {
    const i2c_master_bus_config_t cfg = {.i2c_port = I2C_NUM_0, .sda_io_num = 8, .scl_io_num = 9,
        .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7, .flags.enable_internal_pullup = true};
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&cfg, &cardputer_i2c), "cardputer", "I2C");
    return cardputer_keyboard_init(cardputer_i2c);
}
void board_poll_input(void) { cardputer_keyboard_poll(); }
/* Display sleep keeps Wi-Fi alive; a keyboard event wakes the application. */
esp_err_t board_deep_sleep(void) { return ESP_ERR_NOT_SUPPORTED; }
