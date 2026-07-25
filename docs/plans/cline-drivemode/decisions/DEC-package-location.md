# DEC · Package location for drivecode / `@cline/drive`

**Status.** Recommended  
**Date.** 2026-07-25  
**Deciders.** Drivecode leadership planning wave  
**Closes.** Open Decision in `docs/plans/HANDOFF-drivecode.md`  
**Aligns with.** `docs/plans/drivecode-sdk/` (merge decision, `decisions.tsv`)

## Context

`HANDOFF-drivecode.md` left open whether phase 1 lives as `sdk/packages/drive` (`@cline/drive`) inside this monorepo or as a separate `drivecode-sdk` repo. The SDK plan already rejected a separate repo after an arena: cursor-drive and claude-drive both suffer hand-maintained `syncTypes.ts` drift.

## Decision

**Phase 1: `@cline/drive` lives in this monorepo at `sdk/packages/drive`.**

1. `drivecode-sdk` is the **role** (portable meta-harness), not a second package name inside the monorepo.
2. The package grows: pure kernel policies, `DriveHostPort` interface, capability descriptor, conformance kit, `reduceRoom` / `projectStage`.
3. Hub commit/broadcast stays in `@cline/core`.
4. Extract to a separate published repo only when a **second host** needs the package and the conformance kit is green against a non-Cline fakeHost.

## Consequences

**Positive**

- Direct access to Cline types, hub ops, and CI.
- No syncTypes copy step.
- Matches D1 and SDK architecture docs.

**Negative**

- Package graph discipline must keep `@cline/drive` free of app imports.
- Publishing/versioning work deferred until a second host appears (acceptable).

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Separate repo now | Forces sync before any second host exists |
| Pass-through package above `@cline/drive` | Arena dissent’s MVP still re-exported kernel; extra hop without benefit |
| Put Drive logic only in `@cline/core` | Webview cannot import pure reducers without pulling core; grows a second reducer |

## Verification

- Phase 0 gate includes `@cline/drive` in `build:sdk` / types.
- Dependency direction: `shared → … → drive` consumed by `core` and apps; drive never imports apps.
- Conformance kit has a fail-closed fakeHost test before hub binding hardens the port shape.
