/* Shared application state and actions. Board drivers own hardware; surfaces
 * own layout, hit testing, animation timing and display refresh. */
#include "ui.h"

#include <stdio.h>
#include <string.h>

#include "app.h"
#include "audio.h"
#include "cline_board.h"
#include "cline_surface.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "net.h"
#include "protocol.h"
#include "sdkconfig.h"

static const char *TAG = "ui";

#define MIN_PTT_MS 300
#define SETUP_HOLD_MS 8000

typedef enum { OV_NONE, OV_VOICE_PENDING, OV_NOTICE } overlay_t;

static struct {
    device_msg_t device;
    bool link_up;
    char link_text[48];
    bool setup_mode;
    char setup_text[96];

    overlay_t overlay;
    uint32_t overlay_until;
    char overlay_text[128];
    uint16_t stats_sessions, stats_today;
    char sent_approval[72]; /* approval we already answered; hides buttons */

    uint32_t frame;
    uint32_t last_activity;
    bool sleeping;
    uint32_t slept_at;
    bool home;
    bool recording_home;
    cline_action_t touch_action;
    char speech[256];
    bool typing, submitting, typing_new;
    char draft[CLINE_PROMPT_MAX + 1];
    char prompt_id[33];
    uint32_t prompt_sequence;

    bool touching;
    uint32_t touch_down_at;
    bool ptt_touch;
    bool ptt_button;
    uint32_t ptt_started;
    bool hold_fired;
    bool setup_key_down;
    uint32_t setup_key_at;
} s;


static uint32_t now_ms(void) { return xTaskGetTickCount() * portTICK_PERIOD_MS; }

/* ---- View model --------------------------------------------------------- */

static mood_t current_mood(void)
{
    if (s.sleeping) return MOOD_SLEEPING;
    if (s.setup_mode || !s.link_up) return MOOD_OFFLINE;
    if (audio_recording()) return MOOD_LISTENING;
    if (s.home) return MOOD_IDLE;
    switch (s.device.state) {
    case DEVICE_WORKING: return MOOD_WORKING;
    case DEVICE_WAITING: return MOOD_WAITING;
    case DEVICE_LISTENING: return MOOD_LISTENING;
    case DEVICE_THINKING: return MOOD_THINKING;
    case DEVICE_DONE: return MOOD_DONE;
    case DEVICE_ERROR: return MOOD_ERROR;
    case DEVICE_OFFLINE: return MOOD_OFFLINE;
    default: return MOOD_IDLE;
    }
}

static bool approval_buttons_visible(void)
{
    return !s.home && current_mood() == MOOD_WAITING && s.device.approval_id[0] &&
           strcmp(s.device.approval_id, s.sent_approval) != 0;
}

static bool voice_buttons_visible(void) { return s.overlay == OV_VOICE_PENDING; }

static bool mic_visible(void)
{
    mood_t m = current_mood();
    return board_info()->microphone && s.link_up && !approval_buttons_visible() && !voice_buttons_visible() &&
           (m == MOOD_IDLE || m == MOOD_WORKING || m == MOOD_DONE || m == MOOD_ERROR ||
            m == MOOD_LISTENING || m == MOOD_THINKING);
}

static bool running(void) {
    return s.link_up && (s.device.state == DEVICE_WORKING || s.device.state == DEVICE_WAITING || s.device.state == DEVICE_THINKING);
}
static cline_view_t view(void) {
    cline_view_t v = {
        .mood = current_mood(), .frame = s.frame,
        .active = s.stats_sessions, .today = s.stats_today,
        .connected = s.link_up, .recording = audio_recording(),
        .approval = approval_buttons_visible(), .voice_pending = voice_buttons_visible(),
        .mic = mic_visible(), .running = running(), .home = s.home,
    };
    v.typing = s.typing;
    v.submitting = s.submitting;
    strlcpy(v.draft, s.draft, sizeof(v.draft));
    const char *text = s.speech;
    if (s.setup_mode) text = s.setup_text;
    else if (!s.link_up) text = s.link_text[0] ? s.link_text : "Connecting...";
    else if (s.typing) text = s.submitting ? "Sending..." : s.overlay == OV_NOTICE ? s.overlay_text : s.typing_new ? "New task" : "Current task / new if idle";
    else if (v.recording) text = "Listening... release to send";
    else if (s.overlay == OV_VOICE_PENDING || s.overlay == OV_NOTICE) text = s.overlay_text;
    else if (s.home) text = "How can I help? Say cloud session to run in the cloud.";
    else if (!text[0]) text = "How can I help?";
    strlcpy(v.speech, text, sizeof(v.speech));
    return v;
}
static void refresh(bool full) {
    cline_view_t v = view();
    surface_render(&v, full);
}

