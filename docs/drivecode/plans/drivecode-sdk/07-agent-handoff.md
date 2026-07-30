# Agent handoff — Drive harness leverage (post #55–#57)

**Audience:** a cold agent continuing this work.  
**Date:** 2026-07-30  
**Active draft PR:** [#58](https://github.com/hhalperin/cline-drivecode/pull/58) — branch `cursor/drive-harness-remaining-1929`  
**Base:** `main` (includes merged #55, #56, #57)

Repo-level brief: [../../HANDOFF.md](../../HANDOFF.md). Leverage checklist: [06-sdk-leverage.md](06-sdk-leverage.md).

---

## 1. Mission (what you are finishing)

Finish **product leverage of `@cline/drive`** so hub/webview/CLI stop reimplementing room and Show policy beside the harness.

Do **not** reopen Show backlog product design (slices 1–7 + S are done on main). Do **not** dump `@cline/drive` into `@cline/sdk` root.

**Next ordered slices on PR #58:**

1. ~~Hub `call_join` / raise-hand via harness~~ — **done**
2. ~~Thin `drive.show.*`~~ — **done**
3. ~~Phase-2 pure helpers~~ — **done**
4. ~~Follow-ons F1–F3~~ — **done** (see [08-followon-tasks.md](08-followon-tasks.md)): durable registry, remove-pack, script/planner DirectorOps

Remaining product UI (pack library / `/pack`) is out of this harness track.


---

## 2. What just landed on `main` (PRs #55–#57)

Merged in order: **#55 → #57 → #56**.

| PR | Branch | What it delivered |
|---|---|---|
| [#55](https://github.com/hhalperin/cline-drivecode/pull/55) | `cursor/show-backlog-director-plans-1929` | Show backlog director plans + implementation (enqueue/tick/present, scripts, Do↔Show, planner, producers, router wire, spotlight converge, route suggest chip) |
| [#57](https://github.com/hhalperin/cline-drivecode/pull/57) | `cursor/fix-hub-ci-typeerrors-14bb` | Hub webview typecheck + hub unit test restores; overlapped harness commit lineage |
| [#56](https://github.com/hhalperin/cline-drivecode/pull/56) | `cursor/drive-harness-sdk-leverage-1929` | `createDriveHarness`, host `getRoom` + `roomId` on `RoomOp`, hub address/stage/mode via harness, DirectorOp + `shows`, webview single `reduceRoom` fold, CI fixes |

**Do not** recreate those branches for this work. Continue on **`cursor/drive-harness-remaining-1929`** / PR **#58**.

---

## 3. Two SDKs (do not conflate)

| Package | Role |
|---|---|
| `@cline/sdk` | Alias for `@cline/core` — agent loop, sessions, tools, hub client |
| `@cline/drive` | Drive harness (**drivecode-sdk** role) — rooms, stage, director policies, host port |

Composition root: **`createDriveHarness({ host })` + `createClineDriveHost`**.  
Rule of three: **harness proposes → host commits → apps project** (`reduceRoom` / `projectStage` / `projectRoster`).

---

## 4. Branch / PR state right now

```text
main
  └─ cursor/drive-harness-remaining-1929   (#58 draft)
       └─ 1b7236bb0 feat(drive): route call_join and raise_hand through harness
```

**Already on this branch:**

- `call_join` façade → `getHubDriveHarness().rooms.createOrAttach` (final `publishRoomSnapshot`; raw `participant` escape hatch unchanged)
- `call_raise_hand` → `harness.rooms.raiseHand` + `takeHubRoomCommit` (pause-after-tool sync preserved)
- Docs status updated in `06-sdk-leverage.md`

**Still using `joinCall`:** unit/façade export in `sdk/packages/core/src/hub/collaboration/join-call.ts` — keep for tests; product hub path is harness.

---

## 5. Next slice — thin `drive.show.*` (do this next)

### Problem

- `DriveHarness.shows.{enqueue,present,tick}` and host `commitDirectorOp` exist.
- Hub wire handlers in `drive-handlers.ts` still **duplicate store mutation + publish**.
- `driveDirectorOps.ts` imports `materializeShowItem` / `runShowDirectorTick` from `drive-handlers.ts` and documents: **handlers must not import directorOps**.

If you wire handlers → `getHubDriveHarness().shows.*` without extracting runtime, you get:

```text
drive-handlers → driveHarnessBinding → clineDriveHost → driveDirectorOps → drive-handlers
```

### Safe order

1. **Extract show runtime** into a neutral module, e.g.  
   `sdk/packages/core/src/hub/driveShowRuntime.ts`  
   Move (or re-export from one place):
   - `materializeShowItem`
   - `runShowDirectorTick`
   - related helpers used by both (`applyPresentedShow`, address helpers if only needed for tick, etc.)
2. Point **both** `driveDirectorOps` and `drive-handlers` at that module. No handlers ↔ directorOps edge.
3. Thin handlers:
   ```ts
   const { harness } = getHubDriveHarness({ store });
   const result = await harness.shows.enqueue(roomId, showItem, { presentNow });
   // publish drive.room.changed / drive.show.planned|presented from result
   ```
4. Keep **publish** and transport replies in handlers. Keep **producers** (`produceMermaid`, plan card, walkthrough, browser snapshot) in `@cline/core` — not in `@cline/drive`.

### Key files

| Path | Role |
|---|---|
| `sdk/packages/core/src/hub/server/handlers/drive-handlers.ts` | `handleShowEnqueue/Present/Tick` (~631+) — thin these |
| `sdk/packages/core/src/hub/driveDirectorOps.ts` | Host commit path — keep; stop importing handlers |
| `sdk/packages/core/src/hub/clineDriveHost.ts` | `commitDirectorOp` |
| `sdk/packages/core/src/hub/driveHarnessBinding.ts` | `getHubDriveHarness` / `takeHubRoomCommit` |
| `sdk/packages/drive/src/harness.ts` | `shows.*` API |
| `sdk/packages/core/src/hub/server/handlers/drive-handlers.test.ts` | Behavior must stay green |

### Acceptance for slice 2

- [x] No circular import between handlers and directorOps
- [x] `drive.show.enqueue|present|tick` mutate via harness/host commit only
- [x] Published events and reply payloads unchanged for existing tests
- [x] `bun -F @cline/core test:unit -- drive-handlers.test.ts` (and any fork/show tests you touch) pass
- [x] Update `06-sdk-leverage.md` DirectorPort row toward Done / note remaining gaps (script attach, planner)

### Out of scope for slice 2

- Planner (`runShowPlannerFromWork`) full harness migration
- Script attach as a new DirectorOp (unless trivial after extract)
- Webview changes
- Phase-2 roster packs

---

## 6. Following slice — Phase-2 pure helpers

**These names do not exist yet** (no alternate implementations under other names). Closest cousins:

| Target | Cousin today | Gap |
|---|---|---|
| `expandRosterPack` | `addRosterPack` + injected `resolveRosterPack` (skip-if-seated) | No expand/refcount/`SeatSource` |
| `applySeatSourceDelta` | `seatSources: string[]` on agents | Not structured seat sources |
| `capPreset` | `DriveagentPermissionPresetIntent` in shared home schemas | No pure cap function |
| `resolveAddress` | `addressedParticipantIdsFromAddressSet` in handlers (agents-only) | Pack mode missing; belongs in `@cline/drive` |
| `mergeFacetScopes` | Already in `@cline/shared` facets | Re-export from drive optional; do not duplicate |

Architecture expects helpers under `@cline/drive` (see `02-architecture.md`, DRV-ROSTER-PACK / DRV-ADDRESS). Wire `addRosterPack` to durable packs **after** pure expand + seat-source deltas.

Do not invent a second pack registry in the hub.

---

## 7. Already done (do not redo)

### Show backlog / director (product)

Plans: `docs/drivecode/plans/cline-drivemode/show-backlog-director/`.  
Slices **1–7 + S** implemented on main (present, enqueue/tick, scripts, Do↔Show, planner, producers, router, spotlight converge, human pin / return spotlight, route suggest chip).

### Harness MVP

- `sdk/packages/drive/src/harness.ts` — rooms + director helpers + shows
- `sdk/packages/drive/src/conformance/memoryHost.ts`
- Hub: address / stage / mode / **join** / **raise-hand** via `getHubDriveHarness`

### Webview single fold

- Live: `apps/cline-hub/src/webview/src/drive/foldRoomSnapshot.ts` + `useDriveSession` (`room_snapshot` replace; `drive_event` → `reduceRoom`, hub reconciles if ahead)
- Demo: `stageReducer.ts` maps tools → `work.*` → `reduceRoom` / `projectStage`
- Optional `summary` on `work.command`; card summaries prefer event summary

---

## 8. Constraints (binding)

- Bun only (`bun run …`). Node ≥22. After `@cline/shared` / `@cline/drive` / `@cline/core` source edits: **`bun run build:sdk`** before CLI/hub/tests that import `dist/`.
- Hub at discovery / `ensureDetachedHubServer` is the single writer. No second daemon; do not hardcode ports in docs/scripts.
- Privacy-strict: no audio/transcript persistence without explicit debug setting.
- `RosterPack` ≠ Cline `Team`. `AgentProfile` is appearance only — no Drive-owned prompts/tools/models.
- Drive docs nest only under `docs/drivecode/` (see `docs/drivecode/AGENTS.md`).
- Cloud agent branches: `cursor/<descriptive-name>-1929`. Prefer ManagePullRequest for PR create/update; `gh` is fine for read + merge when asked.
- Known cloud-env flake: `@cline/core` `readGitWorkspaceState` origin URL test — environment `insteadOf` rewrite, not a product bug.

---

## 9. Verify commands

```bash
# After SDK edits
bun run build:sdk

# Slice 2
bun -F @cline/core test:unit -- drive-handlers.test.ts
bun -F @cline/core test:unit -- drive-room-handlers.test.ts
bun -F @cline/drive test -- harness.test.ts

# Optional broader
bun -F @cline/core test:unit -- clineDriveHost.test.ts
bun run --cwd apps/cline-hub test -- src/webview/src/drive/foldRoomSnapshot.test.ts
```

CLI from source: `bun run cli` (auto-spawns hub). Live agent turns need a funded LLM key.

---

## 10. Suggested first actions for the new agent

1. `git fetch origin && git checkout cursor/drive-harness-remaining-1929 && git pull`
2. Read [06-sdk-leverage.md](06-sdk-leverage.md) + this file
3. Skim `driveDirectorOps.ts` and `handleShowEnqueue` / `handleShowTick` in `drive-handlers.ts`
4. Extract `driveShowRuntime.ts`, fix the cycle, thin show handlers
5. Commit / push / update draft PR #58 (body may be human-locked — push commits anyway)
6. Only then start Phase-2 helpers

---

## 11. PR hygiene

- Draft PR: https://github.com/hhalperin/cline-drivecode/pull/58  
- Prefer **draft until slice 2 is green**; mark ready when show thinning is done even if Phase-2 is still open (or keep draft and note remaining in Additional Notes).
- If PR body update is rejected as non-agent-managed, leave the body and keep commits descriptive.
- CI labels: path filters usually enough; `ci/sdk` + `ci/docs` already intended for this track.

---

## 12. Quick map of critical paths

```text
Webview join
  → call_join
  → drive-room-handlers (createOrAttach via getHubDriveHarness)
  → createClineDriveHost.commitRoomOp
  → DriveRoomStore + reduceRoom
  → room_snapshot / drive_event
  → foldIncomingDriveEvent / applyRoomSnapshot

Show enqueue (target — landed)
  → drive.show.enqueue
  → harness.shows.enqueue → commitDirectorOp → driveDirectorOps
  → handlers publish only
  (runtime: driveShowRuntime.ts; no handlers ↔ directorOps cycle)
```

---

## 13. What “done” looks like for this PR track

| Outcome | Done when |
|---|---|
| Hub rooms | All seating/control wire commands that have harness APIs go through harness (join/raise/address/stage/mode — done) |
| Show wire | `drive.show.*` commits via harness/host; handlers publish; no import cycle |
| Packs/address | Pure helpers exported from `@cline/drive`; `addRosterPack` uses expand + seat sources |
| Packaging | `@cline/sdk` still agent-only; drive stays `@cline/drive` |

When those land, refresh [../../HANDOFF.md](../../HANDOFF.md) “State so far” / top gaps and mark this handoff superseded or archive it under `reviews/`.
