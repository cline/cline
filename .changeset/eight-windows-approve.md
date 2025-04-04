---
"@cline/extension": patch
---

Fix telemetry tracking for options being ignored when users type a custom response instead of selecting an option. Previously, this was only tracked when users clicked an option button, but now it's also tracked when users type a custom response to a question with options.