/* ---- Sleep -------------------------------------------------------------- */

static void wake(void)
{
    s.last_activity = now_ms();
    if (!s.sleeping) return;
    s.sleeping = false;
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
    surface_sleep(false);
    refresh(true);
}

static void maybe_sleep(void)
{
    uint32_t now = now_ms();
    if (s.sleeping) {
#if CONFIG_DEVICE_DEEP_SLEEP_MIN > 0
        if (now - s.slept_at > CONFIG_DEVICE_DEEP_SLEEP_MIN * 60000u) {
            ESP_LOGI(TAG, "deep sleep");
            board_deep_sleep();
        }
#endif
        return;
    }
    if (s.typing || current_mood() != MOOD_IDLE || s.overlay != OV_NONE || s.touching) return;
    if (now - s.last_activity < CONFIG_DEVICE_SLEEP_MIN * 60000u) return;
    s.sleeping = true;
    s.slept_at = now;
    refresh(true);  /* clean frame for the long hold */
    surface_sleep(true);    /* panel draws no power while the image persists */
    esp_wifi_set_ps(WIFI_PS_MAX_MODEM);
}

/* ---- Input -------------------------------------------------------------- */

static void ptt_begin(bool physical, bool new_session)
{
    /* The + control arms the next utterance as a new session. */
    if (!mic_visible() || audio_recording() || !audio_start(new_session || s.home)) return;
    s.recording_home = s.home;
    s.home = false;
    s.ptt_touch = !physical;
    s.ptt_button = physical;
    s.ptt_started = now_ms();
    s.overlay = OV_NONE;
}

static void ptt_end(void)
{
    bool too_short = now_ms() - s.ptt_started < MIN_PTT_MS;
    s.ptt_touch = s.ptt_button = false;
    if (too_short) s.home = s.recording_home;
    audio_stop(too_short); /* accidental taps don't reach the transcriber */
}

static void set_notice(const char *text)
{
    strlcpy(s.overlay_text, text, sizeof(s.overlay_text));
    s.overlay = OV_NOTICE;
    s.overlay_until = 0;
}

static void perform_action(cline_action_t action) {
    switch (action) {
    case ACTION_APPROVE:
    case ACTION_DENY:
        if (!s.link_up || !approval_buttons_visible()) return;
        if (protocol_send_approval(s.device.approval_id, action == ACTION_APPROVE)) {
            strlcpy(s.sent_approval, s.device.approval_id, sizeof(s.sent_approval));
            set_notice(action == ACTION_APPROVE ? "Approved" : "Denied");
        }
        break;
    case ACTION_VOICE_CANCEL:
    case ACTION_VOICE_CONFIRM:
        if (!s.link_up || !voice_buttons_visible()) return;
        protocol_send_simple(action == ACTION_VOICE_CANCEL ? "voice_cancel" : "voice_confirm");
        if (action == ACTION_VOICE_CANCEL) s.overlay = OV_NONE;
        break;
    case ACTION_NEW:
        s.home = true;
        s.overlay = OV_NONE;
        break;
    case ACTION_STOP:
        if (protocol_send_simple("abort")) set_notice("Stopping...");
        break;
    case ACTION_STATS:
        protocol_send_simple("stats");
        break;
    default: break;
    }

}

static void handle(const app_event_t *ev);

