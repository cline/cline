#include "protocol.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "net.h"
#include "sdkconfig.h"

static const char *TAG = "proto";

static void copy(char *dst, size_t cap, const cJSON *obj, const char *key)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (cJSON_IsString(v) && v->valuestring) {
        strlcpy(dst, v->valuestring, cap);
    } else {
        dst[0] = '\0';
    }
}

static pet_state_t parse_state(const char *s)
{
    static const char *names[] = {"idle", "working", "waiting", "listening",
                                  "thinking", "done", "error", "offline"};
    for (int i = 0; i < (int)(sizeof(names) / sizeof(names[0])); i++) {
        if (strcmp(s, names[i]) == 0) return (pet_state_t)i;
    }
    return PET_IDLE;
}

bool protocol_handle(const char *json, size_t len)
{
    cJSON *root = cJSON_ParseWithLength(json, len);
    if (!root) return false;
    const cJSON *t = cJSON_GetObjectItemCaseSensitive(root, "t");
    bool ok = true;
    app_event_t ev = {0};
    if (!cJSON_IsString(t)) {
        ok = false;
    } else if (strcmp(t->valuestring, "state") == 0) {
        char state[16];
        copy(state, sizeof(state), root, "state");
        ev.type = EV_STATE;
        ev.state.state = parse_state(state);
        copy(ev.state.tool, sizeof(ev.state.tool), root, "tool");
        copy(ev.state.session, sizeof(ev.state.session), root, "session");
        copy(ev.state.transcript, sizeof(ev.state.transcript), root, "transcript");
        copy(ev.state.reply, sizeof(ev.state.reply), root, "reply");
        copy(ev.state.err, sizeof(ev.state.err), root, "err");
        const cJSON *ap = cJSON_GetObjectItemCaseSensitive(root, "approval");
        if (cJSON_IsObject(ap)) {
            copy(ev.state.approval_id, sizeof(ev.state.approval_id), ap, "id");
            copy(ev.state.summary, sizeof(ev.state.summary), ap, "summary");
        }
        app_post(&ev);
    } else if (strcmp(t->valuestring, "voice") == 0) {
        char status[16], target[12];
        copy(status, sizeof(status), root, "status");
        copy(target, sizeof(target), root, "target");
        ev.type = EV_VOICE;
        ev.voice.status = strcmp(status, "transcribed") == 0 ? VOICE_TRANSCRIBED
                          : strcmp(status, "submitted") == 0 ? VOICE_SUBMITTED
                          : strcmp(status, "cancelled") == 0 ? VOICE_CANCELLED
                                                             : VOICE_ERROR;
        ev.voice.new_task = strcmp(target, "new") == 0;
        const cJSON *ms = cJSON_GetObjectItemCaseSensitive(root, "cancel_ms");
        ev.voice.cancel_ms = cJSON_IsNumber(ms) ? (uint16_t)ms->valueint : 0;
        copy(ev.voice.text, sizeof(ev.voice.text), root, "text");
        app_post(&ev);
    } else if (strcmp(t->valuestring, "stats") == 0) {
        const cJSON *s = cJSON_GetObjectItemCaseSensitive(root, "sessions");
        const cJSON *d = cJSON_GetObjectItemCaseSensitive(root, "today");
        ev.type = EV_STATS;
        ev.stats.sessions = cJSON_IsNumber(s) ? s->valueint : 0;
        ev.stats.today = cJSON_IsNumber(d) ? d->valueint : 0;
        app_post(&ev);
    } else if (strcmp(t->valuestring, "paired") == 0) {
        char token[64];
        copy(token, sizeof(token), root, "token");
        if (token[0]) net_store_token(token);
        ESP_LOGI(TAG, "paired");
    } else if (strcmp(t->valuestring, "welcome") == 0) {
        ev.type = EV_LINK;
        ev.link.up = true;
        strlcpy(ev.link.text, "connected", sizeof(ev.link.text));
        app_post(&ev);
    } else if (strcmp(t->valuestring, "auth_error") == 0) {
        char reason[32];
        copy(reason, sizeof(reason), root, "reason");
        ESP_LOGW(TAG, "auth error: %s", reason);
        net_forget_token();
        ev.type = EV_LINK;
        ev.link.up = false;
        strlcpy(ev.link.text, "pairing needed", sizeof(ev.link.text));
        app_post(&ev);
    } else if (strcmp(t->valuestring, "error") == 0) {
        char reason[64];
        copy(reason, sizeof(reason), root, "reason");
        ESP_LOGW(TAG, "bridge error: %s", reason);
    } else {
        ok = false;
    }
    cJSON_Delete(root);
    return ok;
}

static bool send_obj(cJSON *obj)
{
    char *s = cJSON_PrintUnformatted(obj);
    cJSON_Delete(obj);
    if (!s) return false;
    bool ok = net_send_text(s);
    cJSON_free(s);
    return ok;
}

bool protocol_send_hello(const char *token)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "t", "hello");
    cJSON_AddStringToObject(o, "token", token);
    cJSON_AddStringToObject(o, "fw", CONFIG_PET_FW_VERSION);
    return send_obj(o);
}

bool protocol_send_pair(const char *code)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "t", "pair");
    cJSON_AddStringToObject(o, "code", code);
    cJSON_AddStringToObject(o, "name", CONFIG_PET_DEVICE_NAME);
    return send_obj(o);
}

bool protocol_send_approval(const char *id, bool approve)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "t", approve ? "approve" : "deny");
    cJSON_AddStringToObject(o, "id", id);
    return send_obj(o);
}

bool protocol_send_simple(const char *type)
{
    char buf[40];
    snprintf(buf, sizeof(buf), "{\"t\":\"%s\"}", type);
    return net_send_text(buf);
}

bool protocol_send_voice_start(bool new_task)
{
    return net_send_text(new_task
        ? "{\"t\":\"voice_start\",\"rate\":16000,\"bits\":16,\"ch\":1,\"target\":\"new\"}"
        : "{\"t\":\"voice_start\",\"rate\":16000,\"bits\":16,\"ch\":1}");
}
