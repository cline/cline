# Core Telemetry

This document tracks structured telemetry emitted by `@cline/core`.

`packages/core/src/services/telemetry/core-events.ts` is the source of truth for
event names and typed `capture*` helpers. When adding a new event constant,
adding a new helper, or changing an event payload shape, update the event
catalog below.

## Event Catalog

| Event | Helper | Required Properties | Purpose |
|---|---|---|---|
| `sdk.tool_timeout` | `captureRunCommandsTimeout` | `tool_name`, `effective_timeout_ms`, `timeout_source`, `command_count`, `duration_ms` | Emitted when the SDK `run_commands` shell executor exceeds its effective timeout and kills the command. |
