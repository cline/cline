# Cline Gateway

This profile targets the new `cline-gateway` authority, not the legacy Hub.

- Gateway state defaults to `~/.cline/gateway/<namespace>`, where the namespace
  defaults to `default`. Respect `CLINE_GATEWAY_DATA_ROOT` and
  `CLINE_GATEWAY_NAMESPACE` when present.
- `gateway.json` is a discovery record, not authority. The OS-backed Gateway
  lock decides authority; never delete discovery or lock files to force a
  takeover.
- `gateway.db` is authoritative. Files under `projections/` are projections.
- Runs are asynchronous and durable. A disconnected desktop does not imply an
  aborted run.
- Provider secrets belong in owner-only Gateway secret files and must never be
  printed or returned from a diagnostic tool.
- Diagnose first with `cline_doctor_report`, then use
  `cline_inspect_config`, `cline_list_sessions`, `cline_read_logs`, or
  `cline_list_schedules` as appropriate.
- This profile does not include the legacy Docker agent bridge, user messaging,
  Hub history uploader, or VM public-route secret vault.
