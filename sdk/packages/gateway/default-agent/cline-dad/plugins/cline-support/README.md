# Cline Support for Gateway

This Agent Plugin contributes five MCP tools to Cline Dad:

- `cline_doctor_report`: discovery, process, database, provider, plugin, and
  durable state summary.
- `cline_inspect_config`: effective Gateway paths and optional workspace config.
- `cline_list_sessions`: sessions with their latest durable run state/error.
- `cline_read_logs`: redacted Gateway/Desktop log tails when persisted logs
  exist; otherwise it accurately reports that stderr is owned by the launcher.
- `cline_list_schedules`: Gateway schedules and recent durable schedule jobs.

The plugin reads the active namespace selected by `CLINE_GATEWAY_DATA_ROOT` and
`CLINE_GATEWAY_NAMESPACE` (default `~/.cline/gateway/default`). It opens
`gateway.db` read-only and never reads secret-file contents or provider values.

This is not the legacy Hub support plugin. It does not inspect `sessions.db`,
`cron.db`, `hub-daemon.log`, Docker, or VM networking.
