#include "host.h"
#include "freertos/task.h"
#include "../components/cline_app/app.c"
#include <assert.h>

QueueHandle_t g_app_queue;
int xQueueSend(QueueHandle_t q, const void *ev, TickType_t wait) { return pdTRUE; }
uint32_t test_clock;
static bool recording, new_target, cancelled;
static int start_count, stop_count;
static cline_action_t hit;
static char sent[40];
bool audio_recording(void) { return recording; }
bool audio_start(bool new_task) { start_count++; new_target = new_task; recording = true; return true; }
void audio_stop(bool cancel) { recording = false; cancelled = cancel; stop_count++; }
bool protocol_send_simple(const char *type) { strlcpy(sent, type, sizeof(sent)); return true; }
static char prompt_text[385], prompt_id[33];
static int prompt_count;
static bool prompt_new, prompt_ok = true;
bool protocol_send_prompt(const char *id, const char *text, bool new_task) {
    prompt_count++; strlcpy(prompt_text, text, sizeof(prompt_text));
    strlcpy(prompt_id, id, sizeof(prompt_id)); prompt_new = new_task; return prompt_ok;
}
bool protocol_send_approval(const char *id, bool approve) { return true; }
void net_factory_setup(void) {}
static int setup_count;
void net_enter_setup(void) { setup_count++; }
esp_err_t board_deep_sleep(void) { return ESP_OK; }
const cline_board_info_t *board_info(void) {
    static const cline_board_info_t info = {"test", 200, 200, false, true, true};
    return &info;
}
esp_err_t surface_init(void) { return ESP_OK; }
void surface_render(const cline_view_t *v, bool full) {}
void surface_sleep(bool sleep) {}
uint32_t surface_frame_period(mood_t mood) { return 0; }
cline_action_t surface_hit_test(const cline_view_t *v, int x, int y) { return hit; }
static void tap(cline_action_t action) {
    hit = action;
    on_touch_down(1, 1);
    test_clock += 400;
    on_touch_up(1, 1);
}
static void type_key(char ch, cline_action_t action) {
    app_event_t key = {.type = EV_KEY, .key = {.down = true, .ch = ch, .action = action}};
    handle(&key); key.key.down = false; handle(&key);
}
int main(void) {
    app_event_t link = {.type = EV_LINK, .link = {.up = true}}; handle(&link);
    app_event_t state = {.type = EV_STATE, .state = {.state = DEVICE_WORKING}};
    strlcpy(state.state.activity, "Reading a file", sizeof(state.state.activity)); handle(&state);
    app_event_t stats = {.type = EV_STATS, .stats = {.sessions = 1, .today = 3}}; handle(&stats);
    cline_view_t v = view();
    assert(v.active == 1 && v.today == 3 && strcmp(v.speech, "Reading a file") == 0);
    /* A transient idle face must not clear the last activity. */
    state.state.state = DEVICE_IDLE; state.state.activity[0] = 0; handle(&state);
    v = view(); assert(strcmp(v.speech, "Reading a file") == 0);
    state.state.state = DEVICE_WORKING; handle(&state);
    tap(ACTION_STOP); assert(strcmp(sent, "abort") == 0);
    v = view(); assert(strcmp(v.speech, "Stopping...") == 0);
    handle(&stats); v = view(); assert(strcmp(v.speech, "Stopping...") == 0);
    strlcpy(state.state.activity, "Stopped", sizeof(state.state.activity)); handle(&state);
    v = view(); assert(strcmp(v.speech, "Stopped") == 0);
    /* New returns home even when an existing session is still running. */
    tap(ACTION_NEW); v = view(); assert(v.home && v.mood == MOOD_IDLE && v.running);
    hit = ACTION_TALK; on_touch_down(1, 1); test_clock += 100; on_touch_up(1, 1);
    v = view(); assert(v.home && cancelled);
    start_count = 0;
    tap(ACTION_TALK); assert(start_count == 1 && new_target && !recording && !cancelled);
    tap(ACTION_TALK); assert(start_count == 2 && !new_target);
    /* Accidental taps cancel without sending an utterance. */
    hit = ACTION_TALK; on_touch_down(1, 1); test_clock += 100; on_touch_up(1, 1);
    assert(cancelled);
    hit = ACTION_TALK; on_touch_down(1, 1);
    link.link.up = false; handle(&link); assert(!recording && cancelled);
    strlcpy(link.link.text, "Wi-Fi network not found", sizeof(link.link.text)); handle(&link);
    v = view(); assert(!v.connected && strcmp(v.speech, "Wi-Fi network not found") == 0);
    /* Setup needs a sustained hold; short taps or lost releases cannot reset it. */
    app_event_t setup_down = {.type = EV_ACTION_DOWN, .action = ACTION_SETUP};
    app_event_t setup_up = {.type = EV_ACTION_UP, .action = ACTION_SETUP};
    handle(&setup_down); test_clock += 4000; check_holds(); assert(setup_count == 0);
    handle(&setup_up); test_clock += 9000; check_holds(); assert(setup_count == 0);
    handle(&setup_down); test_clock += 8000; check_holds(); assert(setup_count == 1);
    check_holds(); assert(setup_count == 1); handle(&setup_up);
    /* Approval remains a semantic action, independent of the surface. */
    link.link.up = true; handle(&link);
    state.state.state = DEVICE_WAITING; strlcpy(state.state.approval_id, "approval", sizeof(state.state.approval_id)); handle(&state);
    v = view(); assert(v.approval && !v.mic);
    int starts_before_approval = start_count;
    app_event_t blocked_key = {.type = EV_ACTION_DOWN, .action = ACTION_TALK}; handle(&blocked_key);
    assert(start_count == starts_before_approval && !recording);
    tap(ACTION_APPROVE); v = view(); assert(!v.approval);
    state.state.state = DEVICE_IDLE; state.state.approval_id[0] = 0; handle(&state);
    assert(stop_count >= 4);
    /* A future physical Stop button uses the same action as touch. */
    app_event_t button = {.type = EV_ACTION_UP, .action = ACTION_STOP}; handle(&button);
    assert(strcmp(sent, "abort") == 0);
    button.type = EV_ACTION_DOWN; button.action = ACTION_TALK_NEW; handle(&button);
    assert(new_target && recording);
    test_clock += 400; button.type = EV_ACTION_UP; handle(&button);
    assert(!recording && !cancelled);
    /* Keyboard read failure cancels a held recording. */
    memset(&s, 0, sizeof(s));
    link.link.up = true; handle(&link);
    app_event_t held_key = {.type = EV_ACTION_DOWN, .action = ACTION_TALK};
    handle(&held_key);
    assert(recording);
    app_event_t keyboard_error = {.type = EV_AUDIO_ERROR};
    strcpy(keyboard_error.text, "Keyboard disconnected");
    handle(&keyboard_error);
    assert(!recording && cancelled && !s.ptt_button);
    /* Editor consumes shortcut keys and keeps its draft through hub updates. */
    memset(&s, 0, sizeof(s)); recording = false;
    link.link.up = true; handle(&link); s.home = true;
    type_key('t', ACTION_NONE); assert(s.typing);
    type_key('s', ACTION_SETUP); type_key('n', ACTION_NEW); type_key('x', ACTION_STOP);
    type_key(' ', ACTION_TALK); assert(!recording && !s.setup_key_down && strcmp(s.draft, "snx ") == 0);
    handle(&state); assert(strcmp(s.draft, "snx ") == 0);
    type_key('\b', ACTION_VOICE_CANCEL); assert(strcmp(s.draft, "snx") == 0);
    type_key('\n', ACTION_VOICE_CONFIRM); assert(s.submitting && prompt_count == 1 && prompt_new);
    type_key('\n', ACTION_VOICE_CONFIRM); assert(prompt_count == 1);
    app_event_t ack = {.type = EV_PROMPT, .prompt = {.submitted = true}};
    strcpy(ack.prompt.id, "other"); handle(&ack); assert(s.submitting);
    strcpy(ack.prompt.id, prompt_id); ack.prompt.submitted = false; strcpy(ack.prompt.reason, "Try later");
    handle(&ack); assert(s.typing && !s.submitting && strcmp(s.draft, "snx") == 0);
    type_key('\n', ACTION_VOICE_CONFIRM); assert(prompt_count == 2);
    strcpy(ack.prompt.id, prompt_id); ack.prompt.submitted = true; handle(&ack);
    assert(!s.typing && !s.home && s.draft[0] == 0);
    /* Blank / offline / failed sends retain a draft and never dispatch accidentally. */
    type_key('t', ACTION_NONE); type_key('\n', ACTION_VOICE_CONFIRM); assert(prompt_count == 2);
    type_key('a', ACTION_NONE); link.link.up = false; handle(&link);
    type_key('\n', ACTION_VOICE_CONFIRM); assert(prompt_count == 2 && s.typing && strcmp(s.draft, "a") == 0);
    link.link.up = true; handle(&link); prompt_ok = false;
    type_key('\n', ACTION_VOICE_CONFIRM); assert(!s.submitting && s.typing);
    type_key(27, ACTION_NONE); assert(!s.typing && strcmp(s.draft, "a") == 0);
    type_key('t', ACTION_NONE); prompt_ok = true;
    type_key('\n', ACTION_VOICE_CONFIRM); assert(s.submitting);
    link.link.up = false; handle(&link);
    assert(s.typing && !s.submitting && strcmp(s.draft, "a") == 0);
    strcpy(ack.prompt.id, prompt_id); ack.prompt.submitted = true; handle(&ack);
    assert(s.typing && strcmp(s.draft, "a") == 0);
    memset(s.draft, 'a', CLINE_PROMPT_MAX); s.draft[CLINE_PROMPT_MAX] = 0;
    type_key('b', ACTION_NONE); assert(strlen(s.draft) == CLINE_PROMPT_MAX);
    return 0;
}
