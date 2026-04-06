# Cline Desktop

`@clinebot/desktop` is a Tauri desktop app that wraps the tasks UI and uses the shared RPC runtime for chat plus CLI subprocesses for task cards.

## What It Does

- Adds `desktop` as a Bun workspace package.
- Runs a Next.js frontend inside a Tauri webview.
- Starts agent tasks by spawning the CLI (`packages/cli/src/index.ts`) per card.
- Boots an owner-scoped RPC sidecar on startup via `clite rpc ensure` + `clite rpc register`.
- Runs chat through RPC runtime methods (`startRuntimeSession`, `sendRuntimeSession`, `abortRuntimeSession`).
- Streams chat runtime events over one persistent websocket envelope (`chat_event` / `chat_response`).
- Reuses runtime chat helpers via `@clinebot/core` re-exports for desktop/code bridge scripts:
  - [`packages/rpc/src/runtime-chat-client.ts`](./packages/rpc/src/runtime-chat-client.ts)
  - [`packages/rpc/src/runtime-chat-command-bridge.ts`](./packages/rpc/src/runtime-chat-command-bridge.ts)
  - [`packages/rpc/src/runtime-chat-stream-bridge.ts`](./packages/rpc/src/runtime-chat-stream-bridge.ts)
  - [`apps/desktop/scripts/chat-runtime-bridge.ts`](./apps/desktop/scripts/chat-runtime-bridge.ts)
- Auto-discovers sessions started directly from CLI (outside Desktop).
- Auto-discovery includes full persisted session history from the shared sessions backend (not only sessions with saved prompt/messages).
- Auto-discovery derives card titles from persisted prompts, and falls back to the first user message in session messages when prompt is missing.
- Uses persisted prompt data (and falls back to the first user message) for discovered session card titles.
- Tracks live output via streamed stdout/stderr events.
- Tracks progress via lifecycle hook events (`tool_call`, `tool_result`, `agent_end`, `session_shutdown`).
- Persists shared session registry in SQLite with optimistic status locking.

## SDK Import Boundary

Desktop should use explicit runtime imports:

- Frontend/browser modules: `@clinebot/llms/browser`
- Node runtime modules (CLI/Tauri/scripts): `@clinebot/llms/node`, `@clinebot/core/node`, `@clinebot/rpc`

## Scripts

From `packages/desktop`:

- `bun run dev:web` starts the frontend only on `http://localhost:3124`.
- `bun run dev` starts Tauri desktop dev mode.
- `bun run build` builds the frontend.
- `bun run tauri:build` builds the desktop app bundle.
- `bun run typecheck` runs TypeScript checks.

From repository root (`packages`):

- `bun run dev:desktop`
- `bun run build:desktop`

## Basic Flow

1. Open desktop app.
2. Tauri ensures/registers RPC and starts the local chat websocket bridge.
3. Chat UI opens one websocket (`get_chat_ws_endpoint`) and sends command envelopes (`start/send/abort/reset`).
4. Tauri proxies chat commands to one persistent RPC runtime bridge script and forwards stream events.
5. Task cards still run as CLI subprocesses for long-running task orchestration.
6. Card state updates from streamed chunks + hook logs and session end transitions.
7. Kanban session discovery reads directly from the root SQLite sessions DB (`~/.cline/data/sessions/sessions.db`) so desktop history is independent from workspace CLI wiring.
8. Board refresh performs a forced rediscovery (clears hydration cache and reloads persisted CLI sessions).
9. Session listing and deletion are both root-DB-backed for deterministic history hydration (`~/.cline/data/sessions/sessions.db`), with artifact cleanup under the shared session data directory.

Task creation default:

- New task cards leave `maxIterations` unset by default (no loop cap unless explicitly provided).

## Environment

The app resolves API keys from either:

- explicit key entered in UI, or
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in environment.

## Data Paths

- Shared CLI session data root: `~/.cline/data/sessions/`
- Shared CLI DB: `~/.cline/data/sessions/sessions.db`
- Session artifacts (root + subagent + teamtask sessions all use the same flat layout per concrete session id):
  - `~/.cline/data/sessions/<session-id>/<session-id>.log`
  - `~/.cline/data/sessions/<session-id>/<session-id>.hooks.jsonl`
  - `~/.cline/data/sessions/<session-id>/<session-id>.messages.json`
  - `~/.cline/data/sessions/<session-id>/<session-id>.json`
- Kanban session hydration reads only shared session artifacts (legacy desktop file-state paths are no longer used).
- Kanban groups `cancelled` sessions with `completed` for board display.
- Root session folders are created only after the first user prompt is submitted.
- Team state/history: SQLite in `~/.cline/data/teams/teams.db` (`team_runtime_snapshot`, `team_events`, `team_tasks`, `team_runs`, `team_outcomes`, `team_outcome_fragments`)
