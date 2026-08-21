# Design: Hub upgrade lifecycle — serving new clients without killing the old Hub

- **Status:** Proposal (design-only; no runtime change in this PR)
- **Reviewer:** @abeatrix
- **Scope:** `@cline/core` `src/hub/*`, CLI/desktop hub attach paths
- **Related:** #13177, #13230, #13231, #13233, #13168, #13145, #13078

## Problem

#13231 made a newer Cline client **defer replacing** a running Hub daemon that is
serving live sessions: retiring a Hub kills its WebSockets and every in-flight turn
dies with an abnormal close (code 1006), because the agent loop executes *inside*
the Hub process. That deferral was correct — but the fallback it chose was for the
newer client to **attach to the older Hub** over the (single, coarse) `v1` wire
protocol. A newer client that actually needs newer Hub-side code — new commands,
new handler behavior, bug fixes — now runs against old code and breaks, and a
long-lived attached client (notably the desktop app) can pin the old Hub
**indefinitely**.

We need both:

1. In-flight work on the current Hub is never aborted by an upgrade.
2. A newer client that requires a newer Hub can attach, start sessions, and use
   new APIs without asking the user to kill anything.

---

## 1. Current-state map

### 1.1 What the Hub is and where sessions actually run

- The Hub is a detached daemon (`sdk/packages/core/src/hub/daemon/entry.ts`)
  hosting a WebSocket server
  (`sdk/packages/core/src/hub/server/hub-websocket-server.ts`,
  `startHubWebSocketServer`) on loopback TCP, default port `25463`
  (`CLINE_HUB_PORT` in `sdk/packages/shared/src/rpc/index.ts`; dev fallback
  `25466`), path `/hub`.
- **The agent loop runs in the Hub daemon process itself.** `HubServerTransport`
  (`sdk/packages/core/src/hub/server/hub-server-transport.ts`) constructs an
  in-process `LocalRuntimeHost` + `CoreSessionService(SqliteSessionStore)` and
  dispatches all `session.*` / `run.*` commands against it. There are **no spoke
  subprocesses** despite `docs/sdk/architecture/hub-spoke.mdx` describing them —
  that doc is aspirational, not current code. This is why "don't interrupt" and
  "don't kill the daemon" are the same constraint today.
- Also resident in the daemon: the schedule runner (`HubScheduleService` →
  `CronRunner` over `cron.db`), the agenda task manager (`AgendaTaskManager` over
  `tasks.db`), the optional `CronService` file watcher, and the connector
  supervisor (connectors are adopted subprocesses; daemon cleanup disposes the
  supervisor but leaves connector processes running).
- Persisted to disk (survives Hub death): session rows + message artifacts
  (SQLite + files under the Cline data dir), agenda tasks, cron/schedule specs and
  run leases. In-memory only (lost on Hub death): live `ActiveSession` agent
  instances, in-flight turns and provider streams, participants, pending
  approvals/capability RPCs.

### 1.2 Discovery, start, attach

- **Discovery record**: a JSON file per "owner context". Production is a
  singleton: `~/.cline/data/locks/hub/production.json`
  (`resolveProductionHubOwnerContext`,
  `sdk/packages/core/src/hub/discovery/workspace.ts`). Development scopes the
  owner by build id (`resolveSharedHubOwnerContext`), so **differing dev builds
  already run side-by-side Hubs** — a precedent this proposal builds on. The
  record (`HubServerDiscoveryRecord`, `sdk/packages/core/src/hub/discovery/index.ts`)
  carries `hubId`, protocol version + min/max client protocol, `capabilities`,
  `coreVersion`, `buildId`, `buildEpochMs`, a per-daemon random 32-byte
  `authToken`, `host`/`port`/`url`, `pid`.
