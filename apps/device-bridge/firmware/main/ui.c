/*
 * The UI task owns the display. It folds bridge messages, touch and button
 * events into one view model, renders it into the framebuffer and refreshes
 * the panel only when pixels actually change:
 *   - animated moods step at 2-3 fps with partial refreshes,
 *   - every CONFIG_PET_FULL_REFRESH_EVERY partials a full refresh clears ghosting,
 *   - while asleep nothing is refreshed at all.
 */
#include "ui.h"

#include <stdio.h>
#include <string.h>

#include "app.h"
#include "audio.h"
#include "driver/gpio.h"
#include "epd.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_wifi.h"
#include "gfx.h"
#include "net.h"
#include "protocol.h"
#include "sdkconfig.h"

static const char *TAG = "ui";

#define SPRITE_SCALE 3
#define HEADER_H 15
#define PET_Y 18
#define BTN_Y 158
#define BTN_H 42
#define MIC_X 150
#define MIN_PTT_MS 300
#define ABORT_HOLD_MS 2000
#define SETUP_HOLD_MS 8000
#define OVERLAY_MS 4000

typedef enum { OV_NONE, OV_STATS, OV_VOICE_PENDING, OV_NOTICE } overlay_t;

static struct {
    pet_msg_t pet;
    bool link_up;
    char link_text[48];
    bool setup_mode;
    char setup_text[96];

    overlay_t overlay;
    uint32_t overlay_until;
    char overlay_text[128];
    bool pending_new_task;
    uint16_t stats_sessions, stats_today;
    char sent_approval[72]; /* approval we already answered; hides buttons */

    uint32_t frame;
    uint32_t last_activity;
    bool sleeping;
    uint32_t slept_at;
    int partials;

    bool touching;
    uint32_t touch_down_at;
    int16_t touch_x, touch_y;
    bool ptt_touch;
    bool ptt_button;
    uint32_t ptt_started;
    bool hold_fired;
    bool abort_fired;
} s;

static uint8_t s_prev_fb[GFX_BYTES];
static bool s_has_prev;

static uint32_t now_ms(void) { return xTaskGetTickCount() * portTICK_PERIOD_MS; }

/* ---- View model --------------------------------------------------------- */

static mood_t current_mood(void)
{
    if (s.sleeping) return MOOD_SLEEPING;
    if (s.setup_mode || !s.link_up) return MOOD_OFFLINE;
    if (audio_recording()) return MOOD_LISTENING;
    switch (s.pet.state) {
    case PET_WORKING: return MOOD_WORKING;
    case PET_WAITING: return MOOD_WAITING;
    case PET_LISTENING: return MOOD_LISTENING;
    case PET_THINKING: return MOOD_THINKING;
    case PET_DONE: return MOOD_CELEBRATE;
    case PET_ERROR: return MOOD_ERROR;
    case PET_OFFLINE: return MOOD_OFFLINE;
    default: return MOOD_IDLE;
    }
}

static bool approval_buttons_visible(void)
{
    return current_mood() == MOOD_WAITING && s.pet.approval_id[0] &&
           strcmp(s.pet.approval_id, s.sent_approval) != 0;
}

static bool voice_buttons_visible(void) { return s.overlay == OV_VOICE_PENDING; }

static bool mic_visible(void)
{
    mood_t m = current_mood();
    return s.link_up && !approval_buttons_visible() && !voice_buttons_visible() &&
           (m == MOOD_IDLE || m == MOOD_WORKING || m == MOOD_CELEBRATE || m == MOOD_ERROR ||
            m == MOOD_LISTENING);
}

/* Frame period for the current mood; 0 = static (no timed redraws). */
static uint32_t frame_period_ms(mood_t m)
{
    switch (m) {
    case MOOD_WORKING: return 1000 / CONFIG_PET_WORK_FPS;
    case MOOD_WAITING:
    case MOOD_CELEBRATE: return 500;
    case MOOD_IDLE: return 2500; /* occasional blink */
    default: return 0;
    }
}

/* ---- Rendering ---------------------------------------------------------- */

