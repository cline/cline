# Verifier artifacts — share-screen live-demo

Independent verification of the `live-demo` target on branch `orch/share-screen-canvas/live-demo`.

## Commands run
- `bun install` → ok
- `bun run build:sdk` → exit 0 (all @cline/* packages built)
- `bun --cwd apps/cline-hub test` → 23 files, 164 tests passed
- `bun --cwd apps/drivecode-demo test` → 9 tests passed

## Live launch
- `bun run --cwd apps/cline-hub dev` in tmux → dashboard `http://127.0.0.1:8787/`, Vite `:5173`.
- Opened `http://127.0.0.1:8787/drive?demoShareScreen=1` via headless Chrome + CDP (no LLM credential path used by the route).

## Scripts
- `cdp-verify.mjs` — navigate + dump text/markers + screenshot.
- `cdp-click.mjs` — pause loop, step to test beat, force human-takes-spotlight; dump text + screenshots.

## Captured evidence (live)
- `demo-beat0.png` — beat 3/5 (command), Spotlight shows EDIT + COMMAND + PLAN, sharer "Adam (agent partner)".
- `demo-test-beat.png` — beat 4/5 (test), Spotlight shows EDIT + COMMAND + TEST + PLAN.
- `demo-human-pin.png` — human takes spotlight: SELECTION "Human review note" pin, agent deck dimmed/paused.

Committed screenshots under `docs/assets/drivecode/share-screen-spotlight-demo-*.png` match the live render.
