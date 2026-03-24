# @clinebot/code

Tauri desktop shell + persistent Bun desktop backend + Next.js UI for running and inspecting Cline chat sessions.

## Dev Commands

From `apps/code/`:

- `bun run dev:web` - Next.js UI only (`http://localhost:3125`)
- `bun run dev:host` - desktop backend only
- `bun run dev` - Tauri desktop dev
- `bun run build` - build web assets
- `bun run build:host` - build the Bun host bundle
- `bun run build:host:bin` - compile the Bun host into a local binary
- `bun run build:binary` - build desktop binary
- `bun run typecheck` - TypeScript check

## Runtime Overview

Startup flow:

1. Tauri starts a persistent local desktop backend and keeps only native window/file-picker/open-path responsibilities.
2. The desktop backend ensures an owner-scoped RPC sidecar via `clite rpc ensure --json`, sets `CLINE_RPC_ADDRESS`, and registers the desktop client.
3. The backend owns `scripts/chat-runtime-bridge.ts` and exposes one websocket transport (`/transport`) for commands, queries, and pushed events.
4. The React app uses `lib/desktop-client.ts` and no longer imports `@tauri-apps/api/core` directly in feature code.
5. Tool approval updates are pushed from the backend instead of polled from the UI.
6. Session process context resolves `workspaceRoot` from git root and uses that same path as default `cwd` for chat runtime and git operations unless explicitly overridden.

Desktop transport envelope:

- Request: `{ "type": "command", "id": string, "command": string, "args"?: object }`
- Response: `{ "type": "response", "id": string, "ok": boolean, "result"?: unknown, "error"?: string }`
- Event: `{ "type": "event", "event": { "name": string, "payload": unknown } }`

## Settings: Routine

- The Settings sidebar includes a `Routine` view for scheduler-backed automations.
- `Routine` lists all RPC schedules and shows status (`enabled`, `nextRunAt`, active execution).
- From the UI you can open a create form and add, pause/resume, trigger-now, and delete schedules.
- The view is wired to the same scheduler APIs used by `clite schedule` through Tauri commands and `scripts/routine-schedules.ts`.

## Key Files

- [`src-tauri/src/main.rs`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/src-tauri/src/main.rs) - Tauri shell lifecycle, backend launch, and native-only commands
- [`host/index.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/host/index.ts) - persistent Bun desktop backend
- [`scripts/chat-runtime-bridge.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/scripts/chat-runtime-bridge.ts) - persistent RPC runtime bridge
- [`scripts/routine-schedules.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/scripts/routine-schedules.ts) - RPC scheduler action bridge for Settings > Routine
- [`lib/desktop-client.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/lib/desktop-client.ts) - typed desktop websocket client
- [`hooks/use-chat-session.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/hooks/use-chat-session.ts) - UI chat session state + backend subscriptions
- [`lib/chat-schema.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/lib/chat-schema.ts) - chat message schema used by the UI
- [`components/views/settings/routine-view.tsx`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/components/views/settings/routine-view.tsx) - Routine schedules UI

## Data + Storage

- Session artifacts are written under `~/.cline/data/sessions/<sessionId>/` (or `CLINE_SESSION_DATA_DIR`).
- Core files include `<sessionId>.messages.json`, `<sessionId>.hooks.jsonl`, and `<sessionId>.log`.

## Troubleshooting

- If live updates stall, verify the desktop backend websocket is connected and `chat_event` messages are arriving.
- Runtime bridge `send` calls are now bounded to 120s by default (`CLINE_RPC_RUNTIME_SEND_TIMEOUT_MS`). This prevents one hung turn from wedging the persistent bridge loop for all future chat requests.
- Tauri restarts the desktop backend if the host process exits and kills it on app teardown.
- Chat sends now preflight provider credentials. If a provider that requires API-key auth is selected without a key, the UI blocks the turn with a clear error message instead of starting a hanging session.
- If a turn completes with `finishReason=error` before any assistant content is produced, the UI now adds an explicit error chat message so failed turns are visible in the transcript.
- If package changes are not reflected, rebuild SDK packages (`bun run build:sdk`). The next `clite rpc ensure` call should attach to the current build's sidecar automatically.
- Provider settings updates are patch-style: only fields you edit are changed. Unset fields are preserved instead of being cleared.
