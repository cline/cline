# 03 · Research. Cline surface inventory and gaps

Back to [README](README.md). Grounded in the wireframes README (`docs/design/drive-wireframes/README.md`) and direct repo inspection.

## Surfaces that already map to the call metaphor

| Call concept | Existing Cline surface | Path | Wired today? |
|---|---|---|---|
| Shared screen | Hub chat feed plus tool/terminal/code cards | `apps/cline-hub/src/webview/src/Chat.tsx`, `components/ai-elements/{tool,terminal,code-block,test-results,file-tree}.tsx` | Feed yes, cards partially |
| Partner presence | Rive persona avatar (idle/listening/thinking/speaking/asleep) | `components/ai-elements/persona.tsx`; TUI has `apps/cli/src/tui/components/robot-animation.tsx` | Bundled, not wired |
| Mic and mute | Speech input plus device picker | `components/ai-elements/{speech-input,mic-selector}.tsx` | Bundled, not wired |
| Voice out | Voice picker plus audio player | `components/ai-elements/{voice-selector,audio-player}.tsx` | Bundled, not wired |
| Live captions | Transcription element | `components/ai-elements/transcription.tsx` | Bundled, not wired |
| Chat composer | Hub composer; TUI input bar | `components/Composer.tsx`; `apps/cli/src/tui/components/input-bar.tsx` | Wired |
| Status | Status badges; TUI status bar | `components/ai-elements/status-badge.tsx`; `apps/cli/src/tui/components/status-bar.tsx` | Wired |
| Plan cursor (now/next) | Plan and task elements | `components/ai-elements/{plan,task}.tsx` | Bundled, not wired |
| Steer queue | Queued prompts in TUI; pending prompt service in core | `apps/cli/src/tui/components/queued-prompts.tsx`; `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` | Core exists, hub UI gap |

The headline. Most ai-elements are bundled but not wired into `Chat.tsx`. The shared screen is assembly work over the hub event stream, not new component work.

## Hub

The hub daemon lives in `sdk/packages/core/src/hub/` (discovery, daemon, server, client, runtime-host) and serves `ws://127.0.0.1:25463`. It already provides command/reply plus event streams and session adapters (`HubSessionClient`, `HubUIClient`, `connectToHub`). Missing for Drive: a room object, roster and presence, stage-owner pointer, and drive-specific broadcast events. That is DRV-ROOM-MVP plus DRV-EVENTS.

## Hooks

Hook infrastructure exists in `sdk/packages/core/src/hooks/` (hook engine wiring, `hook-file-hooks.ts`, `subprocess.ts`) with event names in `sdk/packages/shared/src/hooks/events.ts`. The gap. `prompt_submit` may observe but not rewrite the prompt. Drive needs an honest override path, an `AgentRuntimeHooks` contract where mutation is explicit, typed, and logged. That is DRV-HOOK-POLICY. No side-channel interception.

## Workflows to define

The call loop needs these named workflows, each a thin op over kernel and room state:

- **join** (activate Drive, attach or create the room)
- **leave** (detach, room persists)
- **steer** (queue guidance mid-turn)
- **interrupt** (hand raise, pause-after-tool)
- **mode** (ask/debug/plan/act overlays)
- **handoff explain** (partner summarizes state for the next session or human)
- **end session** (close the room with a handoff explanation)

## Skills and persona

cursor-drive has mature persona and mode skills (`drive-persona`, `drive-modes`, `drive-concise`). Cline has a skill loading mechanism plus `.clinerules`. The port (DRV-SKILL-PORT) is adaptation work. Remove Cursor-specific MCP tool references, rebind mode signals to the kernel, and keep the senior-engineer tone.

## Scope guardrails from the inventory

- MVP is one pair partner. Operators are not teams. Multi-agent stays behind DRV-TEAM-OPT and off by default.
- No second MCP daemon on `:7891`. The hub is the only server.
- Feature backlog IDs and their files are indexed in [README](README.md).
- Wireframes and variant comparison live at `docs/design/drive-wireframes/README.md`.
