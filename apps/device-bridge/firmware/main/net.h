#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Wi-Fi (or the setup portal when unconfigured), bridge discovery over mDNS,
 * and the bridge WebSocket with automatic reconnect. */
void net_start(void);
bool net_link_up(void);
bool net_send_text(const char *json);
bool net_send_binary(const uint8_t *data, size_t len);
void net_store_token(const char *token);
void net_forget_token(void);
/* Erase Wi-Fi + pairing and reboot into the setup portal. */
void net_factory_setup(void);
