---
"claude-dev": patch
---

Honor the IDE telemetry level consistently: with VS Code's `telemetry.telemetryLevel` set to `error` or `crash`, only error events are reported from every telemetry path in the extension. Previously part of the telemetry ignored the level and reported usage events anyway.
