#pragma once
#include <stdbool.h>

#include "esp_err.h"

/* I2S microphone capture streamed to the bridge as 16 kHz s16le mono PCM.
 * The mic (and I2S clocks) only run between audio_start() and audio_stop(). */
esp_err_t audio_init(void);
/* Sends voice_start and begins streaming. False if the link is down.
 * new_task: the prompt always starts a parallel task (BOOT button). */
bool audio_start(bool new_task);
/* Stops capture; sends voice_end (or voice_cancel when cancel = true). */
void audio_stop(bool cancel);
bool audio_recording(void);
