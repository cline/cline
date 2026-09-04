---
"claude-dev": patch
---

Unify telemetry transport and settings gating: all telemetry in the extension now flows through one shared set of exporters and one settings checkpoint. Runtime `CLINE_OTEL_*` configuration (the documented enterprise/self-hosted override) now applies to all telemetry in the process — previously part of it only honored build-time configuration and ignored the runtime variables.
