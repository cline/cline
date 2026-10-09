#pragma once
#include <string.h>
/* Host libc may not supply strlcpy; ESP-IDF does. */
#ifdef strlcpy
#undef strlcpy
#endif
#define strlcpy test_strlcpy
static inline size_t test_strlcpy(char *dst, const char *src, size_t cap) {
    size_t len = strlen(src);
    if (cap) { size_t n = len < cap - 1 ? len : cap - 1; memcpy(dst, src, n); dst[n] = 0; }
    return len;
}
