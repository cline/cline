# ARD-0013: Three-lane Drive state partition

## Status

Accepted

## Metadata

- Date: 2026-07-29
- Deciders: Drivecode planning (cline-drivemode)
- Related: D2 / D7 / D10 in [01-architecture.md](../01-architecture.md), [04-future-multi-user.md](../04-future-multi-user.md), [DRV-EVENTS](../features/DRV-EVENTS.md), [ops/hub-drive-ops.md](../ops/hub-drive-ops.md)

## Context

Local MVP room state lived only in hub process memory: fold `DriveEvent` → `RoomSnapshot`, broadcast, drop history. A second in-memory map held director / spotlight live state. Facets already had a durable disk path. Enterprise shareability (remote multi-human rooms, org-managed config, audit / replay) must not require a rewrite of reducers or event schemas.

## Decision

Drive state is partitioned into three lanes:

1. **Event log (durable).** Append-only records keyed by `roomId` + monotonic `seq`. Payload is a versioned `DriveEvent` (and later a bank family envelope). Survives hub restart. Authority for history, reconnect gaps, and future audit bundles.
2. **Live room (ephemeral).** One hub-owned `RoomSnapshot` (plus live director fields owned by the same store) folded from the log. Process memory only; rebuildable by replaying the log. Single writer. Dual live Maps are forbidden.
3. **Facets (durable).** `.cline/drive` disk contract, hub-written. Seeds live values at room create. Must never overwrite live mid-call.

**Adapters later (not this ADR's implementation):** remote participant bridge, org IdP / admin config, audit export. They bind to the log + `DriveHostPort`, not to a second room model.

**Locks:**

- Hub `ws://127.0.0.1:25463` remains the only writer of room state for local MVP.
- `reduceRoom` stays pure in `@cline/drive`. IO lives in `@cline/core` hub.
- Privacy-strict: no raw audio or full transcripts on the log.
- Do not port cursor-drive MCP `:7891`.

## Consequences

**Positive**

- Hub restart and client reconnect restore room truth without inventing a new schema.
- Remote / org / audit can attach as adapters.
- UI keeps projecting from one live snapshot.

**Negative**

- Local disk I/O on every room commit.
- Live director / spotlight must converge into the collaboration store (not a second Map).

## Alternatives considered

- Keep RAM-only rooms until remote lands → rejected; forces a later rewrite.
- CRDT multi-writer → rejected (D2 / D4).
- Reuse status-hub SQLite changelog for room events → rejected; different domain (ARD-0005).

## Links

- [01-architecture.md](../01-architecture.md) D10
- Implementation plan: Drive three-lane state partition
- Bank markdown projection remains under `.drive/bank/`; bank **history** appends under `.cline/drive/bank/events.jsonl` (envelope `family: "bank"`). Unifying the markdown root is deferred.