- **URL resolution is discovery-first, not port-first**: `resolveHubUrl`
  (`sdk/packages/core/src/hub/client/connect.ts`) returns the record's URL when
  present and only falls back to the default endpoint. The well-known port is a
  convenience; the record is the source of truth. `ensureHubWebSocketServer`
  already supports an ephemeral-port fallback (`allowPortFallback` → retry with
  `port: 0` on `EADDRINUSE`).
- **Ensure/attach**: `ensureDetachedHubServerLocked`
  (`sdk/packages/core/src/hub/daemon/index.ts`), under a filesystem startup lock
  (`withHubStartupLock`): read discovery → probe `/health`/`/status` → if
  reusable, verify a WebSocket connect and attach; else retire or defer (below)
  → else spawn a detached daemon (`spawnDetachedHubServer`, re-exec of the same
  binary with `--cline-hub-daemon` / `CLINE_RUN_AS_HUB_DAEMON=1`) and poll for
  its discovery record. Clients: the CLI via `ensureCliHubServer`
  (`apps/cli/src/utils/hub-runtime.ts`) and the `backendMode: "auto"|"hub"` host
  paths (`resolveCompatibleLocalHubUrl` / `ensureCompatibleLocalHubUrl`,
  `sdk/packages/core/src/hub/client/index.ts`); the desktop sidecar via
  `ClineCore.create({ backendMode: "hub", strategy: "require-hub" })`
  (`apps/examples/desktop-app/sidecar/context.ts`). The shipping VS Code
  extension does **not** use the shared Hub (`backendMode: "local"` in
  `apps/vscode/src/sdk/vscode-session-host.ts`).
- **Auth**: WebSocket upgrade requires the token via `Sec-WebSocket-Protocol`
  (`cline-hub-auth.<token>`), **or** a localhost `Origin` header with a loopback
  host (`isLocalHubOrigin` in `hub-websocket-server.ts` — browser dashboards).
  `/health` and `/version` are unauthenticated metadata; `/status` and
  `POST /shutdown` require the bearer token.

### 1.3 Versioning: two layers, one of them unenforced

- **Wire protocol**: `HubProtocolVersion = "v1"` with min/max client gates
  (`isHubProtocolCompatible`, `sdk/packages/shared/src/hub.ts`). Every build ever
  shipped is `v1`, so this gate has never fired. Notably, the server **never
  validates a client's declared `protocolVersion`** — `HubClientRegistration.protocolVersion`
  exists in the type but `hub-server-transport.ts` contains zero references to
  it. A too-new client discovers incompatibility only per command: an old Hub
  answers commands it does not know with `unsupported_command` /
  `not_implemented` error replies (e.g. `task-command-service.ts`,
  `HubScheduleCommandService` fallback in `hub-server-transport.ts`), or worse,
  answers a known command with older semantics.
