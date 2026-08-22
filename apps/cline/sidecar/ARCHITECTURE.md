# Cline desktop Gateway architecture

The existing React webview remains the presentation layer. Its closed desktop
command/event transport terminates in this sidecar, which is now a thin client
of the single `@cline/gateway` authority.

Every bridge uses the fixed `desktop` namespace. It first discovers a running
authority; if none exists, it invokes the bundled `clinegate start` lifecycle
command. That operation is idempotent and the Gateway's OS-level namespace
lock permits exactly one authority. Concurrent bridges all reconnect to the
winner. A bridge exit closes only its client connection—it never sends
`gateway.stop`, owns the authority child process, or kills it.

Bots, sessions, runs, messages, approvals, connectors, schedules, tools,
provider selection, secrets, and persistence belong to the Gateway. The
desktop bridge keeps only ephemeral socket subscriptions and the mapping from
an active session to its current run. Connector credentials are sent over the
authenticated local protocol and written by the Gateway; the bridge never
resolves Gateway data paths.

No desktop production code imports `@cline/core`, `@cline/sdk`, or
`@cline/cline-hub`; launches another app's backend; or maintains a second
session database. `architecture.test.ts` enforces the direct and transitive
package graph, source imports, native launch path, bundled resources, and
process-ownership boundary in development and release builds.
