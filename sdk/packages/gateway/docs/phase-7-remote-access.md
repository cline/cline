# Phase 7 remote access implementation plan

## Delivered foundation

- Optional `ws://` / `wss://` listener alongside the unchanged local listener.
- A remote access credential that is independent from local discovery auth.
- `GatewayClient.connectRemote({ url, auth })` with secure URL validation.
- The same hello negotiation, commands, durable event replay, approvals,
  backpressure, and disconnect semantics on local and remote transports.
- CLI configuration for bind address, port, token secret name, and TLS files.
- Redacted status/audit metadata that identifies transport without credentials.

## Next implementation slices

1. **Desktop connection profiles**
   - Persist server URL, display name, and non-secret connection metadata.
   - Store credentials in the OS keychain.
   - Add local/remote connection selection and certificate-error UX.
   - Resume the saved client ID and event cursor after reconnect.
2. **Identity proxy contract**
   - Define signed, short-lived client assertions and stable principals.
   - Replace the shared self-hosted token for multi-user deployments.
   - Enforce bot/session ACLs before command dispatch and approval delivery.
3. **Operations**
   - Rate limits for upgrades and hello failures.
   - Health/readiness endpoints, connection metrics, and structured remote errors.
   - Certificate rotation and token rotation with overlapping validity windows.
4. **Network resilience**
   - Heartbeats, bounded reconnect backoff, offline state, and chaos tests.
   - End-to-end tests through a TLS-terminating reverse proxy.
5. **Mobile clients**
   - Reuse the remote URL/auth/session contract.
   - Keep execution and workspaces server-side; uploads are explicit artifacts.

## Explicitly separate: Gateway federation

Remote access makes a desktop or mobile app a client of one Gateway. Federation
would make one Gateway a principal of another and needs its own RFC. At minimum
that RFC must define globally qualified bot addresses, mutual Gateway identity,
delegated capabilities, cross-authority event provenance, approval routing,
workspace/artifact transfer, retry ownership, and partition behavior.

No Phase 7 API should infer federation from a remote URL or accept a foreign bot
record. This keeps one authoritative writer for every bot and session.
