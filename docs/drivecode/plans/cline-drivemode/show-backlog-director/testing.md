# Show backlog director · testing

Back to [overview.md](overview.md).

## Package checks (every slice touching SDK)

```sh
bun run build:sdk
bun -F @cline/shared test
bun -F @cline/drive test
bun -F @cline/core test:unit
bun -F @cline/cline-hub test
```

## Per-slice verification

| Slice | Automated | Live / manual |
|---|---|---|
| 1 Present trigger | Handler + webview unit for post shape | Join → Stage → Present sample → sticky SVG |
| 2 Enqueue + rank | Rank bias unit; enqueue/tick integration | Enqueue two items → tick → higher priority sticky |
| 3 Script runner | `advanceScriptBeat` + hub advance test | Two-beat hold: same URI, new caption |
| 4 Do↔Show | Enqueue Do → tick → claim → promote creates shows | Workers audit lists new show ids |
| 5 Planner | Heuristic unit; cooldown unit | Planner on: tool complete enqueues; off: none |
| 6 Producers | Per-tool materialize tests | Present plan_card + walkthrough |
| 7 Router | planRoute + routeSuggest unit; address bias on tick; muted say blocks | Suggest chip → accept → `call_set_address` → rank prefers owner |
| S1 Converge | setStage syncs live spotlight | Aperture/roster cannot diverge from sharer |
| S2 Auto-stage | applyRoomSnapshot sets stageLayout | Join alone shows Spotlight column |
| S3 Pin | call_set_stage from roster | Human pin dims agent deck; return clears |
| S4 Classifier | Single module import sites | Demo + live cards same category for same tool |

## Minimum vertical gate

Slices **1 + 2 + 3** with fixture seed (no planner):

1. Join Drive call (Stage auto-open if S2 done).
2. Enqueue mermaid show (or present sample from slice 1).
3. Tick ranks/presents → StickyStagePane.
4. Attach 2-beat script → advance → sticky holds, caption changes.

## Slice 5 live smoke (Heuristic planner)

1. Join call → Settings → Sample / dev → **Planner on** (default when unset).
2. Trigger an edit work card (`call_record_work` / agent write) → sticky may update to walkthrough template; `drive.show.planned` carries `scoreReasons` / planner reason.
3. Click **Planner off** → further edit work does not enqueue new shows.
4. Command/bash work should not enqueue (noisy path skipped).

## Slice 4 live smoke (Do ↔ Show)

1. Enqueue a Do with `linkedShowTemplateIds: ["doc.plan"]` via `drive.do.enqueue` (or claim with that field on the Do).
2. `drive.fork.tick` with parentSessionId + assignee → worker appears under Workers.
3. Promote with `retainForAudit: true` (optionally `tickShow: true`).
4. Confirm director `showBacklog` has a ready/showing row with `linkedDoItemId` set; Workers audit lists the show id.

Automated: `drive-fork-tick.test.ts`, `drive-fork-handlers` promote+tickShow tests, `showIdsForFork` unit.

## Slice 3 live smoke (Script hold)

1. Join call (Stage auto-opens) → Settings → Sample / dev.
2. **Attach sample script** → sticky shows diagram with Beat 1 caption.
3. **Next script beat** → same diagram URI, caption becomes Beat 2.

1. Join call → Stage on → open Settings → Sample / dev.
2. Click **Enqueue sample diagram** (sticky should not change yet).
3. Click **Tick show director**.
4. Confirm sticky shows the queued architecture diagram SVG.

Prereqs: hub dashboard running (`bun run --cwd apps/cline-hub dev`), open printed URL, Chat view.

1. Join call (header **Join call**).
2. Stage on (unless auto-stage landed).
3. Open call-strip **Settings**.
4. Under **Sample / dev**, click **Present sample diagram**.
5. Confirm `StickyStagePane` shows title “Architecture overview”, Sample/dev caption, and an SVG (data URI).

No LLM credential required. Control is labeled Sample / dev until the planner lands.

## Non-gates

- `?demoShareScreen=1` fixture demo.
- `?demoChatFork=1` local demo.
- WebRTC / pixel capture.
