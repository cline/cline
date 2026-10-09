#include <assert.h>
#include "../components/cline_ui/color/round_layout.h"
static int overlap(cline_layout_rect_t a, cline_layout_rect_t b) {
    return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}
int main(void) {
    for (int i = 0; i < ROUND_LAYOUT_COUNT; i++) {
        cline_layout_rect_t r = cline_round_layout[i];
        for (int x = r.x; x <= r.x+r.w; x += r.w)
            for (int y = r.y; y <= r.y+r.h; y += r.h) {
                int dx = x-233, dy = y-233;
                assert(dx*dx + dy*dy <= 233*233);
            }
    }
    cline_layout_rect_t avatar = cline_round_layout[ROUND_AVATAR];
    assert(avatar.x*2 + avatar.w == 466);
    for (int i = 0; i < ROUND_LAYOUT_COUNT; i++)
        if (i != ROUND_AVATAR) assert(!overlap(avatar, cline_round_layout[i]));
    assert(!overlap(cline_round_layout[ROUND_NEW], cline_round_layout[ROUND_STOP]));
    assert(!overlap(cline_round_layout[ROUND_LEFT], cline_round_layout[ROUND_RIGHT]));
    return 0;
}