static void on_key(const app_event_t *ev)
{
    wake();
    if (s.typing) {
        if (!ev->key.down || s.submitting) return;
        size_t len = strlen(s.draft);
        char ch = ev->key.ch;
        if (ch == 27) {
            s.typing = false;
            s.overlay = OV_NONE;
            return;
        }
        if (ch == '\b') {
            if (len) s.draft[len - 1] = 0;
            s.overlay = OV_NONE;
        } else if (ch == '\n') {
            bool content = false;
            for (size_t i = 0; i < len; i++) if (s.draft[i] != ' ') content = true;
            if (!content) { set_notice("Type a prompt first"); return; }
            if (!s.link_up) { set_notice("Offline; draft kept"); return; }
            snprintf(s.prompt_id, sizeof(s.prompt_id), "%lu-%lu",
                     (unsigned long)now_ms(), (unsigned long)++s.prompt_sequence);
            if (protocol_send_prompt(s.prompt_id, s.draft, s.typing_new)) {
                s.submitting = true;
                s.overlay = OV_NONE;
            } else set_notice("Could not send; draft kept");
        } else if (ch >= 32 && ch <= 126) {
            if (len < CLINE_PROMPT_MAX) {
                s.draft[len] = ch;
                s.draft[len + 1] = 0;
                s.overlay = OV_NONE;
            } else set_notice("Prompt limit: 384 characters");
        }
        return;
    }
    if (ev->key.down && (ev->key.ch == 't' || ev->key.ch == 'T' || ev->key.ch == '\n') &&
        !audio_recording() && !voice_buttons_visible() && !approval_buttons_visible() && !s.setup_mode) {
        s.typing = true;
        s.typing_new = s.home;
        s.overlay = OV_NONE;
        s.setup_key_down = false;
        return;
    }
    /* Shortcut handling lives in the application, so typing never triggers it. */
    app_event_t action = {.type = ev->key.down ? EV_ACTION_DOWN : EV_ACTION_UP, .action = ev->key.action};
    handle(&action);
}

static void on_touch_down(int16_t x, int16_t y)
{
    s.touching = true;
    s.hold_fired = false;
    s.touch_down_at = now_ms();
    if (s.sleeping) return; /* first touch only wakes */
    cline_view_t v = view();
    s.touch_action = surface_hit_test(&v, x, y);
    if (s.touch_action == ACTION_TALK) ptt_begin(false, false);
}

static void on_touch_up(int16_t x, int16_t y)
{
    if (!s.touching) return;
    s.touching = false;
    if (s.sleeping) {
        wake();
        return;
    }
    if (s.ptt_touch) {
        ptt_end();
        return;
    }
    if (s.hold_fired) return;
    cline_view_t v = view();
    if (surface_hit_test(&v, x, y) != s.touch_action) return;
    perform_action(s.touch_action);
}

static void check_holds(void)
{
    if (s.setup_key_down && now_ms() - s.setup_key_at >= SETUP_HOLD_MS) {
        s.setup_key_down = false;
        net_enter_setup();
        return;
    }
    if (!s.touching || s.touch_action != ACTION_STATS || s.hold_fired || s.ptt_touch || s.sleeping) return;
    uint32_t held = now_ms() - s.touch_down_at;
    if (held > SETUP_HOLD_MS) {
        s.hold_fired = true;
        ESP_LOGW(TAG, "long hold: entering setup");
        net_factory_setup();
    }
}

/* ---- Event loop --------------------------------------------------------- */

