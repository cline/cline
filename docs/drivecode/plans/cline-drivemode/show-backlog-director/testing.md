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
| 7 Router | planRoute unit; address bias on tick | Suggest chip → accept → rank prefers owner |
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

## Slice 2 live smoke (Enqueue + tick)

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
