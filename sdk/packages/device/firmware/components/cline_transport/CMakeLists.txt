idf_component_register(SRCS "net.c" "protocol.c" INCLUDE_DIRS "include" REQUIRES cline_model esp_wifi esp_netif esp_event esp_http_server nvs_flash json esp_websocket_client mdns)
