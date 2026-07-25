# 03 · Phased plan

Answers question 8. Phases are sequenced so each one is independently verifiable and independently revertible. No time estimates — a phase is done when its predicate is true.

Phase numbering aligns with [`../cline-drivemode/TASK-GRAPH.md`](../cline-drivemode/TASK-GRAPH.md); this document adds the harness and port work to those phases rather than running a parallel track.

Riskiest unknown first, within the constraint that contracts must precede the things that depend on them. The riskiest unknown here is not "can we write a reducer" — it is **"is the port narrow enough that a non-Cline host could implement it?"** That question is answered in Phase 2 by `fakeHost`, before any hub code exists to bias the answer.

---

## Phase 0 · Discovery (this wave)

**Done when** the six documents under `docs/plans/drivecode-sdk/` exist, the merge-vs-separate question is resolved with the rejected alternatives written down, and `../cline-drivemode/README.md` points at this directory.

**Verification** — read-only. No code, no commit, no PR.

**Status** — complete on landing this directory.

---

## Phase 1 · Contracts

Schemas before anything that consumes them. This is `DRV-EVENTS` and the schema half of `DRV-PLATFORM-CONFIG`, unchanged in scope; listed here because the harness cannot compile without it.

**Lands**
- `sdk/packages/shared/src/drive/` — `DriveEvent` versioned union with `v`, `track`, envelope, and a boundary parse
- `Room`, `Participant`, `RoomSnapshot`, `SeatSource`, `AddressSet`
- `AgentProfile`, `RosterPack`
- Facet definitions — id, lane, privacy class, default, zod schema
- `resolveDriveRegistryPath`, `resolveDriveConfigSearchPaths` in `shared/src/storage/paths.ts`

**Acceptance criteria**
1. `parseDriveEvent` rejects an event with an unknown `v` and rejects an unknown `type` within a known `v`.
2. Round-trip: every event variant serialises and parses back to a structurally equal value.
3. A type-level test asserts `AgentProfile` has no field assignable from a system prompt, tool list, model id, or provider id.
4. No `Team`, `TeamTeammateSpec`, or mailbox symbol is exported from `shared/src/drive/`.
5. No field in any schema can hold raw audio or a verbatim transcript body.

**Verification** — `bun -F @cline/shared test`, `bun run types`. Static only; there is nothing to run yet.

**Gate** — criteria 3, 4, and 5 are the privacy and boundary invariants. If any fails, Phase 2 does not start.

---

## Phase 2 · Harness and port skeleton

The `drivecode-sdk` layer proper. Pure, hostless, and provably so.

**Lands in `sdk/packages/drive/`**
- Pure policies: `transitionDriveMode`, `narrate`, `classifyInterrupt`, `expandRosterPack`, `applySeatSourceDelta`, `capPreset`, `resolveAddress`, `mergeFacetScopes`
- Pure fold and projections: `reduceRoom`, `projectStage`, `projectRoster`
- `DriveHostPort`, `HostCapabilities`, `RoomOp`, `PromptRewriteDecision` — interfaces only
- `createDriveHarness({ host })`
- `sdk/packages/drive/src/conformance/` — `runHostConformance`, `fakeHost`

**Acceptance criteria**
1. `sdk/packages/drive/src/**` contains no `import` of `node:*`, no `fetch`, no `WebSocket`, and no fs call. Grep-checkable, and asserted in CI.
2. Every import from `@cline/shared` in `sdk/packages/drive/src/**` is `import type`. No runtime value crosses that edge.
3. The package imports nothing from `@cline/llms`, `@cline/agents`, `@cline/core`, or any app.
4. Every policy has a table-driven test that runs with no host at all.
5. `runHostConformance(fakeHost(caps), caps)` reports zero mismatches.
6. `runHostConformance` **fails closed**: given a host that declares `promptRewrite: true` and no-ops, the report contains a mismatch naming `promptRewrite`. A conformance kit that only passes is not a kit.
7. `reduceRoom` is a pure fold — replaying the same event sequence from the same initial snapshot yields an identical result, and applying the same event twice by id is idempotent.
8. The package builds for a browser target with no polyfills. This is the mechanical proof that the webview can import the reducer instead of writing its own.
9. `HostCapabilities.writerEndpoint` is required, not optional.