static const char *header_label(mood_t m)
{
    switch (m) {
    case MOOD_WORKING: return "WORKING";
    case MOOD_WAITING: return "NEEDS YOU";
    case MOOD_LISTENING: return "LISTENING";
    case MOOD_THINKING: return "THINKING";
    case MOOD_CELEBRATE: return "DONE!";
    case MOOD_ERROR: return "OOPS";
    case MOOD_SLEEPING: return "ZZZ";
    case MOOD_OFFLINE: return s.setup_mode ? "SETUP" : "OFFLINE";
    default: return "CLINE PET";
    }
}

static void draw_button(int x, int w, const char *label, bool filled)
{
    if (filled) gfx_fill_rect(x, BTN_Y, w, BTN_H, true);
    else gfx_rect(x, BTN_Y, w, BTN_H);
    int tx = x + (w - gfx_text_width(label, 2)) / 2;
    gfx_text(tx, BTN_Y + (BTN_H - 14) / 2, label, 2, filled);
}

static void draw_mic(bool active)
{
    int x = MIC_X, w = GFX_W - MIC_X;
    if (active) gfx_fill_rect(x, BTN_Y, w, BTN_H, true);
    else gfx_rect(x, BTN_Y, w, BTN_H);
    /* microphone glyph */
    int cx = x + w / 2;
    gfx_fill_rect(cx - 4, BTN_Y + 6, 9, 16, !active);
    gfx_fill_rect(cx - 8, BTN_Y + 18, 2, 6, !active);
    gfx_fill_rect(cx + 7, BTN_Y + 18, 2, 6, !active);
    gfx_fill_rect(cx - 8, BTN_Y + 24, 17, 2, !active);
    gfx_fill_rect(cx, BTN_Y + 26, 2, 6, !active);
    gfx_fill_rect(cx - 5, BTN_Y + 32, 12, 2, !active);
}

static void render(void)
{
    mood_t mood = current_mood();
    gfx_clear();

    /* Header: inverted bar with the state label. */
    gfx_fill_rect(0, 0, GFX_W, HEADER_H, true);
    gfx_text(4, 4, header_label(mood), 1, true);
    if (s.pet.tool[0] && mood == MOOD_WORKING) {
        /* nothing on the right; the tool label goes under the pet */
    } else if (s.stats_sessions && mood != MOOD_OFFLINE) {
        char b[12];
        snprintf(b, sizeof(b), "%u live", s.stats_sessions);
        gfx_text(GFX_W - gfx_text_width(b, 1) - 4, 4, b, 1, true);
    }

    /* Pet. */
    const animation_t *anim = gfx_animation(mood);
    uint32_t idx = s.frame % anim->count;
    if (mood == MOOD_IDLE) idx = (s.frame % 4 == 3) ? 1 % anim->count : 0; /* blink 1 in 4 */
    const sprite_t *spr = anim->frames[idx];
    int pet_w = spr->w * SPRITE_SCALE;
    int x = (GFX_W - pet_w) / 2;
    if (mood == MOOD_WORKING) {
        static const int8_t wander[] = {0, 16, 32, 16, 0, -16, -32, -16};
        x += wander[s.frame % sizeof(wander)];
    }
    gfx_sprite(spr, x, PET_Y, SPRITE_SCALE);

    /* Body text under the pet. */
    int ty = PET_Y + spr->h * SPRITE_SCALE + 2;
    if (s.overlay == OV_STATS) {
        char b[48];
        snprintf(b, sizeof(b), "%u active session%s", s.stats_sessions, s.stats_sessions == 1 ? "" : "s");
        gfx_text_centered(ty, b, 1);
        snprintf(b, sizeof(b), "%u task%s today", s.stats_today, s.stats_today == 1 ? "" : "s");
        gfx_text_centered(ty + 12, b, 1);
    } else if (s.overlay == OV_VOICE_PENDING || s.overlay == OV_NOTICE) {
        gfx_text_wrapped(4, ty, GFX_W - 8, s.overlay_text, 4);
    } else {
        switch (mood) {
        case MOOD_WORKING:
            if (s.pet.tool[0]) {
                int w = gfx_text_width(s.pet.tool, 1) + 8;
                gfx_rect((GFX_W - w) / 2, ty, w, 13);
                gfx_text_centered(ty + 3, s.pet.tool, 1);
            }
            break;
        case MOOD_WAITING:
            gfx_text_wrapped(4, ty, GFX_W - 8, s.pet.summary[0] ? s.pet.summary : "Approval needed", 3);
            break;
        case MOOD_LISTENING:
            gfx_text_centered(ty + 4, s.ptt_button ? "new task: release to send" : "release to send", 1);
            break;
        case MOOD_THINKING:
            gfx_text_wrapped(4, ty, GFX_W - 8, s.pet.transcript[0] ? s.pet.transcript : "...", 4);
            break;
        case MOOD_CELEBRATE:
            gfx_text_wrapped(4, ty, MIC_X - 8, s.pet.reply[0] ? s.pet.reply : "Task complete", 4);
            break;
        case MOOD_ERROR:
            gfx_text_wrapped(4, ty, MIC_X - 8, s.pet.err[0] ? s.pet.err : "Something failed", 3);
            break;
        case MOOD_OFFLINE:
            gfx_text_wrapped(4, ty, GFX_W - 8, s.setup_mode ? s.setup_text : s.link_text, 5);
            break;
        case MOOD_SLEEPING:
            gfx_text_centered(ty + 4, "tap to wake", 1);
            break;
        default:
            gfx_text(4, BTN_Y + 4, "tap: stats", 1, false);
            gfx_text(4, BTN_Y + 16, "hold mic: talk", 1, false);
            gfx_text(4, BTN_Y + 28, "BOOT: new task", 1, false);
            break;
        }
    }

    /* Touch targets. */
    if (approval_buttons_visible()) {
        draw_button(0, 99, "APPROVE", true);
        draw_button(101, 99, "DENY", false);
    } else if (voice_buttons_visible()) {
        draw_button(0, 99, "CANCEL", false);
        draw_button(101, 99, "SEND", true);
    } else if (mic_visible()) {
        draw_mic(audio_recording());
    }
}

