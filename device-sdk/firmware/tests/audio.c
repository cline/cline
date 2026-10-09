#include "host.h"
#include "freertos/task.h"
#include "../components/cline_app/audio.c"
#include <assert.h>
#include <setjmp.h>

QueueHandle_t g_app_queue = (void *)1;
uint32_t test_clock;
static jmp_buf finish;
static int scenario, frames, samples, closes;
static bool linked = true;
static app_ev_type_t last_event;
static char sent[40];
int xQueueSend(QueueHandle_t q, const void *ev, TickType_t wait) {
    last_event = ((const app_event_t *)ev)->type;
    return pdTRUE;
}
unsigned ulTaskNotifyTake(int clear, TickType_t wait) {
    if (!s_active) longjmp(finish, 1);
    return 1;
}
esp_err_t board_audio_init(void) { return ESP_OK; }
bool board_audio_open(void) { return scenario != 1; }
size_t board_audio_read(int16_t *pcm, size_t capacity) {
    if (scenario == 2) return 0;
    assert(capacity >= 256);
    for (int i = 0; i < 256; i++) pcm[i] = i;
    return 256;
}
void board_audio_close(void) { closes++; }
bool net_link_up(void) { return linked; }
bool net_send_binary(const uint8_t *data, size_t len) {
    const uint8_t *p = data;
    assert(len == 2 + 256 * 2);
    assert((p[0] | p[1] << 8) == frames);
    assert(p[2] == 0 && p[4] == 1); /* s16le mono sample encoding */
    frames++; samples += (len - 2) / 2;
    if (scenario == 3) { linked = false; return false; }
    return true;
}
bool protocol_send_voice_start(bool new_task) { return true; }
bool protocol_send_simple(const char *type) {
    /* Closing a recording must finish before another start is admitted. */
    assert(s_active);
    strlcpy(sent, type, sizeof(sent));
    return true;
}
static void run(int mode) {
    scenario = mode; frames = samples = closes = 0; linked = true;
    assert(audio_start(true));
    if (setjmp(finish) == 0) audio_task(NULL);
    assert(!audio_recording() && !s_active && closes == 1);
}
int main(void) {
    /* 256-sample boards get a full 30 seconds, not a 1024-frame limit. */
    run(0);
    assert(samples == 16000 * CONFIG_DEVICE_MAX_RECORDING_S && frames == 1875);
    assert(last_event == EV_AUDIO_DONE && strcmp(sent, "voice_end") == 0);
    run(1); assert(frames == 0 && last_event == EV_AUDIO_ERROR && strcmp(sent, "voice_cancel") == 0);
    run(2); assert(frames == 0 && last_event == EV_AUDIO_ERROR && strcmp(sent, "voice_cancel") == 0);
    run(3); assert(frames == 1 && strcmp(sent, "voice_cancel") == 0);
    linked = true;
    assert(audio_start(false)); audio_stop(false);
    assert(!audio_start(true)); /* previous capture has not closed yet */
    if (setjmp(finish) == 0) audio_task(NULL);
    assert(!s_active && strcmp(sent, "voice_end") == 0);
    return 0;
}
