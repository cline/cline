---
"claude-dev": patch
---

Fix crash when entering decimal values starting with a dot (e.g., `.25`) in Input Price and Output Price fields of the OpenAI Compatible provider settings. The `Number()` function returns `NaN` for `"."`, causing the extension to crash. Applied the same `shouldPreserveFormat` validation logic from the Temperature field to preserve user input while typing and only parse to float on complete numbers.
