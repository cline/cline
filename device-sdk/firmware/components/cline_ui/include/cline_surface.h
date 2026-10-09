#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "cline_assets.h"
#include "esp_err.h"

#include "cline_input.h"
typedef struct {
    mood_t mood;
    uint32_t frame;
    uint16_t active, today;
    bool connected, recording, approval, voice_pending, mic, running, home;
    bool typing, submitting;
    char draft[CLINE_PROMPT_MAX + 1];
    char speech[256];
} cline_view_t;
/* Renderers own geometry, animation cadence and refresh policy. Hit testing
 * returns semantic actions, so application behavior is independent of pixels. */
esp_err_t surface_init(void);
void surface_render(const cline_view_t *view, bool full);
cline_action_t surface_hit_test(const cline_view_t *view, int x, int y);
uint32_t surface_frame_period(mood_t mood);
void surface_sleep(bool sleep);