static void refresh(bool force_full)
{
    render();
    if (s_has_prev && !force_full && memcmp(gfx_fb, s_prev_fb, GFX_BYTES) == 0) return;
    if (force_full || !s_has_prev || s.partials >= CONFIG_PET_FULL_REFRESH_EVERY) {
        epd_full_refresh(gfx_fb);
        s.partials = 0;
    } else {
        epd_partial_refresh(gfx_fb);
        s.partials++;
    }
    memcpy(s_prev_fb, gfx_fb, GFX_BYTES);
    s_has_prev = true;
}

/* ---- Sleep -------------------------------------------------------------- */

static void wake(void)
{
    s.last_activity = now_ms();
    if (!s.sleeping) return;
    s.sleeping = false;
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
    refresh(true);
}

static void maybe_sleep(void)
{
    uint32_t now = now_ms();
    if (s.sleeping) {
#if CONFIG_PET_DEEP_SLEEP_MIN > 0
        if (now - s.slept_at > CONFIG_PET_DEEP_SLEEP_MIN * 60000u) {
            ESP_LOGI(TAG, "deep sleep");
            uint64_t mask = 0;
#if CONFIG_PET_PTT_BUTTON >= 0
            mask |= 1ULL << CONFIG_PET_PTT_BUTTON;
#endif
#if CONFIG_PET_TOUCH_INT >= 0
            mask |= 1ULL << CONFIG_PET_TOUCH_INT;
#endif
            if (mask) {
                esp_sleep_enable_ext1_wakeup(mask, ESP_EXT1_WAKEUP_ANY_LOW);
                esp_deep_sleep_start(); /* reboots on wake and reconnects */
            }
        }
#endif
        return;
    }
    if (current_mood() != MOOD_IDLE || s.overlay != OV_NONE || s.touching) return;
    if (now - s.last_activity < CONFIG_PET_SLEEP_MIN * 60000u) return;
    s.sleeping = true;
    s.slept_at = now;
    refresh(true);  /* clean frame for the long hold */
    epd_sleep();    /* panel draws no power while the image persists */
    esp_wifi_set_ps(WIFI_PS_MAX_MODEM);
}

