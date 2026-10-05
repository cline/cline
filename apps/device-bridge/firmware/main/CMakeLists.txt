idf_component_register(
    SRCS "app_main.c" "audio.c" "epd.c" "gfx.c" "net.c" "protocol.c" "touch.c" "ui.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_driver_i2s esp_driver_i2c esp_driver_spi esp_driver_gpio
             esp_wifi esp_netif esp_event esp_http_server nvs_flash json
)
