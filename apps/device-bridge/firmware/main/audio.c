/*
 * Capture runs in its own task so a slow Wi-Fi send never stalls touch or
 * display handling. Each WebSocket binary frame is:
 *   [u16 LE sequence][1024 x s16le mono samples]  (= 64 ms of audio)
 *
 * Mic backends (Kconfig "Microphone"):
 *   ES8311  codec on I2S + I2C control (Waveshare ESP32-S3-ePaper-1.54)
 *   STD     plain I2S MEMS mic (e.g. INMP441), 24-bit in a 32-bit slot
 *   PDM     PDM MEMS mic
 */
#include "audio.h"

#include <string.h>

#include "app.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "net.h"
#include "protocol.h"
#include "sdkconfig.h"

#if CONFIG_PET_MIC_ES8311
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#elif CONFIG_PET_MIC_PDM
#include "driver/i2s_pdm.h"
#else
#include "driver/i2s_std.h"
#endif

static const char *TAG = "audio";

#define SAMPLE_RATE 16000
#define FRAME_SAMPLES 1024
#define MAX_FRAMES ((CONFIG_PET_MAX_RECORDING_S * SAMPLE_RATE) / FRAME_SAMPLES)

static i2s_chan_handle_t s_rx;
static TaskHandle_t s_task;
static volatile bool s_recording;
static volatile bool s_cancel;

#if CONFIG_PET_MIC_ES8311
extern i2c_master_bus_handle_t g_i2c_bus; /* created by touch_init() */
static esp_codec_dev_handle_t s_codec;
#endif

/* Power the codec/mic rail only while recording (privacy + battery). */
static void mic_power(bool on)
{
#if CONFIG_PET_AUDIO_PWR >= 0
    gpio_set_level(CONFIG_PET_AUDIO_PWR, on ? CONFIG_PET_AUDIO_PWR_ACTIVE_LEVEL
                                            : !CONFIG_PET_AUDIO_PWR_ACTIVE_LEVEL);
    if (on) vTaskDelay(pdMS_TO_TICKS(20));
#else
    (void)on;
#endif
}

esp_err_t audio_init(void)
{
#if CONFIG_PET_AUDIO_PWR >= 0
    gpio_config_t pwr = {.pin_bit_mask = 1ULL << CONFIG_PET_AUDIO_PWR, .mode = GPIO_MODE_OUTPUT};
    gpio_config(&pwr);
#endif
#if CONFIG_PET_SPEAKER_PA >= 0
    /* Keep the speaker amplifier off; the pet never plays audio. */
    gpio_config_t pa = {.pin_bit_mask = 1ULL << CONFIG_PET_SPEAKER_PA, .mode = GPIO_MODE_OUTPUT};
    gpio_config(&pa);
    gpio_set_level(CONFIG_PET_SPEAKER_PA, 0);
#endif

    i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    chan.dma_frame_num = FRAME_SAMPLES / 2;
    chan.auto_clear = true;
    ESP_ERROR_CHECK(i2s_new_channel(&chan, NULL, &s_rx));

#if CONFIG_PET_MIC_ES8311
    i2s_std_config_t cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = CONFIG_PET_MIC_MCLK,
            .bclk = CONFIG_PET_MIC_SCK,
            .ws = CONFIG_PET_MIC_WS,
            .dout = I2S_GPIO_UNUSED,
            .din = CONFIG_PET_MIC_SD,
        },
    };
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(s_rx, &cfg));

    /* The codec must be powered to answer on I2C during setup. */
    mic_power(true);
    audio_codec_i2c_cfg_t i2c_cfg = {
        .port = I2C_NUM_0,
        .addr = ES8311_CODEC_DEFAULT_ADDR,
        .bus_handle = g_i2c_bus,
    };
    const audio_codec_ctrl_if_t *ctrl = audio_codec_new_i2c_ctrl(&i2c_cfg);
    const audio_codec_gpio_if_t *gpio = audio_codec_new_gpio();
    es8311_codec_cfg_t es = {
        .ctrl_if = ctrl,
        .gpio_if = gpio,
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_ADC,
        .pa_pin = -1,
        .use_mclk = true,
        .digital_mic = false,
    };
    const audio_codec_if_t *codec = es8311_codec_new(&es);
    audio_codec_i2s_cfg_t i2s_cfg = {.port = I2S_NUM_0, .rx_handle = s_rx, .tx_handle = NULL};
    const audio_codec_data_if_t *data = audio_codec_new_i2s_data(&i2s_cfg);
    esp_codec_dev_cfg_t dev = {.dev_type = ESP_CODEC_DEV_TYPE_IN, .codec_if = codec, .data_if = data};
    s_codec = (ctrl && codec && data) ? esp_codec_dev_new(&dev) : NULL;
    mic_power(false);
    if (!s_codec) {
        ESP_LOGE(TAG, "ES8311 init failed");
        return ESP_FAIL;
    }
#elif CONFIG_PET_MIC_PDM
    i2s_pdm_rx_config_t cfg = {
        .clk_cfg = I2S_PDM_RX_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
        .slot_cfg = I2S_PDM_RX_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {.clk = CONFIG_PET_MIC_SCK, .din = CONFIG_PET_MIC_SD},
    };
    ESP_ERROR_CHECK(i2s_channel_init_pdm_rx_mode(s_rx, &cfg));