/* ---- Input -------------------------------------------------------------- */

static bool in_rect(int x, int y, int rx, int ry, int rw, int rh)
{
    return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
}

static void ptt_begin(bool from_button)
{
    /* On-screen mic: follow up on the running task. BOOT: new parallel task. */
    if (audio_recording() || !audio_start(from_button)) return;
    s.ptt_touch = !from_button;
    s.ptt_button = from_button;
    s.ptt_started = now_ms();
    s.overlay = OV_NONE;
}

static void ptt_end(void)
{
    bool too_short = now_ms() - s.ptt_started < MIN_PTT_MS;
    s.ptt_touch = s.ptt_button = false;
    audio_stop(too_short); /* accidental taps don't reach the transcriber */
}

static void set_notice(const char *text)
{
    strlcpy(s.overlay_text, text, sizeof(s.overlay_text));
    s.overlay = OV_NOTICE;
    s.overlay_until = now_ms() + OVERLAY_MS;
}

static void on_touch_down(int16_t x, int16_t y)
{
    s.touching = true;
    s.hold_fired = false;
    s.abort_fired = false;
    s.touch_down_at = now_ms();
    s.touch_x = x;
    s.touch_y = y;
    if (s.sleeping) return; /* first touch only wakes */
    if (mic_visible() && in_rect(x, y, MIC_X, BTN_Y, GFX_W - MIC_X, BTN_H)) ptt_begin(false);
}

static void on_touch_up(int16_t x, int16_t y)
{
    s.touching = false;
    if (s.sleeping) {
        wake();
        return;
    }
    if (s.ptt_touch) {
        ptt_end();
        return;
    }
    if (s.hold_fired || s.abort_fired) return;
    x = s.touch_x;
    y = s.touch_y;
    bool left = in_rect(x, y, 0, BTN_Y, 99, BTN_H);
    bool right = in_rect(x, y, 101, BTN_Y, 99, BTN_H);
    if (approval_buttons_visible() && (left || right)) {
        if (protocol_send_approval(s.pet.approval_id, left)) {
            strlcpy(s.sent_approval, s.pet.approval_id, sizeof(s.sent_approval));
            set_notice(left ? "Approved" : "Denied");
        }
        return;
    }
    if (voice_buttons_visible() && (left || right)) {
        protocol_send_simple(left ? "voice_cancel" : "voice_confirm");
        if (left) s.overlay = OV_NONE;
        return;
    }
    /* Tap on the pet: stats card. */
    if (y < BTN_Y && s.link_up) {
        protocol_send_simple("stats");
    }
}

static void check_holds(void)
{
    if (!s.touching || s.hold_fired || s.ptt_touch || s.sleeping) return;
    uint32_t held = now_ms() - s.touch_down_at;
    if (held > SETUP_HOLD_MS) {
        s.hold_fired = true;
        ESP_LOGW(TAG, "long hold: entering setup");
        net_factory_setup();
    } else if (held > ABORT_HOLD_MS && !s.abort_fired && current_mood() == MOOD_WORKING &&
               s.touch_y < BTN_Y) {
        /* Hold the pet for 2 s while it works: stop the agent. Keep holding
         * to 8 s to reach the setup reset instead. */
        s.abort_fired = true;
        if (protocol_send_simple("abort")) set_notice("Stopping...");
    }
}

/* ---- Event loop --------------------------------------------------------- */

