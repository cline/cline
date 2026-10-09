#pragma once
#include <stdbool.h>
#include <stddef.h>

#include "app.h"

/* Parse one bridge → device text frame; posts the matching app events.
 * Returns false for unknown / malformed frames. Pairing tokens are stored
 * via net_store_token(). */
bool protocol_handle(const char *json, size_t len);

/* Device → bridge commands (all return false when the link is down). */
bool protocol_send_hello(const char *token);
bool protocol_send_pair(const char *code);
bool protocol_send_approval(const char *id, bool approve);
bool protocol_send_simple(const char *type); /* abort, stats, voice_end, ... */
/* new_task: always start a parallel task instead of following up. */
bool protocol_send_voice_start(bool new_task);
bool protocol_send_prompt(const char *id, const char *text, bool new_task);
