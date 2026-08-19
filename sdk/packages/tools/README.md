# `@cline/tools`

Portable, worker-safe implementations of Cline's default coding tools.

This package deliberately sits below `@cline/core`, `@cline/bot`, and
`@cline/gateway`. It owns executable tool definitions, not tool discovery,
authorization, profiles, provider/model assignment, approvals, or persistence.
Those are Gateway responsibilities.

The initial set preserves the existing Core model-facing names:

- `read_files`
- `search_codebase`
- `run_commands`
- `editor`
- `fetch_web_content`
- `ask_question` (when a client-question executor is supplied)
- `submit_and_exit`

All filesystem operations are restricted to the supplied workspace root.
Command cancellation and timeouts are cooperative. Tool failures are returned
as structured results so recoverable failures do not crash the agent loop.