static void handle(const app_event_t *ev)
{
    switch (ev->type) {
    case EV_STATE: {
        bool changed = ev->state.state != s.pet.state;
        s.pet = ev->state;
        if (s.pet.state != PET_WAITING) s.sent_approval[0] = '\0';
        if (s.pet.state != PET_THINKING && s.overlay == OV_VOICE_PENDING) s.overlay = OV_NONE;
        if (changed && s.pet.state != PET_IDLE) wake();
        break;
    }
    case EV_VOICE:
        switch (ev->voice.status) {
        case VOICE_TRANSCRIBED:
            snprintf(s.overlay_text, sizeof(s.overlay_text), "%s \"%.100s\"",
                     ev->voice.new_task ? "New task:" : "Follow-up:", ev->voice.text);
            s.overlay = OV_VOICE_PENDING;
            s.overlay_until = now_ms() + (ev->voice.cancel_ms ? ev->voice.cancel_ms : 3000) + 1000;
            break;
        case VOICE_SUBMITTED:
            set_notice(ev->voice.new_task ? "Started a new task" : "Sent to current task");
            break;
        case VOICE_CANCELLED:
            s.overlay = OV_NONE;
            break;
        case VOICE_ERROR: {
            char b[128];
            snprintf(b, sizeof(b), "Voice: %.100s", ev->voice.text);
            set_notice(b);
            break;
        }
        }
        wake();
        break;
    case EV_STATS:
        s.stats_sessions = ev->stats.sessions;
        s.stats_today = ev->stats.today;
        s.overlay = OV_STATS;
        s.overlay_until = now_ms() + OVERLAY_MS;
        break;
    case EV_LINK:
        s.link_up = ev->link.up;
        strlcpy(s.link_text, ev->link.text, sizeof(s.link_text));
        if (!s.link_up) {
            if (audio_recording()) audio_stop(true);
            s.pet.state = PET_OFFLINE;
        } else {
            protocol_send_simple("stats"); /* populate the header count */
        }
        break;
    case EV_SETUP:
        s.setup_mode = true;
        strlcpy(s.setup_text, ev->text, sizeof(s.setup_text));
        break;
    case EV_TOUCH_DOWN:
        on_touch_down(ev->touch.x, ev->touch.y);
        s.last_activity = now_ms();
        break;
    case EV_TOUCH_UP:
        on_touch_up(ev->touch.x, ev->touch.y);
        s.last_activity = now_ms();
        break;
    case EV_BUTTON_DOWN:
        wake();
        ptt_begin(true);
        break;
    case EV_BUTTON_UP:
        if (s.ptt_button) ptt_end();
        break;
    case EV_AUDIO_DONE:
        s.ptt_touch = s.ptt_button = false;
        set_notice("Max length reached - sent");
        break;
    }
}

static void ui_task(void *arg)
{
    epd_init();
    s.last_activity = now_ms();
    strlcpy(s.link_text, "starting", sizeof(s.link_text));
    refresh(true);

    uint32_t next_frame = 0;
    for (;;) {
        mood_t mood = current_mood();
        uint32_t period = s.sleeping ? 0 : frame_period_ms(mood);
        uint32_t now = now_ms();
        TickType_t wait = pdMS_TO_TICKS(1000);
        if (period && next_frame > now) wait = pdMS_TO_TICKS(next_frame - now);
        else if (period) wait = 0;
        if (s.touching) wait = wait > pdMS_TO_TICKS(100) ? pdMS_TO_TICKS(100) : wait;

        app_event_t ev;
        bool got = xQueueReceive(g_app_queue, &ev, wait) == pdTRUE;
        if (got) {
            handle(&ev);
            /* Coalesce bursts (e.g. tool start/finish) into one refresh. */
            while (xQueueReceive(g_app_queue, &ev, pdMS_TO_TICKS(30)) == pdTRUE) handle(&ev);
        }

        now = now_ms();
        if (s.overlay != OV_NONE && s.overlay != OV_VOICE_PENDING && now > s.overlay_until) s.overlay = OV_NONE;
        if (s.overlay == OV_VOICE_PENDING && now > s.overlay_until) s.overlay = OV_NONE;

        check_holds();
        period = frame_period_ms(current_mood());
        if (period && now >= next_frame) {
            s.frame++;
            next_frame = now + period;
        }
        if (!s.sleeping) refresh(false); /* no-op unless pixels changed */
        maybe_sleep();
    }
}

void ui_start(void)
{
    xTaskCreatePinnedToCore(ui_task, "ui", 6144, NULL, 4, NULL, 1);
}