static void handle(const app_event_t *ev)
{
    switch (ev->type) {
    case EV_KEY:
        on_key(ev);
        break;
    case EV_PROMPT:
        if (!s.submitting || strcmp(s.prompt_id, ev->prompt.id) != 0) break;
        s.submitting = false;
        if (ev->prompt.submitted) {
            s.typing = false;
            s.home = false;
            s.draft[0] = 0;
            set_notice("Prompt sent");
        } else set_notice(ev->prompt.reason[0] ? ev->prompt.reason : "Could not send; draft kept");
        break;
    case EV_STATE: {
        bool changed = ev->state.state != s.device.state;
        bool new_activity = ev->state.activity[0] && strcmp(s.device.activity, ev->state.activity) != 0;
        s.device = ev->state;
        if (new_activity) {
            strlcpy(s.speech, s.device.activity, sizeof(s.speech));
            if (s.overlay == OV_NOTICE && !s.typing) s.overlay = OV_NONE;
        }
        if (s.device.state != DEVICE_WAITING) s.sent_approval[0] = '\0';
        if (s.device.state != DEVICE_THINKING && s.overlay == OV_VOICE_PENDING) s.overlay = OV_NONE;
        if (changed && s.device.state != DEVICE_IDLE) wake();
        break;
    }
    case EV_VOICE:
        switch (ev->voice.status) {
        case VOICE_TRANSCRIBED:
            snprintf(s.overlay_text, sizeof(s.overlay_text), "%s \"%.100s\"",
                     ev->voice.target == VOICE_CLOUD ? "Cloud session:"
                     : ev->voice.target == VOICE_NEW ? "New task:" : "Follow-up:", ev->voice.text);
            s.overlay = OV_VOICE_PENDING;
            s.overlay_until = now_ms() + (ev->voice.cancel_ms ? ev->voice.cancel_ms : 3000) + 1000;
            break;
        case VOICE_STARTING:
            set_notice("Starting cloud session");
            break;
        case VOICE_SUBMITTED:
            set_notice(ev->voice.target == VOICE_CLOUD ? "Started cloud session"
                       : ev->voice.target == VOICE_NEW ? "Started a new task" : "Sent to current task");
            break;
        case VOICE_CANCELLED:
            s.home = s.recording_home;
            s.overlay = OV_NONE;
            break;
        case VOICE_ERROR: {
            s.home = s.recording_home;
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

        break;
    case EV_LINK:
        s.link_up = ev->link.up;
        strlcpy(s.link_text, ev->link.text, sizeof(s.link_text));
        if (!s.link_up) {
            if (s.submitting) {
                s.submitting = false;
                set_notice("Connection lost; check task before retry");
            }
            if (audio_recording()) audio_stop(true);
            s.ptt_touch = s.ptt_button = false;
            s.device.state = DEVICE_OFFLINE;
        } else {
            protocol_send_simple("stats"); /* populate the session title */
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
    case EV_ACTION_DOWN:
        wake();
        if (ev->action == ACTION_SETUP && !s.setup_key_down) {
            s.setup_key_down = true;
            s.setup_key_at = now_ms();
        }
        if (ev->action == ACTION_TALK || ev->action == ACTION_TALK_NEW)
            ptt_begin(true, ev->action == ACTION_TALK_NEW);
        break;
    case EV_ACTION_UP:
        if (ev->action == ACTION_SETUP) { s.setup_key_down = false; break; }
        if (s.ptt_button && (ev->action == ACTION_TALK || ev->action == ACTION_TALK_NEW)) ptt_end();
        else perform_action(ev->action);
        break;
    case EV_AUDIO_ERROR:
        audio_stop(true);
        s.ptt_touch = s.ptt_button = false;
        strlcpy(s.speech, ev->text, sizeof(s.speech));
        s.overlay = OV_NONE;
        break;
    case EV_AUDIO_DONE:
        s.ptt_touch = s.ptt_button = false;
        set_notice("Max length reached - sent");
        break;
    }
}

static void ui_task(void *arg)
{
    ESP_ERROR_CHECK(surface_init());
    s.last_activity = now_ms();
    strlcpy(s.link_text, "starting", sizeof(s.link_text));
    refresh(true);

    uint32_t next_frame = 0;
    for (;;) {
        mood_t mood = current_mood();
        uint32_t period = s.sleeping ? 0 : surface_frame_period(mood);
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
            for (int i = 0; i < 12 && xQueueReceive(g_app_queue, &ev, 0) == pdTRUE; i++) handle(&ev);
        }

        now = now_ms();

        if (s.overlay == OV_VOICE_PENDING && now > s.overlay_until) s.overlay = OV_NONE;

        check_holds();
        period = surface_frame_period(current_mood());
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
