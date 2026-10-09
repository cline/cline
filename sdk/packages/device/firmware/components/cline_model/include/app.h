#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "cline_input.h"

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

/* Mirrors DeviceState in sdk/packages/device/src/protocol.ts. */
typedef enum {
    DEVICE_IDLE,
    DEVICE_WORKING,
    DEVICE_WAITING,
    DEVICE_LISTENING,
    DEVICE_THINKING,
    DEVICE_DONE,
    DEVICE_ERROR,
    DEVICE_OFFLINE,
} device_state_t;

typedef struct {
    device_state_t state;
    char activity[256];
    char tool[32];
    char session[48];
    char approval_id[72];
    char summary[72];
    char transcript[128];
    char reply[96];
    char err[32];
} device_msg_t;

typedef enum { VOICE_TRANSCRIBED, VOICE_STARTING, VOICE_SUBMITTED, VOICE_CANCELLED, VOICE_ERROR } voice_status_t;

typedef enum { VOICE_FOLLOWUP, VOICE_NEW, VOICE_CLOUD } voice_target_t;

typedef struct {
    voice_status_t status;
    voice_target_t target;
    uint16_t cancel_ms;
    char text[128];
} voice_msg_t;

typedef enum {
    EV_STATE,       /* .state */
    EV_VOICE,       /* .voice */
    EV_KEY,         /* .key: printable/control key plus associated shortcut */
    EV_PROMPT,      /* .prompt: acknowledgement of a typed prompt */
    EV_STATS,       /* .stats */
    EV_LINK,        /* .link: bridge websocket up/down + status text */
    EV_SETUP,       /* .text: provisioning instructions */
    EV_TOUCH_DOWN,  /* .touch */
    EV_TOUCH_UP,    /* .touch */
    EV_ACTION_DOWN, /* .action: physical input mapped by the board */
    EV_ACTION_UP,
    EV_AUDIO_ERROR, /* .text: microphone open/read failure */
    EV_AUDIO_DONE,  /* recording hit the length cap */
} app_ev_type_t;

typedef struct {
    app_ev_type_t type;
    union {
        cline_action_t action;
        cline_key_t key;
        struct { char id[33]; bool submitted; char reason[96]; } prompt;
        device_msg_t state;
        voice_msg_t voice;
        struct { uint16_t sessions, today; } stats;
        struct { bool up; char text[48]; } link;
        char text[96];
        struct { int16_t x, y; } touch;
    };
} app_event_t;

extern QueueHandle_t g_app_queue;

static inline void app_post(const app_event_t *ev)
{
    if (g_app_queue) xQueueSend(g_app_queue, ev, pdMS_TO_TICKS(50));
}
