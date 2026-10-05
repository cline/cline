#include "net.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "app.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_websocket_client.h"
#include "esp_wifi.h"
#include "freertos/event_groups.h"
#include "mdns.h"
#include "nvs.h"
#include "protocol.h"
#include "sdkconfig.h"

static const char *TAG = "net";
#define NVS_NS "pet"
#define BIT_GOT_IP BIT0
#define BIT_WS_DOWN BIT1

static EventGroupHandle_t s_events;
static esp_websocket_client_handle_t s_ws;
static volatile bool s_ws_up;
static int s_ws_failures;

/* ---- NVS helpers -------------------------------------------------------- */

static bool nvs_get(const char *key, char *out, size_t cap)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK) return false;
    size_t len = cap;
    esp_err_t err = nvs_get_str(h, key, out, &len);
    nvs_close(h);
    return err == ESP_OK && out[0];
}

static void nvs_put(const char *key, const char *value)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) return;
    if (value) nvs_set_str(h, key, value);
    else nvs_erase_key(h, key);
    nvs_commit(h);
    nvs_close(h);
}

void net_store_token(const char *token)
{
    nvs_put("token", token);
    nvs_put("code", NULL); /* pairing codes are single-use */
}

void net_forget_token(void) { nvs_put("token", NULL); }

void net_factory_setup(void)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_erase_all(h);
        nvs_commit(h);
        nvs_close(h);
    }
    esp_restart();
}

static void post_link(bool up, const char *text)
{
    app_event_t ev = {.type = EV_LINK};
    ev.link.up = up;
    strlcpy(ev.link.text, text, sizeof(ev.link.text));
    app_post(&ev);
}

/* ---- Setup portal (soft AP + one HTML form) ----------------------------- */

static const char SETUP_HTML[] =
    "<!doctype html><meta name=viewport content='width=device-width'>"
    "<title>Cline Pet setup</title><style>body{font:16px system-ui;max-width:420px;margin:2em auto;"
    "padding:0 1em}input{width:100%;padding:.5em;margin:.2em 0 1em;box-sizing:border-box}</style>"
    "<h2>Cline Pet setup</h2><form method=post action=/save>"
    "Wi-Fi name<input name=ssid required>Wi-Fi password<input name=pass type=password>"
    "Pairing code <small>(run <code>cline-device-bridge --pair</code>)</small>"
    "<input name=code inputmode=numeric pattern='[0-9]{6}' required>"
    "Bridge address <small>(optional, host:port; blank = auto-discover)</small><input name=host>"
    "<input type=submit value=Save></form>";

static void url_decode(char *s)
{
    char *o = s;
    for (; *s; s++) {
        if (*s == '+') {
            *o++ = ' ';
        } else if (*s == '%' && s[1] && s[2]) {
            char hex[3] = {s[1], s[2], 0};
            *o++ = (char)strtol(hex, NULL, 16);
            s += 2;
        } else {
            *o++ = *s;
        }
    }
    *o = '\0';
}

static esp_err_t portal_get(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, SETUP_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t portal_save(httpd_req_t *req)
{
    char body[512] = {0};
    int len = httpd_req_recv(req, body, sizeof(body) - 1);
    if (len <= 0) return ESP_FAIL;
    const char *keys[] = {"ssid", "pass", "code", "host"};
    for (int i = 0; i < 4; i++) {
        char value[96] = {0};
        if (httpd_query_key_value(body, keys[i], value, sizeof(value)) == ESP_OK) {
            url_decode(value);
            nvs_put(keys[i], value[0] ? value : NULL);
        }
    }
    net_forget_token();
    httpd_resp_sendstr(req, "<h2>Saved. Cline Pet is restarting&hellip;</h2>");
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();
    return ESP_OK;
}

/* Answer every HTTP probe with the form so phones pop the captive sheet. */
static esp_err_t portal_404(httpd_req_t *req, httpd_err_code_t err)
{
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
    return httpd_resp_send(req, NULL, 0);
}

static void start_portal(void)
{
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
    char ssid[32];
    snprintf(ssid, sizeof(ssid), "ClinePet-%02X%02X", mac[4], mac[5]);

    esp_netif_create_default_wifi_ap();
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    wifi_config_t ap = {.ap = {.channel = 6, .max_connection = 2, .authmode = WIFI_AUTH_OPEN}};
    strlcpy((char *)ap.ap.ssid, ssid, sizeof(ap.ap.ssid));
    ap.ap.ssid_len = strlen(ssid);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap));
    ESP_ERROR_CHECK(esp_wifi_start());

    httpd_handle_t server = NULL;
    httpd_config_t hc = HTTPD_DEFAULT_CONFIG();
    ESP_ERROR_CHECK(httpd_start(&server, &hc));
    httpd_uri_t get = {.uri = "/", .method = HTTP_GET, .handler = portal_get};
    httpd_uri_t save = {.uri = "/save", .method = HTTP_POST, .handler = portal_save};
    httpd_register_uri_handler(server, &get);
    httpd_register_uri_handler(server, &save);
    httpd_register_err_handler(server, HTTPD_404_NOT_FOUND, portal_404);

    app_event_t ev = {.type = EV_SETUP};
    snprintf(ev.text, sizeof(ev.text), "Join Wi-Fi %s then open 192.168.4.1", ssid);
    app_post(&ev);
    ESP_LOGI(TAG, "setup portal on %s", ssid);
}

/* ---- Station + bridge WebSocket ----------------------------------------- */

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(s_events, BIT_GOT_IP);
        post_link(false, "wifi lost");
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(s_events, BIT_GOT_IP);
    }
}

