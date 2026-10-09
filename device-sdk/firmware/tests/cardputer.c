#include <assert.h>
#include "../components/cline_board/cardputer/keys.h"
static uint8_t key(unsigned x, unsigned y) {
    return (x / 2) * 10 + y + (x % 2) * 4 + 1;
}
int main(void) {
    assert(cardputer_key_action(key(13, 3) | 0x80) == ACTION_TALK);
    assert(cardputer_key_action(key(13, 3)) == ACTION_TALK);
    assert(cardputer_key_action(key(8, 3)) == ACTION_NEW);
    assert(cardputer_key_action(key(4, 3)) == ACTION_STOP);
    assert(cardputer_key_action(key(6, 1)) == ACTION_APPROVE);
    assert(cardputer_key_action(key(3, 2)) == ACTION_SETUP);
    assert(cardputer_key_action(key(4, 2)) == ACTION_DENY);
    assert(cardputer_key_action(key(13, 2)) == ACTION_VOICE_CONFIRM);
    assert(cardputer_key_action(key(13, 0)) == ACTION_VOICE_CANCEL);
    assert(cardputer_key_action(key(2, 1)) == ACTION_NONE);
    assert(cardputer_key_action(0) == ACTION_NONE);
    assert(cardputer_key_action(0x80) == ACTION_NONE);
    for (unsigned raw = 69; raw < 128; raw++) assert(cardputer_key_action(raw) == ACTION_NONE);
    for (unsigned row = 0; row < 7; row++) {
        assert(cardputer_key_action(row * 10 + 9) == ACTION_NONE);
        assert(cardputer_key_action(row * 10 + 10) == ACTION_NONE);
    }
    assert(cardputer_key_character(key(3, 2), false, false) == 's');
    assert(cardputer_key_character(key(3, 2), true, false) == 'S');
    assert(cardputer_key_character(key(8, 3), true, false) == 'N');
    assert(cardputer_key_character(key(13, 1), false, false) == '\\');
    assert(cardputer_key_character(key(12, 2), true, false) == '"');
    assert(cardputer_key_character(key(1, 0), true, false) == '!');
    assert(cardputer_key_character(key(0, 0), false, true) == 27);
    assert(cardputer_key_character(key(13, 2), false, false) == '\n');
    assert(cardputer_key_character(key(13, 0), false, false) == '\b');
    assert(cardputer_key_character(key(1, 2), false, false) == 0);
    assert(cardputer_key_character(0xff, false, false) == 0);
    return 0;
}
