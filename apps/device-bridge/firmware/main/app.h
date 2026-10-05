#pragma once
#include <stdbool.h>
#include <stdint.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

/* Mirrors PetState in apps/device-bridge/src/protocol.ts. */
typedef enum {
    PET_IDLE,
    PET_WORKING,
    PET_WAITING,
    PET_LISTENING,
    PET_THINKING,
    PET_DONE,
    PET_ERROR,
    PET_OFFLINE,
} pet_state_t;

typedef struct {
    pet_state_t state;
    char tool[32];
    char session[48];
    char approval_id[72];
    char summary[72];
    char transcript[128];
    char reply[96];
    char err[32];
} pet_msg_t;

typedef enum { VOICE_TRANSCRIBED, VOICE_SUBMITTED, VOICE_CANCELLED, VOICE_ERROR } voice_status_t;

typedef struct {
    voice_status_t status;
    bool new_task; /* target: "new" vs "followup" */
    uint16_t cancel_ms;
    char text[128];
} voice_msg_t;

typedef enum {
    EV_STATE,       /* .state */
    EV_VOICE,       /* .voice */
    EV_STATS,       /* .stats */
    EV_LINK,        /* .link: bridge websocket up/down + status text */
    EV_SETUP,       /* .text: provisioning instructions */
    EV_TOUCH_DOWN,  /* .touch */
    EV_TOUCH_UP,    /* .touch */
    EV_BUTTON_DOWN, /* physical push-to-talk button */
    EV_BUTTON_UP,
    EV_AUDIO_DONE,  /* recording hit the length cap */
} app_ev_type_t;

typedef struct {
    app_ev_type_t type;
    union {
        pet_msg_t state;
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
