# Hub protocol and Hub contract

The **Hub** is Cline's local session server. Every Cline client (the CLI, the
desktop app's sidecar, the VS Code extension, the `cline-hub` web app, and
SDK users) runs agent sessions through a Hub over one authenticated
WebSocket. The **Hub protocol** is what goes over that socket. The **Hub
contract** in this directory declares that protocol once, as zod schemas,
and everything else is derived from it.

- [Architecture](#architecture)
- [The wire protocol](#the-wire-protocol)
- [The contract](#the-contract)
- [Validation at the Hub](#validation-at-the-hub)
- [Compatibility and versioning](#compatibility-and-versioning)
- [Working on the contract](#working-on-the-contract)
- [Files](#files)

## Architecture

```text
                             ┌─────────────────────────────────────────────────────────┐
                             │                         Clients                         │
                             │  Cline CLI, desktop sidecar, VS Code extension,         │
                             │  cline-hub web app, SDK users (ClineCore remote)        │
                             └────────────────────────────┬────────────────────────────┘
                                                          ▲
                                                          │ commands, replies, events
                                                          ▼
  ┌─────────────────────────────────────────────── Hub process (@cline/core hub/) ───────────────────────────────────────────────┐
  │                                                                                                                              │
  │     ┌────────────────────────┐         ┌─────────────────────────────────────┐         ┌───────────────────────────────┐     │
  │     │    WebSocket server    │ ──────> │ HubServerTransport.dispatchCommand  │ ──────> │           Handlers            │     │
  │     │ ws://127.0.0.1:port/hub│         └──────────────────┬──────────────────┘         │ session, run, approval,       │     │
  │     └───────────▲────────────┘                            │                            │ capability, connector,        │     │
  │                 │                                         │                            │ schedule, task                │     │
  │                 │                                         │                            └──────────────┬────────────────┘     │
  │                 │                                         │                                           │                      │
  │                 │                                         │                                           ▼                      │
  │     ┌───────────┴────────────┐                            │                            ┌───────────────────────────────┐     │
  │     │    Durable event log   │ <──────────────────────────┼─────────────────────────── │         Runtime host          │     │
  │     │    sequence numbers    │       session events       │                            │    agent sessions and tools   │     │
  │     └────────────────────────┘                            │                            └───────────────────────────────┘     │
  └───────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────┘
                                                              │
                                       validates payloads     │     names and types
                                     ┌────────────────────────┴────────────────────────┐
                                     │                                                 │
                                     │                  Hub contract                   │
                                     │           @cline/shared hub-contract            │
                                     └─────────────────────────────────────────────────┘
```

A Hub listens on loopback only. Clients find it through a **discovery
record** (a JSON file with the URL, auth token, protocol version, and build
identity). The CLI and desktop start one on demand as a detached daemon.

The same Hub can run on another machine: for an SSH remote environment the
desktop runs the Hub from the host's Cline CLI (or an uploaded helper) and
reaches it through an `ssh -L` tunnel. The protocol is identical; only the
URL differs.

```text
   ┌────────────────── Your machine ──────────────────┐                      ┌──────────────────── SSH host ────────────────────┐
   │                                                  │                      │                                                  │
   │  ┌─────────────┐            ┌─────────────────┐  │   "ssh -L tunnel"    │  ┌───────────────────────┐    ┌───────────────┐  │
   │  │ Desktop app │ ─────────> │ 127.0.0.1:random│ ══════════════════════════ │ 127.0.0.1:hub port    │ ── │ Hub from host │  │
   │  └─────────────┘            └─────────────────┘  │                      │  └───────────────────────┘    │ cline --remote│  │
   │                                                  │                      │                               │ -hub-ensure   │  │
   │                                                  │                      │                               └───────────────┘  │
   └──────────────────────────────────────────────────┘                      └──────────────────────────────────────────────────┘
```

## The wire protocol

Everything is JSON text frames on the WebSocket at the Hub's path (`/hub`).
The upgrade is authorized by the token from the discovery record, sent as
the `cline-hub-auth.<token>` WebSocket subprotocol; a loopback Hub also
admits browser pages served from a loopback origin. The Hub's HTTP endpoints
(`/health`, and `/drain` and `/shutdown`, which take `Authorization: Bearer
<token>`) sit beside the socket. Each frame is a `HubTransportFrame`
(`../hub.ts`):

| `kind` | Direction | Carries |
|---|---|---|
| `command` | client → Hub | `HubCommandEnvelope`: `command` name, `requestId`, `clientId`, optional `sessionId`, `timeoutMs`, `payload` |
| `reply` | Hub → client | `HubReplyEnvelope`: `requestId`, `ok`, `payload`, or `error { code, message, details }` |
| `stream.subscribe` / `stream.unsubscribe` | client → Hub | Event subscription, optionally scoped to a session, with a `sinceSequence` replay cursor |
| `event` | Hub → client | `HubEventEnvelope`: `event` name, `sequence`, `sessionId`, `payload` |

A typical session:

```text
 Client                                 Hub                                 Runtime
   │                                     │                                     │
 1 │ ─── WebSocket upgrade ────────────> │                                     │
   │     (cline-hub-auth.<token>)        │                                     │
 2 │ ─── command client.register ──────> │                                     │
   │     { clientType, capabilities }    │                                     │
 3 │ <── reply ok { client } ─────────── │                                     │
 4 │ ─── stream.subscribe ─────────────> │                                     │
   │     { sessionId?, sinceSequence? }  │                                     │
 5 │ <── event ... ───────────────────── │                                     │
   │     (replayed after sinceSequence)  │                                     │
 6 │ ─── command session.create ───────> │                                     │
   │     { workspaceRoot, sessionConfig }│ 7                                   │
   │                                     │ ─── start session ────────────────> │
 8 │ <── reply ok { session } ────────── │                                     │
 9 │ ─── command run.start ────────────> │                                     │
   │     { sessionId, prompt }           │ 10                                  │
   │                                     │ ─── run turn ─────────────────────> │
   │                                     │ 11                                  │
   │                                     │ <── agent output ────────────────── │
12 │ <── event assistant.delta / ─────── │                                     │
   │     tool.started / tool.finished ...│                                     │
13 │ <── event approval.requested ────── │                                     │
   │     { approvalId }                  │                                     │
14 │ ─── command approval.respond ─────> │                                     │
   │     { approvalId, approved }        │                                     │
15 │ <── event run.completed ─────────── │                                     │
16 │ <── reply ok { result } ─────────── │                                     │
   │                                     │                                     │
```

Commands are request/reply, matched by `requestId`; long-running work (a
turn) also streams events. Events carry a monotonic `sequence` from the
Hub's durable log, so a client that reconnects resubscribes with its last
`sequence` and receives exactly what it missed.

## The contract

The contract names every command and event and gives each a zod schema:
command **input** (the `payload` the Hub accepts), optional command
**output** (the successful reply `payload`), and event **payload**.

```text
  ┌───────────────────────────────┐
  │           define.ts           │
  │ hubObject, hubRecord,         │
  │ conventions                   │
  └───────────────┬───────────────┘
                  │
                  ▼
  ┌───────────────────────────────┐        ┌───────────────────────────────┐
  │         commands/*.ts         │        │           events.ts           │
  │ client-hub, session, run,     │        │                               │
  │ automation                    │        │                               │
  └───────────────┬───────────────┘        └───────────────┬───────────────┘
                  │                                        │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────┐
                      │           index.ts            │
                      │ hubCommands, hubEvents,       │
                      │ hubEnvelopes                  │
                      └───────┬───┬───┬───┬───────────┘
                              │   │   │   │
             ┌────────────────┘   │   │   └───────────────────────────────────┐
             │ "keyof"            │   │                                       │ "z.toJSONSchema"
             ▼                    │   │ "validateHubCommandPayload"           ▼
  ┌───────────────────────┐       │   │                           ┌───────────────────────┐
  │        hub.ts         │       │   ▼                           │  HubProtocolDocument  │
  │ HubCommandName,       │       │ ┌───────────────────────┐     └───────────┬───────────┘
  │ HubEventName          │       │ │ Hub dispatchCommand   │                 │
  └───────────────────────┘       │ │ (invalid_payload)     │                 │ "bun run version"
                                  │ └───────────────────────┘                 ▼
                                  │                               ┌───────────────────────┐
                                  │ "z.input"                     │hub-protocol.released  │
                                  ▼                               │.json (last SDK release│
                      ┌───────────────────────┐                   └───────────┬───────────┘
                      │   HubCommandPayload,  │                               │
                      │    HubEventPayload    │                               │
                      └───────────────────────┘                               ▼
                                                                  ┌───────────────────────┐
                                                                  │ hub-protocol.test.ts  │ <─── Doc
                                                                  │ findBreakingHub       │
                                                                  │ ProtocolChanges       │
                                                                  └───────────────────────┘
```

One source of truth drives four things:

1. **Names.** `HubCommandName` and `HubEventName` in `hub.ts` are the
   registry's keys, so a command exists in the type system exactly when it
   has a schema.
2. **Types.** `HubCommandPayload<"run.start">` and `HubEventPayload<...>` are
   inferred from the schemas.
3. **Runtime validation.** The Hub checks every command payload before
   dispatch.
4. **A compatibility record.** The contract renders to plain JSON Schema,
   which is stored per SDK release and diffed for breaking changes.

### Conventions

The schemas follow rules that keep independently released installations
compatible (they are also in `define.ts`):

- **Loose objects.** `hubObject` is `z.looseObject`: declared fields are
  checked and unknown fields pass through. A newer client can send a field
  an older Hub does not know, and the Hub ignores it instead of rejecting the
  command.
- **Required only when the handler requires it.** A field is required only
  if its handler rejects the command without it. Everything else is
  optional; `.nullish()` where senders pass `null`.
- **Placeholders for deep structures.** Session configs, messages, provider
  settings, and tool inputs are `hubRecord` (any JSON object) until they get
  schemas of their own. Search for `TODO(contract)` for these and other open
  items, including commands and events that have no Hub handler or emitter
  yet.

## Validation at the Hub

```text
                      ┌─────────────────┐
                      │  command frame  │
                      └────────┬────────┘
                               │
                               ▼
                    /─────────────────────\
                   <   Hub draining and    > ─── yes ───> ┌────────────────────┐
                    \  command mutates?   /               │ reply hub_draining │
                     \───────────────────/                └────────────────────┘
                               │
                               │ no
                               ▼
                    /─────────────────────\
                   <   payload validation  > ─── off ───────────────────────────────┐
                    \        mode?        /                                         │
                     \───────────────────/                                          │
                               │                                                    │
                               │ enforce / warn                                     │
                               ▼                                                    │
                    /─────────────────────\                                         │
                   <    payload matches    > ─── yes ───────────────────────────────┤
                    \    the contract?    /                                         │
                     \───────────────────/                                          │
                               │                                                    │
                               │ no                                                 │
                               ├───────────────────────┐                            │
                               │ (warn)                │ (enforce)                  │
                               ▼                       ▼                            │
                    ┌─────────────────────┐ ┌─────────────────────┐                 │
                    │      log to         │ │       log to        │                 │
                    │  hub-daemon.log     │ │   hub-daemon.log    │                 │
                    └──────────┬──────────┘ └──────────┬──────────┘                 │
                               │                       │                            │
                               │                       ▼                            │
                               │            ┌─────────────────────┐                 │
                               │            │reply invalid_payload│                 │
                               │            │  details.issues     │                 │
                               │            │  [path, message]    │                 │
                               │            └─────────────────────┘                 │
                               │                                                    │
                               ▼                                                    ▼
                    ┌───────────────────────────────────────────────────────────────┐
                    │                       route to handler                        │
                    └───────────────────────────────────────────────────────────────┘
```

- The mode comes from `HubWebSocketServerOptions.payloadValidation`, then
  `CLINE_HUB_PAYLOAD_VALIDATION`, and defaults to `enforce`.
- Commands without a contract pass through; the dispatcher reports unknown
  commands itself.
- Rejections read like
  `Invalid approval.respond payload: approvalId: Invalid input: expected string, received undefined`.
- Handlers still enforce rules a schema cannot express, such as "a prompt or
  an attachment" on `run.start`.
- Event payloads are described by the contract but not validated at runtime.

## Compatibility and versioning

A client may use a Hub from a different installation, most importantly the
Cline CLI on an SSH host. It accepts that Hub when two things hold
(`checkRemoteHubCompatibility` in `@cline/core`):

```text
 ┌──────────────────────┐
 │     Hub reports      │
 │ coreVersion,         │
 │ protocolVersion,     │
 │ min/max client proto │
 └──────────┬───────────┘
            │
            ▼
  /───────────────────\
 <   client protocol   > ─── no ────> ┌───────────────────┐
  \ within Hub range? /               │   incompatible:   │
   \─────────────────/                │  update the app   │
            │                         └───────────────────┘
            │ yes
            ▼
  /───────────────────\
 <    Hub coreVersion  > ─── no ────> ┌───────────────────┐
  \ ≥ client version? /               │     too old:      │
   \─────────────────/                │update the host CLI│
            │                         └───────────────────┘
            │ yes
            ▼
 ┌──────────────────────┐
 │     use this Hub     │
 └──────────────────────┘
```

Because a **newer** Hub is accepted on the protocol version alone, the
protocol version must change whenever the wire changes incompatibly. The
contract makes that checkable:

- **Breaking** (needs a protocol version bump): removing a command, event, or
  field; making an input field required; narrowing an input's type or
  allowed values; making a reply or event field no longer guaranteed;
  changing a field's type.
- **Additive** (no bump): new commands, new events, new optional fields, and
  inputs that accept more than before.

`findBreakingHubProtocolChanges` applies these rules by direction: for
inputs the Hub *accepts*, every old payload must still pass; for outputs and
events the Hub *emits*, every new value must still be one old readers
handle.

The baseline is the contract of the **last SDK release**, not the last
commit, because installed clients run released code:

```text
 Pull request      hub-protocol.test.ts  bun run version  hub-protocol.released.json  sdk-publish.yml
      │                     │                   │                     │                      │
      │ ── change schema ─> │                   │                     │                      │
      │                     │ ── read released ─────────────────────> │                      │
      │                     │    contract       │                     │                      │
      │ <─ fail if breaking │                   │                     │                      │
      │    without bump ─── │                   │                     │                      │
      │                     │                   │                     │                      │
      │ [ Note: additive changes pass without touching hub-protocol.released.json ]          │
      │                     │                   │                     │                      │
      │                     │                   │ ── SDK release bump ─────────────────────> │
      │                     │                   │    --write          │                      │
      │                     │                   │    (refuses unbumped│                      │
      │                     │                   │     breaking changes│                      │
      │                     │                   │                     │                      │
      │                     │                   │                     │ <── latest publish ─ │
      │                     │                   │                     │     --check          │
      │                     │                   │                     │     (must match)     │
      │                     │                   │                     │                      │
```

Every CLI and desktop release is cut from an SDK release
(`.github/scripts/check-sdk-release.mjs` enforces this for stable
releases), so an app's `coreVersion` identifies its exact contract.

## Working on the contract

**Add a command.**

1. Add the entry to the right file in `commands/`: a `description`, an
   `input` schema that follows the conventions, and an `output` schema if
   the reply has a stable shape.
2. Handle it in the Hub's `dispatchCommand` (`@cline/core`
   `hub/server/hub-server-transport.ts`) or a handler it routes to.
3. Run `bun vitest run src/hub-contract` in `sdk/packages/shared`. Adding a
   command is additive, so the baseline stays as it is until the next SDK
   release.

**Change a field.** Make the change additive where you can: add a new
optional field instead of renaming, and accept both old and new shapes for a
release or two. If the test reports a breaking change, either make the
change additive or bump the protocol version.

**Make a breaking change.** Bump `CURRENT_HUB_PROTOCOL_VERSION` in
`../hub.ts`, and decide the client range the Hub still serves
(`MIN_CLIENT_HUB_PROTOCOL_VERSION` / `MAX_CLIENT_HUB_PROTOCOL_VERSION`).
Clients on the old protocol then get a clear "update" at connect time
instead of failures mid-session.

**Refresh the baseline by hand.** `bun run protocol:baseline` in
`sdk/packages/shared`. Normally `bun run version` does this during the SDK
release.

**Watch validation without rejecting anything.** Run a client with
`CLINE_HUB_PAYLOAD_VALIDATION=warn` and read `hub-daemon.log` in the Hub's
data directory for `hub command payload violates the contract`.

## Files

| File | Purpose |
|---|---|
| `define.ts` | Building blocks (`hubObject`, `hubRecord`, `hubEmptyInput`) and the conventions |
| `commands/client-hub.ts` | Client registration, Hub status and drain, settings, connectors, UI commands |
| `commands/session.ts` | Session lifecycle, messages, pending prompts, compaction, hooks |
| `commands/run.ts` | Turns, the run queue, approvals, capabilities, peer Hubs |
| `commands/automation.ts` | Schedules, agenda tasks, cron events |
| `events.ts` | Every event the Hub publishes |
| `index.ts` | The registry, envelope schemas, `validateHubCommandPayload`, `buildHubProtocolDocument` |
| `json-schema.ts` | Rendering to JSON Schema and `findBreakingHubProtocolChanges` |
| `hub-protocol.released.json` | Generated: the contract as of the last SDK release |
| `hub-protocol.test.ts` | Fails on breaking changes against the released contract |
| `../../scripts/hub-protocol-baseline.ts` | `--write` / `--check` for the baseline |
