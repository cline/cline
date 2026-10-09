#include "cline_surface.h"
#include "cline_board.h"
#include "cline_board_color.h"
#include "app.h"
#include "lvgl.h"
#include "round_layout.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static lv_obj_t *root, *counts, *speech, *status, *avatar, *new_button, *stop_button, *talk_button;
static lv_obj_t *left_button, *right_button, *key_hints;
static bool compact;
static lv_obj_t *editor;
static uint16_t *pixels;
static const sprite_t *last_sprite;
typedef cline_layout_rect_t rect_t;
static rect_t new_rect, stop_rect, talk_rect, left_rect, right_rect;
static int width, height;
static int sx(int n) { return n * width / 466; }
static int sy(int n) { return n * height / 466; }
static rect_t rect(int x, int y, int w, int h) { return (rect_t){sx(x), sy(y), sx(w), sy(h)}; }
static rect_t round_rect(cline_round_region_t region) {
    rect_t r = cline_round_layout[region];
    return rect(r.x, r.y, r.w, r.h);
}
static bool inside(rect_t r, int x, int y) { return x >= r.x && x < r.x+r.w && y >= r.y && y < r.y+r.h; }
static void touch_event(lv_event_t *e) {
    lv_event_code_t code = lv_event_get_code(e);
    if (code != LV_EVENT_PRESSED && code != LV_EVENT_RELEASED && code != LV_EVENT_PRESS_LOST) return;
    lv_indev_t *input = lv_indev_active();
    if (!input) return;
    lv_point_t point;
    lv_indev_get_point(input, &point);
    app_event_t ev = {.type = code == LV_EVENT_PRESSED ? EV_TOUCH_DOWN : EV_TOUCH_UP,
                      .touch = {.x = point.x, .y = point.y}};
    app_post(&ev);
}
static lv_obj_t *label(lv_obj_t *parent, rect_t r) {
    lv_obj_t *o = lv_label_create(parent);
    lv_obj_set_pos(o, r.x, r.y); lv_obj_set_size(o, r.w, r.h);
    lv_label_set_long_mode(o, LV_LABEL_LONG_MODE_WRAP);
    lv_obj_set_style_text_align(o, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(o, lv_color_hex(0xf2eaff), 0);
    return o;
}
static lv_obj_t *button(rect_t r, const char *text) {
    lv_obj_t *o = lv_button_create(root);
    lv_obj_set_pos(o, r.x, r.y); lv_obj_set_size(o, r.w, r.h);
    lv_obj_set_style_bg_color(o, lv_color_hex(0x312647), 0);
    lv_obj_add_flag(o, LV_OBJ_FLAG_EVENT_BUBBLE);
    lv_obj_t *l = lv_label_create(o); lv_label_set_text(l, text); lv_obj_center(l);
    return o;
}
static void show(lv_obj_t *o, bool visible) {
    if (visible) lv_obj_remove_flag(o, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
}
static void set_text(lv_obj_t *o, const char *text) {
    if (strcmp(lv_label_get_text(o), text) != 0) lv_label_set_text(o, text);
}
static void button_text(lv_obj_t *o, const char *text) { set_text(lv_obj_get_child(o, 0), text); }
esp_err_t surface_init(void) {
    ESP_ERROR_CHECK(board_color_init());
    const cline_board_info_t *info = board_info(); width = info->width; height = info->height;
    compact = !info->touch && width > height;
    pixels = calloc(96 * 96, sizeof(uint16_t));
    if (!pixels) return ESP_ERR_NO_MEM;
    if (!board_color_lock()) return ESP_FAIL;
    root = lv_obj_create(lv_screen_active());
    lv_obj_remove_style_all(root); lv_obj_set_size(root, width, height);
    lv_obj_set_style_bg_color(root, lv_color_hex(0x14111f), 0);
    lv_obj_set_style_bg_opa(root, LV_OPA_COVER, 0);
    lv_obj_remove_flag(root, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(root, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(root, touch_event, LV_EVENT_ALL, NULL);
    if (compact) {
        /* Keyboard devices use a landscape layout and contextual key hints. */
        counts = label(root, (rect_t){4, 3, width - 8, 16});
        speech = label(root, (rect_t){108, 24, width - 112, 66});
        lv_obj_set_style_text_align(speech, LV_TEXT_ALIGN_LEFT, 0);
        lv_label_set_long_mode(speech, LV_LABEL_LONG_MODE_DOTS);
        avatar = lv_canvas_create(root);
        lv_obj_set_pos(avatar, 4, 24);
        status = label(root, (rect_t){108, 96, width - 112, 18});
        editor = lv_textarea_create(root);
        lv_obj_set_pos(editor, 4, 24); lv_obj_set_size(editor, width - 8, 72);
        lv_obj_set_style_text_color(editor, lv_color_hex(0xf2eaff), 0);
        lv_obj_set_style_bg_color(editor, lv_color_hex(0x312647), 0);
        lv_textarea_set_text(editor, "");
        show(editor, false);
        key_hints = label(root, (rect_t){0, height - 17, width, 16});
        lv_obj_set_style_text_color(key_hints, lv_color_hex(0xccbaff), 0);
    } else {
        /* Touch controls lie in the round display's safe chord. */
        counts = label(root, round_rect(ROUND_COUNTS));
        speech = label(root, round_rect(ROUND_SPEECH));
        lv_label_set_long_mode(speech, LV_LABEL_LONG_MODE_DOTS);
        lv_obj_set_style_bg_color(speech, lv_color_hex(0x312647), 0);
        lv_obj_set_style_bg_opa(speech, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(speech, 18, 0);
        lv_obj_set_style_pad_all(speech, 8, 0);
        avatar = lv_canvas_create(root);
        rect_t avatar_rect = round_rect(ROUND_AVATAR);
        lv_obj_set_pos(avatar, avatar_rect.x, avatar_rect.y);
        lv_image_set_pivot(avatar, 0, 0);
        lv_image_set_scale(avatar, avatar_rect.w * 256 / 96);
        status = label(root, round_rect(ROUND_STATUS));
        new_rect = round_rect(ROUND_NEW); stop_rect = round_rect(ROUND_STOP);
        talk_rect = round_rect(ROUND_TALK);
        left_rect = round_rect(ROUND_LEFT); right_rect = round_rect(ROUND_RIGHT);
        new_button = button(new_rect, "+ New"); stop_button = button(stop_rect, "Stop");
        talk_button = button(talk_rect, "Hold to talk");
        left_button = button(left_rect, "Cancel"); right_button = button(right_rect, "Send");
    }
    board_color_unlock();
    return ESP_OK;
}
uint32_t surface_frame_period(mood_t mood) {
    return mood == MOOD_WORKING || mood == MOOD_WAITING || mood == MOOD_DONE ? 200 : mood == MOOD_IDLE ? 2500 : 0;
}
void surface_render(const cline_view_t *v, bool full) {
    (void)full;
    if (!board_color_lock()) return;
    char text[48]; snprintf(text, sizeof(text), "%u active  /  %u today", v->active, v->today);
    set_text(counts, text); set_text(speech, v->speech);
    static const char *moods[] = {"Ready", "Working", "Approval needed", "Listening", "Thinking", "Done", "Error", "Sleeping", "Offline"};
    set_text(status, moods[v->mood]);
    const animation_t *a = gfx_animation(v->mood);
    const sprite_t *spr = a->frames[v->frame % a->count];
    if (spr != last_sprite) {
        const uint16_t ink = lv_color_to_u16(lv_color_hex(0xccbaff));
        const uint16_t bg = lv_color_to_u16(lv_color_hex(0x14111f));
        for (int y = 0; y < 96; y++) for (int x = 0; x < 96; x++) {
            bool bit = x < spr->w && y < spr->h && (spr->bits[y * ((spr->w + 7) / 8) + x / 8] & (0x80 >> (x % 8)));
            pixels[y * 96 + x] = bit ? ink : bg;
        }
        lv_canvas_set_buffer(avatar, pixels, 96, 96, LV_COLOR_FORMAT_RGB565);
        lv_obj_invalidate(avatar);
        last_sprite = spr;
    }
    if (compact) {
        show(editor, v->typing); show(avatar, !v->typing); show(speech, !v->typing);
        lv_obj_set_pos(status, v->typing ? 4 : 108, v->typing ? 99 : 96);
        lv_obj_set_width(status, v->typing ? width - 8 : width - 112);
        lv_label_set_long_mode(status, LV_LABEL_LONG_MODE_DOTS);
        if (v->typing) {
            if (strcmp(lv_textarea_get_text(editor), v->draft) != 0) {
                lv_textarea_set_text(editor, v->draft);
                lv_textarea_set_cursor_pos(editor, LV_TEXTAREA_CURSOR_LAST);
            }
            set_text(status, v->speech);
        }
        const char *hint = v->typing ? (v->submitting ? "Waiting for bridge..." : "Enter Send  Fn+Esc Cancel") : !v->connected ? "Connect in the setup page" :
            v->approval ? "Y Approve   D Deny" :
            v->voice_pending ? "Enter Send   Bksp Cancel" :
            v->recording ? "Release Space to send" :
            v->running ? "T Type  Space Talk  X Stop" : "T Type  Space Talk  N New";
        set_text(key_hints, hint);
        board_color_unlock();
        return;
    }
    bool choices = v->connected && (v->approval || v->voice_pending);
    show(left_button, choices); show(right_button, choices);
    button_text(left_button, v->approval ? "Approve" : "Cancel");
    button_text(right_button, v->approval ? "Deny" : "Send");
    show(new_button, v->connected && !choices); show(stop_button, v->running && !choices);
    show(talk_button, v->mic && !choices);
    button_text(talk_button, v->recording ? "Release to send" : "Hold to talk");
    board_color_unlock();
}
cline_action_t surface_hit_test(const cline_view_t *v, int x, int y) {
    if (compact) return ACTION_NONE;
    if (!v->connected) return ACTION_STATS;
    if (v->approval || v->voice_pending) {
        if (inside(left_rect,x,y)) return v->approval ? ACTION_APPROVE : ACTION_VOICE_CANCEL;
        if (inside(right_rect,x,y)) return v->approval ? ACTION_DENY : ACTION_VOICE_CONFIRM;
        return ACTION_STATS;
    }
    if (v->mic && inside(talk_rect,x,y)) return ACTION_TALK;
    if (inside(new_rect,x,y)) return ACTION_NEW;
    if (v->running && inside(stop_rect,x,y)) return ACTION_STOP;
    return ACTION_STATS;
}
void surface_sleep(bool sleep) { board_color_sleep(sleep); }
