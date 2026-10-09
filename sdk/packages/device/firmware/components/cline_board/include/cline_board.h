#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

typedef struct {
    const char *name;
    uint16_t width, height;
    bool round, touch, microphone;
} cline_board_info_t;
/* Board selection is resolved at build time. Application code never uses pins
 * or codec/display handles. Microphone samples are always 16 kHz s16 mono. */
const cline_board_info_t *board_info(void);
esp_err_t board_init(void);
void board_poll_input(void);
esp_err_t board_deep_sleep(void);
esp_err_t board_audio_init(void);
bool board_audio_open(void);
size_t board_audio_read(int16_t *pcm, size_t capacity);
void board_audio_close(void);