#else
    i2s_std_config_t cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = CONFIG_PET_MIC_MCLK,
            .bclk = CONFIG_PET_MIC_SCK,
            .ws = CONFIG_PET_MIC_WS,
            .dout = I2S_GPIO_UNUSED,
            .din = CONFIG_PET_MIC_SD,
        },
    };
#if CONFIG_PET_MIC_RIGHT_SLOT
    cfg.slot_cfg.slot_mask = I2S_STD_SLOT_RIGHT;
#else
    cfg.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
#endif
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(s_rx, &cfg));
#endif
    return ESP_OK;
}

static bool capture_open(void)
{
    /* Modem sleep delays sends by up to a DTIM interval; keep the radio awake
     * while streaming ~32 KB/s so sends never stall long enough to time out. */
    esp_wifi_set_ps(WIFI_PS_NONE);
    mic_power(true);
#if CONFIG_PET_MIC_ES8311
    esp_codec_dev_sample_info_t fs = {.sample_rate = SAMPLE_RATE, .channel = 2, .bits_per_sample = 16};
    if (esp_codec_dev_open(s_codec, &fs) != ESP_CODEC_DEV_OK) return false;
    esp_codec_dev_set_in_gain(s_codec, CONFIG_PET_MIC_GAIN_DB);
    return true;
#else
    return i2s_channel_enable(s_rx) == ESP_OK;
#endif
}

static void capture_close(void)
{
#if CONFIG_PET_MIC_ES8311
    esp_codec_dev_close(s_codec);
#else
    i2s_channel_disable(s_rx);
#endif
    mic_power(false);
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
}

/* Fill `pcm` with up to FRAME_SAMPLES mono samples; returns the count. */
static size_t capture_read(int16_t *pcm)
{
#if CONFIG_PET_MIC_ES8311
    static int16_t stereo[FRAME_SAMPLES * 2];
    if (esp_codec_dev_read(s_codec, stereo, sizeof(stereo)) != ESP_CODEC_DEV_OK) return 0;
    for (size_t i = 0; i < FRAME_SAMPLES; i++) pcm[i] = stereo[i * 2]; /* mic is on the left slot */
    return FRAME_SAMPLES;
#elif CONFIG_PET_MIC_PDM
    size_t got = 0;
    if (i2s_channel_read(s_rx, pcm, FRAME_SAMPLES * 2, &got, pdMS_TO_TICKS(200)) != ESP_OK) return 0;
    return got / 2;
#else
    static int32_t raw[FRAME_SAMPLES];
    size_t got = 0;
    if (i2s_channel_read(s_rx, raw, sizeof(raw), &got, pdMS_TO_TICKS(200)) != ESP_OK) return 0;
    got /= 4;
    /* 24-bit MEMS data sits in the top of a 32-bit slot. */
    for (size_t i = 0; i < got; i++) {
        int32_t s = raw[i] >> (16 - CONFIG_PET_MIC_GAIN_SHIFT);
        pcm[i] = s > INT16_MAX ? INT16_MAX : s < INT16_MIN ? INT16_MIN : (int16_t)s;
    }
    return got;
#endif
}

static void audio_task(void *arg)
{
    static uint8_t frame[2 + FRAME_SAMPLES * 2];
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        uint16_t seq = 0;
        int dropped = 0;
        bool opened = capture_open();
        if (!opened) {
            ESP_LOGE(TAG, "mic open failed");
            s_cancel = true;
        }
        while (opened && s_recording) {
            size_t got = capture_read((int16_t *)(frame + 2));
            if (got == 0) continue;
            frame[0] = seq & 0xFF;
            frame[1] = seq >> 8;
            if (!net_send_binary(frame, 2 + got * 2)) {
                /* The link is gone (the client drops it on a failed send);
                 * stop instead of retrying into a dead socket. */
                dropped++;
                if (!net_link_up()) {
                    s_cancel = true;
                    break;
                }
            }
            seq++;
            if (seq >= MAX_FRAMES) {
                app_event_t ev = {.type = EV_AUDIO_DONE};
                app_post(&ev);
                break;
            }
        }
        if (opened) capture_close();
        s_recording = false;
        protocol_send_simple(s_cancel ? "voice_cancel" : "voice_end");
        ESP_LOGI(TAG, "recording %s: %u frames, %d dropped", s_cancel ? "cancelled" : "sent", seq, dropped);
    }
}

bool audio_start(bool new_task)
{
    if (s_recording || !net_link_up()) return false;
    if (!s_task) xTaskCreatePinnedToCore(audio_task, "audio", 4096, NULL, 6, &s_task, 1);
    if (!protocol_send_voice_start(new_task)) return false;
    s_cancel = false;
    s_recording = true;
    xTaskNotifyGive(s_task);
    return true;
}

void audio_stop(bool cancel)
{
    if (!s_recording) return;
    s_cancel = cancel;
    s_recording = false; /* the task finishes its frame, then sends voice_end */
}

bool audio_recording(void) { return s_recording; }