**Verification** — `bun -F @cline/drive test`, `bun run types`, plus the browser-target build from criterion 8. No runtime surface to drive yet, so no control-ui or control-cli pass; this is called out in [§Verification gaps](#verification-gaps).

**Gate** — criteria 1, 2, and 6 together. Purity and a kit that can fail are what make Phase 3 safe to write against.

---

## Phase 3 · Cline binding

The first and, for MVP, only real host. This is where the single-writer constraint is enforced in code.

**Lands in `sdk/packages/core/src/hub/`**
- `drive-host/` — `createClineDriveHost`, `clineCapabilities`
- `collaboration/` — `commitRoomOp`, seating commits, `broadcast`
- `drive-config/` — atomic durable facet IO
- Bridge from `@cline/agents` session events into the `work` track

**Acceptance criteria**
1. `runHostConformance(createClineDriveHost(…), clineCapabilities)` reports zero mismatches against a live hub.
2. `clineCapabilities.writerEndpoint === "ws://127.0.0.1:25463"`. CI greps the whole `sdk/` tree for a `7891` default and fails on a hit.
3. Exactly one process writes room state. Two concurrent clients issuing conflicting `RoomOp`s produce one committed order, and both observe the same resulting snapshot.
4. The hub calls kernel policies and does not reimplement any of them — no second mode machine, no second narration rule, no second pack expansion.
5. Durable facet writes are atomic; a kill during write leaves the previous file intact.
6. A dropped and reconnected subscriber converges to the same snapshot as one that stayed connected.
7. No new daemon and no new port. `bun run cli doctor` reports the same process count as before the phase.

**Verification** — `bun -F @cline/core test:unit`; a hub integration test for criteria 3 and 6; **control-cli** against `bun run cli` for criterion 7 and for a first end-to-end room attach.

**Gate** — criteria 2, 3, and 7. Single writer, one daemon, correct port.

---

## Phase 4 · Drive tab on the harness

Product surface. Everything here reads projections and writes nothing but chrome.

**Lands**
- `apps/cline-hub/src/webview/src/drive/` — stage, roster, address control, call chrome
- `apps/cli/src/tui/` — parity renderers

**Acceptance criteria**
1. The webview imports `reduceRoom` and `projectStage` from `@cline/drive`. Grep asserts no local reducer exists under `apps/**`.
2. The webview opens exactly one socket, to the hub. No second connection, no direct fs access.
3. Nothing under `apps/**` writes `participants[]` or a durable facet file directly.
4. A raise-hand, an address change, a roster-pack add, and a sub-mode switch each round-trip from UI to hub to broadcast and back into both surfaces.
5. CLI and webview render the same room from the same event stream — no surface-specific truth.
6. With voice off and a single participant, the surface emits no Drive chrome. Same invariant the sibling products already hold.

**Verification** — `bun -F @cline/cli test:unit`; **control-ui** against the hub webview for criteria 4 and 6, with screenshots; **control-cli** for criterion 5.

**Gate** — criteria 1 and 3. If a reducer or a writer appears in an app, the layering has already failed and later phases will compound it.

---

## Phase 5 · Second-host readiness (deferred)

Not MVP. Listed so the exit criteria are known before anyone starts, and so Phase 2's port design has a target to be judged against.

**Would land** — a second `DriveHostPort` implementation for Cursor or Claude Code, in its own package outside `@cline/core`.

**Acceptance criteria**
1. The second binding is written without editing `sdk/packages/drive/src/**`. If the port needs changing to accommodate host two, the port was wrong, and that is the finding.
2. The binding declares its own `writerEndpoint` naming a real single writer. A binding with no nominated writer is rejected.
3. `runHostConformance` passes for the capabilities it declares, and honestly declares `false` for what it cannot do — a Cursor binding that cannot produce structured work events declares `eventsFirstStage: false` rather than faking them.
4. The Drive schemas are extracted from `@cline/shared` into `@cline/drive`, or the second host is shown not to need them. The type-only import gate from Phase 2 makes this a file move.

**Verification** — conformance report for the second host; no diff under `sdk/packages/drive/src/`.

---

## Verification gaps

Phases 1 and 2 have static verification only — types, unit tests, grep gates, and a browser-target build. There is no runtime surface to drive until Phase 3, so no control-cli or control-ui pass applies. That is expected for contract and pure-policy work, but it means **the first real runtime evidence for the whole design arrives in Phase 3**, and Phase 3's gate should be treated as the true go/no-go for the architecture rather than a routine checkpoint.

Phase 5 has no verification harness at all until a second host exists. Its criterion 1 — that the port needs no edits — is the only honest test of portability, and it cannot be run early. Phase 2's `fakeHost` is a proxy for it, not a substitute.

---

## Gate summary

| Phase | Blocking gate |
|---|---|
| 1 | No prompt-shaped field on `AgentProfile`; no `Team`; no raw audio or transcript field |
| 2 | Kernel is pure and browser-buildable; `@cline/shared` imports are type-only; conformance kit can fail |
| 3 | Single writer; one daemon; `:25463` and never `:7891` |
| 4 | No reducer and no writer under `apps/**` |
| 5 | Second binding lands with zero edits to the kernel |
