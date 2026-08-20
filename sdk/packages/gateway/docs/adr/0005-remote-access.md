# ADR 0005: Remote client access is not Gateway federation

## Status

Accepted for Phase 7.

## Decision

Gateway keeps its loopback NDJSON listener and mode-0600 discovery secret for
same-machine clients. An operator may additionally enable a WebSocket listener:

- `wss://` is required outside loopback by default;
- the remote listener uses a separate owner-managed access token;
- credentials never appear in the endpoint URL, discovery record, status,
  events, audit metadata, or logs;
- remote connections enter the existing hello negotiation, command,
  idempotency, event replay, approval, and disconnect semantics;
- a remote disconnect never aborts a run.

The direct listener is useful for a single-user/self-hosted deployment. A
production multi-user service should terminate TLS and identity at a dedicated
access proxy and eventually replace the shared token with short-lived scoped
credentials. The wire transport is not an authorization model by itself.

## Authority boundary

A client connected remotely can operate only on bots owned by that Gateway.
This phase does **not** allow a Gateway to attach to, import, proxy, or control a
bot owned by another Gateway. Bot IDs are meaningful inside one authority and
all writes remain serialized by that authority's database and lock.

Gateway federation would require a separate protocol covering stable Gateway
identity, mutual authentication, bot addressing, capability delegation,
cross-authority approvals, event provenance, failure semantics, and ownership
transfer. Remote client access deliberately introduces none of those behaviors.
