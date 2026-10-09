#include "cline_board.h"
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_check.h"
extern i2c_master_bus_handle_t cardputer_i2c;
static esp_codec_dev_handle_t mic;
/* ADV has no MCLK wire. ES8311 derives its clock from BCLK, as in M5Unified. */
esp_err_t board_audio_init(void) {
    i2s_chan_handle_t rx;
    i2s_chan_config_t channel = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    channel.dma_frame_num = 256;
    ESP_RETURN_ON_ERROR(i2s_new_channel(&channel, NULL, &rx), "audio", "I2S");
    i2s_std_config_t cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(16000),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {.mclk = I2S_GPIO_UNUSED, .bclk = 41, .ws = 43, .dout = I2S_GPIO_UNUSED, .din = 46},
    };
    ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(rx, &cfg), "audio", "I2S format");
    audio_codec_i2c_cfg_t control = {.port = I2C_NUM_0, .addr = ES8311_CODEC_DEFAULT_ADDR, .bus_handle = cardputer_i2c};
    const audio_codec_ctrl_if_t *ctrl = audio_codec_new_i2c_ctrl(&control);
    const audio_codec_gpio_if_t *gpio = audio_codec_new_gpio();
    es8311_codec_cfg_t codec_cfg = {.ctrl_if = ctrl, .gpio_if = gpio,
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_ADC, .pa_pin = -1, .use_mclk = false, .digital_mic = false};
    const audio_codec_if_t *codec = ctrl && gpio ? es8311_codec_new(&codec_cfg) : NULL;
    audio_codec_i2s_cfg_t data_cfg = {.port = I2S_NUM_0, .rx_handle = rx};
    const audio_codec_data_if_t *data = audio_codec_new_i2s_data(&data_cfg);
    esp_codec_dev_cfg_t dev = {.dev_type = ESP_CODEC_DEV_TYPE_IN, .codec_if = codec, .data_if = data};
    mic = codec && data ? esp_codec_dev_new(&dev) : NULL;
    return mic ? ESP_OK : ESP_FAIL;
}
bool board_audio_open(void) {
    esp_codec_dev_sample_info_t format = {.sample_rate = 16000, .channel = 2, .bits_per_sample = 16};
    if (esp_codec_dev_open(mic, &format) != ESP_CODEC_DEV_OK) return false;
    return esp_codec_dev_set_in_gain(mic, 24) == ESP_CODEC_DEV_OK;
}
size_t board_audio_read(int16_t *pcm, size_t capacity) {
    int16_t stereo[512];
    size_t n = capacity < 256 ? capacity : 256;
    if (!n || esp_codec_dev_read(mic, stereo, n * 4) != ESP_CODEC_DEV_OK) return 0;
    for (size_t i = 0; i < n; i++) pcm[i] = stereo[i * 2];
    return n;
}
void board_audio_close(void) { esp_codec_dev_close(mic); }
