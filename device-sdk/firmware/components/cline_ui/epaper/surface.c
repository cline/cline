#include "cline_surface.h"
#include "cline_board_epaper.h"
#include "gfx.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>

static uint8_t previous[GFX_BYTES];
static bool has_previous;
static unsigned partials;
#define CONTROLS_Y 142
#define TALK_Y 168

esp_err_t surface_init(void) { board_epaper_init(); return ESP_OK; }
uint32_t surface_frame_period(mood_t mood) {
    switch (mood) {
    case MOOD_WORKING: return 1000 / CONFIG_DEVICE_WORK_FPS;
    case MOOD_WAITING: case MOOD_DONE: return 500;
    case MOOD_IDLE: return 2500;
    default: return 0;
    }
}
static void button(int x, int y, int w, int h, const char *label) {
    gfx_rect(x, y, w, h);
    gfx_text(x + (w - gfx_text_width(label, 1)) / 2, y + (h - 7) / 2, label, 1, false);
}
void surface_render(const cline_view_t *v, bool full) {
    gfx_clear();
    char counts[40];
    snprintf(counts, sizeof(counts), "%u active - %u today", v->active, v->today);
    gfx_text_centered(3, counts, 1);
    gfx_rect(3, 15, 194, 37);
    gfx_text_wrapped(7, 20, 186, v->speech, 3);
    gfx_hline(96, 53, 8);
    const animation_t *anim = gfx_animation(v->mood);
    const sprite_t *spr = anim->frames[v->frame % anim->count];
    /* Existing artwork is 96 px. Crop its blank margin rather than shrinking
     * the avatar; the speech and controls have fixed regions on this panel. */
    gfx_sprite(spr, (GFX_W - spr->w) / 2, 48, 1);
    if (v->connected) {
        if (v->approval || v->voice_pending) {
            button(0, CONTROLS_Y, 99, 58, v->approval ? "APPROVE" : "CANCEL");
            button(101, CONTROLS_Y, 99, 58, v->approval ? "DENY" : "SEND");
        } else {
            button(4, CONTROLS_Y, 90, 24, "+ NEW");
            if (v->running) button(106, CONTROLS_Y, 90, 24, "STOP");
            if (v->mic) button(4, TALK_Y, 192, 32, v->recording ? "Release to send" : "Hold to talk");
        }
    }
    if (has_previous && !full && memcmp(previous, gfx_fb, GFX_BYTES) == 0) return;
    full = full || !has_previous || partials >= CONFIG_DEVICE_FULL_REFRESH_EVERY;
    board_epaper_refresh(gfx_fb, full);
    partials = full ? 0 : partials + 1;
    memcpy(previous, gfx_fb, GFX_BYTES);
    has_previous = true;
}
cline_action_t surface_hit_test(const cline_view_t *v, int x, int y) {
    if (x < 0 || x >= 200 || y < 0 || y >= 200) return ACTION_NONE;
    if (!v->connected) return ACTION_STATS; /* long hold enters provisioning */
    if (y >= CONTROLS_Y && (v->approval || v->voice_pending)) {
        if (v->approval) return x < 100 ? ACTION_APPROVE : ACTION_DENY;
        return x < 100 ? ACTION_VOICE_CANCEL : ACTION_VOICE_CONFIRM;
    }
    if (y >= TALK_Y) return v->mic ? ACTION_TALK : ACTION_NONE;
    if (y >= CONTROLS_Y) return x < 100 ? ACTION_NEW : v->running ? ACTION_STOP : ACTION_NONE;
    return ACTION_STATS;
}
void surface_sleep(bool sleep) { if (sleep) board_epaper_sleep(); }
