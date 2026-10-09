#pragma once
#include <stdbool.h>
#include "cline_actions.h"

/* Mirrors MAX_PROMPT_LENGTH in the device SDK protocol. */
enum { CLINE_PROMPT_MAX = 384 };
typedef struct {
    bool down;
    char ch; /* ASCII printable character, Backspace, Enter, or Escape. */
    cline_action_t action; /* Shortcut used outside the prompt editor. */
} cline_key_t;
