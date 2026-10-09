#pragma once
#include "cline_actions.h"
#include <stdint.h>
#include <stdbool.h>
/* Physical legends from M5Stack’s Keyboard.h; Fn+Esc cancels the editor. */
static inline uint8_t cardputer_key_at(unsigned x, unsigned y) {
    return (x / 2) * 10 + y + (x % 2) * 4 + 1;
}
static inline char cardputer_key_character(uint8_t raw, bool shift, bool fn) {
    unsigned key = raw & 0x7f;
    if (!key || key > 68) return 0;
    unsigned row = (key - 1) / 10, col = (key - 1) % 10;
    if (row >= 7 || col >= 8) return 0;
    unsigned x = row * 2 + (col > 3), y = col % 4;
    if (fn) return x == 0 && y == 0 ? 27 : 0;
    static const char normal[4][15] = {
        "`1234567890-=\b", "\tqwertyuiop[]\\",
        {0, 0, 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', '\'', '\n'},
        {0, 0, 0, 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', ' '}
    };
    static const char shifted[4][15] = {
        "~!@#$%^&*()_+\b", "\tQWERTYUIOP{}|",
        {0, 0, 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ':', '"', '\n'},
        {0, 0, 0, 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '<', '>', '?', ' '}
    };
    return shift ? shifted[y][x] : normal[y][x];
}
/* TCA8418's 7x8 matrix is folded into the physical 4x14 keyboard.
 * Mapping follows M5Cardputer's TCA8418KeyboardReader::remap. */
static inline cline_action_t cardputer_key_action(uint8_t raw) {
    unsigned key = raw & 0x7f;
    if (!key || key > 68) return ACTION_NONE;
    unsigned row = (key - 1) / 10, col = (key - 1) % 10;
    if (row >= 7 || col >= 8) return ACTION_NONE;
    unsigned x = row * 2 + (col > 3), y = col % 4;
    if (y == 3 && x == 13) return ACTION_TALK; /* Space */
    if (y == 3 && x == 8) return ACTION_NEW; /* N */
    if (y == 3 && x == 4) return ACTION_STOP; /* X */
    if (y == 1 && x == 6) return ACTION_APPROVE; /* Y */
    if (y == 2 && x == 3) return ACTION_SETUP; /* Hold S for setup */
    if (y == 2 && x == 4) return ACTION_DENY; /* D */
    if (y == 2 && x == 13) return ACTION_VOICE_CONFIRM; /* Enter */
    if (y == 0 && x == 13) return ACTION_VOICE_CANCEL; /* Backspace */
    return ACTION_NONE;
}