static void ws_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    esp_websocket_event_data_t *d = data;
    switch (id) {
    case WEBSOCKET_EVENT_CONNECTED: {
        s_ws_up = true;
        s_ws_failures = 0;
        char token[64], code[12];
        if (nvs_get("token", token, sizeof(token))) {
            protocol_send_hello(token);
        } else if (nvs_get("code", code, sizeof(code))) {
            protocol_send_pair(code);
        } else {
            post_link(false, "pairing needed");
        }
        break;
    }
    case WEBSOCKET_EVENT_DATA:
        /* Bridge frames are small and never fragmented. */
        if (d->op_code == 0x1 && d->payload_offset == 0 && d->data_len == d->payload_len) {
            protocol_handle(d->data_ptr, d->data_len);
        }
        break;
    case WEBSOCKET_EVENT_DISCONNECTED:
    case WEBSOCKET_EVENT_ERROR:
        if (s_ws_up) post_link(false, "bridge lost");
        s_ws_up = false;
        if (++s_ws_failures >= 5) xEventGroupSetBits(s_events, BIT_WS_DOWN);
        break;
    default:
        break;
    }
}

static bool discover_bridge(char *host, size_t cap, uint16_t *port)
{
    char manual[96];
    if (nvs_get("host", manual, sizeof(manual))) {
        char *colon = strrchr(manual, ':');
        *port = colon ? (uint16_t)atoi(colon + 1) : CONFIG_PET_BRIDGE_DEFAULT_PORT;
        if (colon) *colon = '\0';
        strlcpy(host, manual, cap);
        return true;
    }
    mdns_result_t *results = NULL;
    if (mdns_query_ptr("_clinepet", "_tcp", 3000, 4, &results) != ESP_OK || !results) return false;
    bool found = false;
    for (mdns_result_t *r = results; r && !found; r = r->next) {
        for (mdns_ip_addr_t *a = r->addr; a; a = a->next) {
            if (a->addr.type == ESP_IPADDR_TYPE_V4) {
                snprintf(host, cap, IPSTR, IP2STR(&a->addr.u_addr.ip4));
                *port = r->port;
                found = true;
                break;
            }
        }
    }
    mdns_query_results_free(results);
    return found;
}

static void net_task(void *arg)
{
    for (;;) {
        xEventGroupWaitBits(s_events, BIT_GOT_IP, pdFALSE, pdTRUE, portMAX_DELAY);
        post_link(false, "finding bridge");
        char host[64];
        uint16_t port;
        if (!discover_bridge(host, sizeof(host), &port)) {
            post_link(false, "no bridge found");
            vTaskDelay(pdMS_TO_TICKS(5000));
            continue;
        }
        char uri[96];
        snprintf(uri, sizeof(uri), "ws://%s:%u/device", host, port);
        ESP_LOGI(TAG, "bridge at %s", uri);
        post_link(false, "connecting");
        esp_websocket_client_config_t cfg = {
            .uri = uri,
            /* > one audio frame (2 + 2048 B) so frames go out unfragmented. */
            .buffer_size = 4096,
            .reconnect_timeout_ms = 3000,
            .network_timeout_ms = 5000,
            .ping_interval_sec = 30,
            .task_stack = 6144,
        };
        s_ws_failures = 0;
        xEventGroupClearBits(s_events, BIT_WS_DOWN);
        s_ws = esp_websocket_client_init(&cfg);
        esp_websocket_register_events(s_ws, WEBSOCKET_EVENT_ANY, ws_event, NULL);
        esp_websocket_client_start(s_ws);
        /* Let the client auto-reconnect; after repeated failures, rediscover
         * (the laptop may have changed IP or the bridge port). */
        xEventGroupWaitBits(s_events, BIT_WS_DOWN, pdTRUE, pdTRUE, portMAX_DELAY);
        esp_websocket_client_handle_t old = s_ws;
        s_ws = NULL;
        s_ws_up = false;
        esp_websocket_client_destroy(old);
    }
}

void net_start(void)
{
    s_events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    char ssid[33], pass[65] = "";
    if (!nvs_get("ssid", ssid, sizeof(ssid))) {
        start_portal();
        return;
    }
    nvs_get("pass", pass, sizeof(pass));

    esp_netif_create_default_wifi_sta();
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL);
    wifi_config_t sta = {0};
    strlcpy((char *)sta.sta.ssid, ssid, sizeof(sta.sta.ssid));
    strlcpy((char *)sta.sta.password, pass, sizeof(sta.sta.password));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &sta));
    ESP_ERROR_CHECK(esp_wifi_start());
    /* Modem sleep between DTIM beacons; the radio idles while nothing happens. */
    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);

    ESP_ERROR_CHECK(mdns_init());
    post_link(false, "joining wifi");
    xTaskCreatePinnedToCore(net_task, "net", 6144, NULL, 5, NULL, 0);
}

bool net_link_up(void) { return s_ws_up; }

bool net_send_text(const char *json)
{
    esp_websocket_client_handle_t ws = s_ws;
    if (!ws || !s_ws_up) return false;
    return esp_websocket_client_send_text(ws, json, strlen(json), pdMS_TO_TICKS(2000)) >= 0;
}

bool net_send_binary(const uint8_t *data, size_t len)
{
    esp_websocket_client_handle_t ws = s_ws;
    if (!ws || !s_ws_up) return false;
    /* A failed/timed-out send makes esp_websocket_client drop the whole
     * connection, so give Wi-Fi generous headroom rather than failing fast. */
    return esp_websocket_client_send_bin(ws, (const char *)data, len, pdMS_TO_TICKS(2000)) >= 0;
}
