#pragma once
/* Shared semantic input vocabulary for buttons, touch and future surfaces. */
typedef enum {
    ACTION_NONE, ACTION_TALK, ACTION_TALK_NEW, ACTION_NEW, ACTION_STOP,
    ACTION_APPROVE, ACTION_DENY, ACTION_VOICE_CANCEL, ACTION_VOICE_CONFIRM,
    ACTION_STATS, ACTION_SETUP,
} cline_action_t;