- **Build identity**: `buildId` (runtime fingerprint), `buildEpochMs` (embedded
  build time), `coreVersion`, totally ordered by `compareHubBuilds`
  (`discovery/index.ts`). `isManagedHubReusable`: a client may keep a managed Hub
  unless the client's build is *strictly newer*; newer or unorderable Hubs are
  attached to, with `watchManagedHubBuildMismatch`
  (`client/managed-hub-build-watcher.ts`) prompting the user. The total order is
  load-bearing: it is what stopped two installs from retiring each other's Hub in
  a loop (#13230).

### 1.4 The "do not kill a busy Hub" change (#13231), precisely

`retireIncompatibleHub` (`daemon/index.ts`):

```
reusable?            → attach (unchanged)
busy (live sessions) → "deferred_busy": DO NOT retire; caller attaches to the OLD hub
idle                 → retire (POST /shutdown + SIGTERM fallback) and spawn new
```

"Busy" is **participants-only** (`hasActiveHubSessions`, `client/index.ts`):
a session counts only while a client holds a live socket subscription to it.
Status was deliberately excluded because crashed clients strand sessions in
non-terminal status forever (see the #13231 commit trail). Accepted cost, stated
in code: a participant-less background run executing at the exact swap moment
dies with the old Hub.

Supporting machinery from the same incident cluster:

- **Retire circuit breaker** (`shouldAttemptRetire`, `daemon/index.ts`): max 3
  retire attempts per URL per minute, bounding any future ordering bug.
- **Startup lock** (`withHubStartupLock`, `discovery/index.ts`): serializes
  ensure/replace across processes; the mismatch watcher stays silent while it is
  held (attach-race guard).
- **CLI auto-update deferral** (#13233): the npm install is deferred to CLI exit
  and gated on the Hub confirming no other `cli*` client / participant-holding
  session (`applyDeferredUpdate`, `apps/cli/src/commands/update.ts` +
  `apps/cli/src/index.ts`), because swapping the package under a running process
  broke respawn fingerprints.
- **Postinstall shield** (`apps/cli/script/postinstall.mjs`): on npm install, the
  discovery record is renamed to `<path>.superseded` so pre-3.0.55 updaters
  cannot restart a busy Hub; `recoverSupersededLocalHubUrl` (`client/index.ts`)
  lets clients keep talking to a shielded, still-busy Hub, and the ensure path
  reads the set-aside record back for retirement metadata. **This is already a
  working two-record, "displaced but alive" mechanism** — the proposal below
  generalizes it rather than inventing a new one.
- **Daemon hardening**: shutdown coordinator with a 2s watchdog
  (`daemon/shutdown-coordinator.ts`), abort-family unhandled rejections no longer
  kill the daemon (#13078), bind retry on `EADDRINUSE` for 5s in `entry.ts`
  (a retired Hub can hold the port ~2s past its shutdown ack).

### 1.5 Why newer clients now break (the gap)

When the old Hub is busy, the newer client attaches to it
(`deferred_busy` branches in `ensureDetachedHubServerLocked`, and
`probeCompatibleHubUrl(..., { requireCurrentBuild: true })` in
`client/index.ts`). Consequences:

1. **Feature breakage**: every Hub-side change the new client depends on is
   absent. New commands fail (`unsupported_command`); changed handler semantics
   silently differ. There is no up-front gate — failures are scattered and
   per-command.
2. **Unbounded pinning**: the desktop sidecar keeps sessions attached for as
   long as the app is open (`session.attach` from
   `apps/examples/desktop-app/sidecar/chat-session.ts`), so "until those
   sessions end" can be *weeks*. Interactive TUIs pin similarly.
3. **Nothing proactively retires the old Hub.** Retirement happens only inside a
   fresh launch's ensure path (the #13231 trail fixed the dialog copy to admit
   this: "the newer build takes over the next time Cline starts after those
   sessions end"). If no new launch happens, the old Hub stays put even after
   going idle.
4. The UX for the newer client is a quiet toast ("Update finishes the next time
   Cline starts") while its actual functionality may be degraded — the message
   asserts safety the code cannot guarantee.

Also relevant: background singletons (schedule runner, agenda automation,
connector supervision) keep executing **old code** the whole time the old Hub is
pinned, and scheduled runs started there are invisible to the "participants"
busy signal.

---

## 2. Recommended design: active/draining generation handoff

**One sentence:** the newest build always owns the discovery record and serves
all new work; a busy older Hub is demoted to a *draining* record, keeps serving
only its already-attached sessions, and retires itself when the last participant
detaches — with a reaper as backstop.

At most two Hubs exist per machine: one **active**, at most one **draining**.

### 2.1 Invariants

1. `production.json` always points at the Hub with the newest build among those
   launched (unchanged rule for old-client behavior: an older client that finds
   a newer active Hub attaches over `v1` and gets the existing
   `build_mismatch` update prompt).
2. A **draining** Hub is recorded in a sibling record
   (`production.draining.json`, same `HubServerDiscoveryRecord` shape —
   a generalization of today's `.superseded` file). It:
   - keeps serving its currently attached sessions and their reconnects;
   - refuses `session.create` and new-client `client.register` (structured
     error `hub_draining`, carrying the active Hub's URL);
   - stops claiming scheduled runs, stops the agenda automation pump and
     `CronService`, and releases connector supervision (the active Hub's
     existing adopt-on-startup path picks connectors up);
   - self-exits via the shutdown coordinator when its last participant detaches
     (short grace period), clearing its draining record on the way out.
3. New-build clients never do new work against an older Hub. The single
   exception is explicit resume of a session that is still **live** (has
   participants) on the draining Hub — attaching there beats killing the turn;
   sessions with no participants are restored from persisted messages on the
   active Hub instead.

### 2.2 Upgrade flow (replaces the `deferred_busy` → attach fallback)

In `ensureDetachedHubServerLocked`, under the existing startup lock, when the
probed Hub is not reusable (this build strictly newer) **and** busy:

1. Move `production.json` → `production.draining.json` (atomic rename under the
   existing discovery mutation lock). From this instant, no new launch resolves
   to the old Hub.
2. `POST /drain` (token-authenticated, like `/shutdown`) to the old Hub. Hubs
   that predate drain support return 404 — tolerated (see rollout §6).
3. Spawn the new daemon. The old Hub still holds port 25463, so the new daemon
   binds an ephemeral port (the `allowPortFallback` / `port: 0` machinery that
   already exists) and publishes its real URL in `production.json`. Because
   `resolveHubUrl` is discovery-first, no client ever needs the well-known port
   to find the active Hub; the port is reclaimed by whichever Hub launch next
   finds it free.
4. The caller attaches to the **new** Hub. Requirement 2 is met immediately; the
   old Hub's sessions never observe anything.

If the old Hub is **idle**, retirement stays exactly as today (retire + spawn on
the fixed port).

### 2.3 Retirement backstop (reaper)

The active daemon runs a periodic drain-reaper (alongside the existing
telemetry/heartbeat timers in `entry.ts`):

- read `production.draining.json`; if the probe fails → clear the stale record;
- if `localHubHasNoActiveSessions` (the same participants-only signal used
  today) → `requestHubShutdown` + SIGTERM fallback + clear the record.

This fixes gap §1.5(3) for *all* generations: even a pre-drain-era Hub that
never learned to self-exit is retired within one reaper interval of going idle,
without waiting for the user to launch Cline again. The retire circuit breaker
applies unchanged.

### 2.4 Hard version gating (complement, not the fix)

Skew failures should be crisp and machine-readable rather than scattered
`unsupported_command` errors:

- The server validates `HubClientRegistration.protocolVersion` (today ignored)
  against its min/max and rejects with a structured error.
- Clients may declare `requiredHubCapabilities` at registration; the Hub rejects
  registration listing the missing ones (`hub_upgrade_required`). The `capabilities`
  array already exists in discovery/`/health` (`HUB_CAPABILITIES`,
  `sdk/packages/shared/src/hub.ts`) but nothing consumes it; this makes it real.
- Client ensure paths map `hub_upgrade_required` / `hub_draining` to "resolve
  the active Hub (spawning it if needed)" — the same handling as
  `protocol_mismatch` today.

Keep `HubProtocolVersion` coarse (bump only on breaking envelope changes);
capabilities carry the fine grain. This turns "newer client needs newer Hub"
from an emergent runtime failure into a routing decision.

### 2.5 Behavior matrix (explicit answers to the constraints)

| Scenario | Behavior |
|---|---|
| Running chat turn on old Hub during upgrade | Untouched. Socket, stream, approvals all stay on the draining Hub. |
| Scheduled/agenda run executing on old Hub | Runs to completion there (old code). New claims come only from the active Hub; cron leases in `cron.db` already guarantee single execution per run across processes. |
| New client, new session | Always on the active (new) Hub. Works immediately, new APIs included. |
| New client resuming a session live on the draining Hub | Attaches to the draining Hub for that session only (deliberate, narrow skew; the alternative is killing the turn). Everything else it does goes to the active Hub. |
| New client resuming a participant-less session | Restored from persisted messages on the active Hub (the live-runtime copy no longer exists or is unattended; matches existing `recoverMissingActiveSession` semantics). |
| Reconnect after editor/TUI reload | Discovery resolves to the active Hub; sessions live on the draining Hub are reachable via the draining record (generalized `recoverSupersededLocalHubUrl`). |
| Second window on an **older** Cline version | Reads `production.json`, finds a newer active Hub, attaches over `v1` (existing `isManagedHubReusable` rule) and gets the existing update-and-restart prompt (`build_mismatch`). If a future protocol bump makes it wire-incompatible, it gets the existing `unsupported_protocol` dialog. |
| Old client still attached to the draining Hub (e.g. desktop not yet restarted) | Stays wholly on the draining Hub until its sessions end; on next launch it lands on the active Hub with the update prompt. |
| Open chats / "what does the user see" | The `outdated_hub` toast ("finishes next time Cline starts") becomes obsolete for new clients; the draining Hub's own clients keep the current experience. |

### 2.6 Security / auth / socket ownership with two Hubs

- Each Hub keeps its own random 32-byte `authToken`; both bind loopback only.
  Two listeners do not widen the attack surface: `/status`, `/shutdown`, and the
  new `/drain` are token-only; `/health` remains metadata-only.
- **Pre-existing caveat to preserve, not worsen:** the WebSocket upgrade accepts
  token-less connections when the `Origin` header is loopback
  (`isLocalHubOrigin`, `hub-websocket-server.ts`) — for the browser dashboard.
  The draining Hub must apply the same drain gating to origin-authenticated
  clients. Lifecycle endpoints must never be origin-authenticated (they are not
  today; keep it that way for `/drain`).
- Port squatting on 25463 by a hostile local process is unchanged: clients trust
  the discovery record + token, and `verifyHubConnection` fails against a
  squatter. Discovery-first resolution actually reduces reliance on the fixed
  port.
- Discovery files are `0o600` where the platform honors it; the draining record
  inherits the same atomic-rename write path (`writeHubDiscovery`).

### 2.7 Platform notes

- The transport is loopback TCP WebSocket on **all** platforms — no named pipes
  or Unix sockets — so side-by-side Hubs behave identically on Windows, macOS,
  and Linux.
- Windows is the platform that most needs this design's shape: `cline doctor`'s
  process scans are no-ops on win32 (no `pgrep`/`lsof`), pid liveness checks are
  weaker, and directory fsync after discovery writes is best-effort. The design
  therefore leans on **authenticated HTTP lifecycle endpoints and self-exit**
  (`/drain`, `/shutdown`, participant-empty self-retirement) rather than
  pid-based signaling; SIGTERM remains a fallback only.
- `windowsHide: true` on daemon spawn is unchanged.

---

## 3. Alternatives considered and rejected

1. **Status quo (defer + attach to old Hub).** Violates requirement 2; the
   desktop app pins the old Hub indefinitely; skew failures are silent and
   scattered. This document exists because of it.
2. **Retire-and-restore (kill the old Hub, rehydrate sessions on the new one).**
   In-flight turns are not serializable: live provider streams, in-memory
   `ActiveSession` state, pending approvals. #13078 made *aborted* turns flush
   transcripts so disk recovery exists, but recovery loses the in-flight turn by
   definition — exactly what requirement 1 forbids.
3. **In-place graceful restart at a turn boundary (single Hub).** A long agentic
   turn (or an always-attached desktop) blocks the new client unboundedly;
   "wait for idle" is the pinning problem restated.
4. **Compatibility shim in the old Hub.** The old Hub's code is already on
   users' machines and cannot be retrofitted (the same reason the postinstall
   shield exists for pre-3.0.55 updaters). Forward-looking shims create an N×M
   maintenance matrix for a wire protocol that is not even the real gap —
   handler *behavior* is.
5. **Protocol version negotiation alone.** Negotiation lets a new client degrade
   gracefully against an old Hub; it cannot make an old Hub serve new features.
   Useful as a complement (§2.4), not a fix.
6. **Per-client / per-build Hubs in production (the dev model everywhere).**
   Dev already scopes owners by build id, so this "works" — but it forfeits the
   production singleton's purpose: connectors and the schedule/agenda runners
   must not run N times, and cross-surface session sharing (CLI ↔ desktop ↔
   dashboard) needs one rendezvous point. The proposal keeps the singleton for
   *new work* and allows exactly one legacy straggler, which is the minimum
   multiplicity that satisfies both requirements.
7. **Move session execution out of the daemon into spoke subprocesses** (make
   the coordinator stateless and cheaply restartable, as
   `docs/sdk/architecture/hub-spoke.mdx` already describes aspirationally).
   This is the best long-term topology and would shrink "draining" to a spoke
   handoff — but it is a rearchitecture of the runtime host, streaming,
   approvals, and tool-executor capability routing, and even then a
   coordinator-restart window needs the same record-handoff mechanics. Worth
   pursuing separately; not a prerequisite for fixing the upgrade path, and the
   generation-handoff records/gating proposed here remain useful under it.

---

## 4. Concrete code touchpoints (implementation follow-up)

| Area | Change |
|---|---|
| `sdk/packages/core/src/hub/discovery/index.ts` | Draining-record helpers (read/write/clear `<discoveryPath>.draining`), unifying with the `.superseded` reader (`readSupersededHubDiscovery` in `daemon/index.ts`). |
| `sdk/packages/core/src/hub/daemon/index.ts` | `ensureDetachedHubServerLocked`: replace both `deferred_busy` → attach branches with demote-record → `POST /drain` → spawn-with-port-fallback → attach-to-new. Keep the retire circuit breaker and idle-retire path. |
| `sdk/packages/core/src/hub/server/hub-websocket-server.ts` | `/drain` endpoint (token-only); expose `draining: true` in `/health`/`/status`. |
| `sdk/packages/core/src/hub/server/hub-server-transport.ts` | Drain state: reject `session.create` / new `client.register` with `hub_draining` (+ active URL); stop schedule runner, agenda automation pump, `CronService`, connector supervision on drain; emit last-participant-detached to trigger self-shutdown. Validate `protocolVersion` and `requiredHubCapabilities` at register (`hub_upgrade_required`). |
| `sdk/packages/core/src/hub/daemon/entry.ts` | Wire `/drain` → transport drain + coordinator-managed self-exit on participant-empty; add the drain-reaper interval. |
| `sdk/packages/shared/src/hub.ts` | `hub_draining` / `hub_upgrade_required` error codes; `requiredHubCapabilities` on `HubClientRegistration`; capability constants for post-v1 additions. |
| `sdk/packages/core/src/hub/client/index.ts` | Generalize `recoverSupersededLocalHubUrl` to the draining record; route `hub_draining` / `hub_upgrade_required` to active-Hub resolution; resume-routing rule (live-on-draining vs restore-on-active). |
| `sdk/packages/core/src/hub/client/managed-hub-build-watcher.ts` | Retire the `outdated_hub` reason for new clients (they no longer attach to old Hubs); keep `build_mismatch` / `unsupported_protocol` prompts. |
| `apps/cli/src/commands/doctor.ts` | Report active + draining Hubs distinctly; `doctor fix` clears both records and respects a live draining Hub with participants. |
| `apps/cli/src/tui/root.tsx`, `apps/examples/desktop-app` dialog/sidecar | Copy updates; sidecar forwards `hub_draining` awareness if we surface it. |
| `sdk/ARCHITECTURE.md`, `docs/sdk/architecture/hub-spoke.mdx` | Document the two-record lifecycle; fix the stale spoke description. |

**Shared-SQLite audit (required before enabling two concurrent Hubs):**
`sessions.db`, `tasks.db`, `cron.db` are opened by whichever Hubs run. Cron run
claims are leased (safe). The drain contract stops the old Hub's writers for
schedules/agenda, but a **pre-drain** old Hub cannot be told to stop — during
its overlap window it may still claim a scheduled run and execute it with old
code (single execution is still guaranteed by leases). Verify bun:sqlite
busy-timeout/WAL behavior under two writer processes and document it.

## 5. Not implemented in this PR

Design only. No candidate "tiny obviously-correct first step" was landed: every
piece (drain endpoint, record demotion, reaper) changes daemon lifecycle
behavior that #13230/#13231/#13233 show to be regression-prone, and none is
independently provable without the others.

## 6. Migration / rollout

Let **N** be the first release with this design.

- **N client meets a busy pre-N Hub** (first upgrade): demote record; `/drain`
  404s — tolerated; the pre-N Hub keeps its scheduler/connectors until retired
  (bounded skew, single-execution still lease-guaranteed); spawn N Hub on a
  fallback port; reaper retires the pre-N Hub once its participants drop.
  In-flight sessions: untouched.
- **Pre-N clients still running** during that window: hold live sockets to the
  old Hub (unaffected); in-memory recoverable-URL state covers reconnects. On
  relaunch they resolve `production.json` → newer active Hub → attach + existing
  update prompt. Pre-N clients cannot see the draining record and so cannot
  accidentally re-adopt the old Hub as primary — the file name is the shield,
  exactly as `.superseded` works today.
- **Pre-3.0.55 postinstall shield** keeps working: it renames whatever
  `production.json` it finds, which after N points at the active Hub; the
  N-era ensure path already recovers from a set-aside record.
- **Rollback**: reverting to pre-N clients degrades to today's behavior (attach
  to whatever `production.json` names). A leftover draining record is inert to
  pre-N code and cleaned by `doctor fix`.
- **Failure containment**: if drain self-exit is buggy, the reaper retires on
  participant-empty; if both fail, `cline doctor fix` remains the manual
  backstop; the retire circuit breaker bounds any retire loop, as today.

## 7. How we know it worked

**Repro of the current breakage** (also the acceptance test, inverted): with
`CLINE_HUB_BUILD_ID`/`CLINE_HUB_BUILD_EPOCH_MS` overrides (already used by the
hub test suites), start Hub "A", attach a client to a session (participant
held); run the ensure path as strictly-newer build "B".
Today: B attaches to A (`/health` reports A's `buildId`) and a B-only command
fails with `unsupported_command`. After: `production.json` names a live B Hub,
A still serves the original session undisturbed, and the B-only command
succeeds.

**New automated coverage** (alongside `daemon/index.test.ts`,
`shutdown.e2e.test.ts`, `discovery/index.test.ts` patterns):

- ensure-with-busy-older-hub → demote + spawn + attach-to-new; old session's
  socket stays open across the whole flow.
- draining Hub rejects `session.create`/new `client.register` with
  `hub_draining`; existing participants can still run turns and reconnect.
- drain self-exit on last participant detach; draining record cleared;
  well-known port reclaimed by the next Hub launch.
- reaper retires (a) an idle draining Hub, (b) a pre-drain Hub that ignores
  `/drain`, (c) clears a stale record whose process is gone.
- exactly-once scheduled-run execution during a two-Hub overlap window.
- register-time gating: `requiredHubCapabilities` missing → `hub_upgrade_required`
  → client resolves the active Hub.
- mixed-version routing matrix from §2.5 as parameterized cases.
- Windows CI: the flow must pass with pid-based operations disabled (HTTP
  endpoints only), mirroring doctor's win32 gaps.

**Manual QA script**: desktop app open with an active chat → update the CLI →
new CLI works immediately (new commands succeed against the new Hub) while the
desktop chat streams uninterrupted; desktop shows its update prompt; after the
desktop restarts, exactly one Hub remains, on the well-known port, within one
reaper interval.
