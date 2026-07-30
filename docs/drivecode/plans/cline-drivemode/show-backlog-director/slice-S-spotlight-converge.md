# Slice S · Stage chrome (parallel track)

Back to [overview.md](overview.md). Parallel to Show loop slices 1–2. Decisions locked from product discussion: **converge spotlight planes**, **Join auto-opens Stage**, **human pin near roster names**, **collapse tool→card classifiers**.

## Why parallel

Show ranking currently reads live `spotlightParticipantId` while Spotlight content reads `stage.sharer`. Shipping enqueue/rank without convergence keeps a known footgun. Auto-stage unblocks slice 1 smoke. Classifier collapse is independent cleanup that prevents dual semantics for work cards.

## Sub-slices

### S1 · Converge spotlight planes

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| S1.1 | Make `call_set_stage` (sharer ± pin) the authority for “who presents” | landed handlers | core + webview | Strip aperture / roster control posts `call_set_stage`, not only `drive.spotlight.set` |
| S1.2 | Derive live `spotlightParticipantId` from stage sharer on every `control.stage` (always sync, not only when null) | S1.1 | `DriveRoomStore.syncLiveFromSnapshot` | Planes cannot diverge after stage set |
| S1.3 | Rank tick reads sharer participant id (fallback live id) | S1.2, slice 2 | core | Documented single source |
| S1.4 | Deprecate dual writes from webview; keep `drive.spotlight.set` as thin alias → setStage agent/human without pin | S1.1 | hub | One code path |

**Depends on:** none from Show slices (can start now).  
**Unlocks:** S3 human pin UX.

### S2 · Join auto-opens Stage

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| S2.1 | On successful `applyRoomSnapshot` after join with `driveActive`, set `stageLayout: true` | — | `useDriveSession` | Join alone opens Spotlight split |
| S2.2 | Update DEMO/smoke docs that still say Stage on is a second click | S2.1 | docs | Docs match code |

**Depends on:** Join path (landed).  
**Unlocks:** smoother slice 1 demos.

### S3 · Human pin control (roster / names)

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| S3.1 | Roster/strip control next to human name: “Share pin” opens kind picker (selection/file/terminal) using `buildHumanPinDefaults` | S1.1 | hub webview | Posts `call_set_stage` with human sharer + pin |
| S3.2 | Control next to agent name: “Return spotlight” → `call_set_stage` agent sharer, pin cleared | S3.1 | hub webview | Spotlight human branch clears; cards undim |
| S3.3 | Remove or repurpose dead aperture-only toggle | S1.4 | hub | No parallel unlabeled control |

**Depends on:** S1.  
**Unlocks:** DRV-SHARE bidirectional gap C.

### S4 · Collapse classifiers

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| S4.1 | Move tool-name → category map to `@cline/drive` or `@cline/shared` single module | — | drive/shared | One export used by hub `work-from-tool` |
| S4.2 | Webview `stageReducer` imports shared classifier (demo/tests only path) | S4.1 | hub webview | Delete duplicated name sets |
| S4.3 | Optionally plumb command `summary` through `WorkCommandEvent` so Terminal cards show output | S4.1 | shared + drive reduceRoom | Live command cards richer |

**Depends on:** none (independent).  
**Unlocks:** consistent cards across demo vs live.

## Ordering within S

```text
S4 (anytime)
S2 (anytime)
S1 → S3
```

Recommend: **S2 + S1 before or with slice 1**; **S4 anytime**; **S3 after S1**, can trail Show slice 2.

## Acceptance (track)

- [x] Live spotlight and stage sharer agree after every stage/aperture action.
- [x] Join opens Stage without a second click.
- [x] Human can pin from roster; agent return clears pin.
- [x] One classifier module; no duplicated tool-name sets.
