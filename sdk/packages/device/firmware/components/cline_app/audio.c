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
#include "esp_log.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "net.h"
#include "protocol.h"
#include "sdkconfig.h"

#include "cline_board.h"
#define SAMPLE_RATE 16000
#define FRAME_SAMPLES 1024
#define MAX_SAMPLES (CONFIG_DEVICE_MAX_RECORDING_S * SAMPLE_RATE)
static const char *TAG = "audio";
static TaskHandle_t s_task;
static volatile bool s_recording, s_cancel, s_active;

esp_err_t audio_init(void) { return board_audio_init(); }

static void audio_error(const char *text) {
    app_event_t ev = {.type = EV_AUDIO_ERROR};
    strlcpy(ev.text, text, sizeof(ev.text));
    app_post(&ev);
}

static void audio_task(void *arg)
{
    _Alignas(int16_t) static uint8_t frame[2 + FRAME_SAMPLES * 2];
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        uint16_t seq = 0;
        size_t samples = 0;
        int dropped = 0;
        esp_wifi_set_ps(WIFI_PS_NONE);
        bool opened = board_audio_open();
        if (!opened) {
            ESP_LOGE(TAG, "mic open failed");
            s_cancel = true;
            audio_error("Microphone unavailable");
        }
        while (opened && s_recording) {
            size_t got = board_audio_read((int16_t *)(frame + 2), FRAME_SAMPLES);
            if (got == 0) {
                s_cancel = true;
                audio_error("Microphone read failed");
                break;
            }
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
            samples += got;
            if (samples >= MAX_SAMPLES) {
                app_event_t ev = {.type = EV_AUDIO_DONE};
                app_post(&ev);
                break;
            }
        }
        board_audio_close();
        esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
        s_recording = false;
        protocol_send_simple(s_cancel ? "voice_cancel" : "voice_end");
        s_active = false;
        ESP_LOGI(TAG, "recording %s: %u frames, %d dropped", s_cancel ? "cancelled" : "sent", seq, dropped);
    }
}

bool audio_start(bool new_task)
{
    if (s_active || !net_link_up()) return false;
    if (!s_task && xTaskCreatePinnedToCore(audio_task, "audio", 4096, NULL, 6, &s_task, 1) != pdPASS) return false;
    if (!protocol_send_voice_start(new_task)) return false;
    s_cancel = false;
    s_active = s_recording = true;
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
