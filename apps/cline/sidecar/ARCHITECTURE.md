# Cline desktop Gateway architecture

The existing React webview remains the presentation layer. Its closed desktop
command/event transport terminates in this sidecar, which is now a thin client
of the single `@cline/gateway` authority.

The sidecar discovers the namespaced Gateway and starts the bundled Gateway
when no authority is running. Bots, sessions, runs, messages, approvals,
connectors, schedules, tools, and provider selection belong to the Gateway.
The desktop process keeps only ephemeral socket subscriptions and the mapping
from an active session to its current run.

No desktop code imports `@cline/core`, starts a Hub, reads Hub persistence, or
maintains a second session database. The webview protocol is retained so the
UI does not need to change while the backend authority changes.
