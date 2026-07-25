# DRV-CLI-PARITY · Drive in the TUI

Back to [README](../README.md). Phase 4 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Terminal-first users get the same call. The TUI already has the pieces (robot presence, status bar, input bar, queued prompts). Parity means the same event contract renders in the terminal, not a second implementation of Drive.

## Acceptance criteria

- `cline drive` (or the repo's idiomatic command shape) joins the call from the CLI, attaching to the same hub room.
- The TUI robot (`robot-animation.tsx`) reflects presence states, the status bar shows Drive mode and room state, narration renders as styled lines in the chat list.
- Steer queue works through the existing `queued-prompts.tsx` surface.
- Interrupt maps to a keybinding with the same pause-after semantics.
- No TUI-only state. Everything renders from the shared event stream, so hub and TUI views of the same room agree.
- Voice is out of scope for the TUI in this phase.

## Dependencies

- Phase 2 gate complete (events, room, kernel all proven on the hub surface).

## Surfaces touched

- `apps/cli/src/tui/components/{robot-animation,tracked-robot,status-bar,input-bar,chat-message-list,queued-prompts}.tsx`
- `apps/cli/src/` (drive command registration)

## Agent tasks

- [ ] Map how the TUI connects to sessions and where a hub room subscription fits.
  - Owner package: `@cline/cli`
  - Files likely: `apps/cli/src/`, TUI state wiring
  - Verify: written map with pointers
  - Done when: the subscription point is named.
- [ ] Add the drive command and room attachment.
  - Owner package: `@cline/cli`
  - Files likely: command registration, hub client usage
  - Verify: `bun -F @cline/cli test:unit`
  - Done when: the command joins and leaves the room in tests.
- [ ] Render presence, mode, and narration in the existing TUI components.
  - Owner package: `@cline/cli`
  - Files likely: `status-bar.tsx`, `chat-message-list.tsx`, `robot-animation.tsx`
  - Verify: `bun -F @cline/cli test:unit`, then interactive smoke via `bun run cli -i` with Drive on. Use the `control-cli` skill for the TUI drive.
  - Done when: a hub-joined and TUI-joined view of one room show the same call.
- [ ] Wire interrupt keybinding and steer queue.
  - Owner package: `@cline/cli`
  - Files likely: `input-bar.tsx`, `queued-prompts.tsx`
  - Verify: interactive smoke raising a hand mid-turn
  - Done when: pause-after works from the terminal.

## Risks

- TUI event throughput and render cost for busy work streams. Mitigation. The TUI renders the conversation and presence tracks and can summarize work events rather than rendering every card.
