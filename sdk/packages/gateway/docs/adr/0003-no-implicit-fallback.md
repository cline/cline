# ADR 0003 — No implicit in-process fallback

**Status:** Accepted (Gateway RFC, Phase 0)

## Decision

When a client's selected Gateway cannot be reached, the client surfaces
`gateway_unreachable` and stops. It never silently falls back to a hidden
in-process runtime.

## Rationale

An implicit fallback forks state: runs started against a private runtime
are invisible to the authority, producing exactly the duplicate-history and
unknown-session classes of bugs the Gateway exists to eliminate. Fail-closed
beats fail-diverged.

## Consequences

- The shared contracts export `GATEWAY_CONNECT_FALLBACK = "none"` and a
  `GatewayConnectPolicySchema` whose `fallback` field is the literal
  `"none"` — a policy permitting any other value does not parse.
- The error registry reserves `gateway_unreachable`; contract tests assert
  the schema rejects every non-`"none"` fallback, and the cross-package
  boundary test rejects any new-package source that defines one.
- Deliberate in-process embedding (e.g. tests composing `@cline/bot` with
  in-memory ports) remains possible — explicitly, never as a fallback.
