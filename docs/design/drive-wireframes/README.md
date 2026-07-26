# Drive-in-Cline wireframes

Design exploration for Drive's pair-partner UX inside Cline. Mocks are throwaway HTML. Open in any browser; keys switch variants.

## Current primary UI direction

**Drive tab (Discord IA inside Slack chrome).** One Drive activity in the hub left nav. Inside it: channels + call rooms, nested agent roster, room vs per-agent transcript, address chips, and a stage that supports agent share and user share. Chat **Join call** is a shortcut into the active Drive room, not the only entry.

| Artifact | Role |
|---|---|
| [DEMO.md](DEMO.md) | Click-through runbook for HTML, hub fixture, CLI teaser, and overview canvas |
| [overview-canvas.html](overview-canvas.html) | In-repo replacement for the old Windows-only `cline-drivecode-overview.canvas.tsx` |
| [DRIVE-TAB.md](DRIVE-TAB.md) | Decision record and domain shape |
| [drive-tab-discord-slack.html](drive-tab-discord-slack.html) | Throwaway prototype (keys 1/2 for Discord-leaning vs Slack-leaning chrome; accent switcher for the two Cline violet treatments) |
| [CLINE-BRAND-TOKENS.md](CLINE-BRAND-TOKENS.md) | Brand tokens measured off cline.bot — palette, surfaces, type, radius, and what not to copy |

Recommendation locked there. Ship Discord-style call rows and roster inside Slack-like single-workspace chrome. Domain:

```
DriveTab > Workspace > TextChannels[] + CallRooms[]
Room: participants[], roomTranscript, agentStreams[], stage (sharer human|agent), addressSet
```

Plan features that implement this. [DRV-DRIVE-TAB](../../plans/cline-drivemode/features/DRV-DRIVE-TAB.md), [DRV-ROSTER](../../plans/cline-drivemode/features/DRV-ROSTER.md), [DRV-TRANSCRIPT](../../plans/cline-drivemode/features/DRV-TRANSCRIPT.md), [DRV-ADDRESS](../../plans/cline-drivemode/features/DRV-ADDRESS.md), [DRV-SHARE](../../plans/cline-drivemode/features/DRV-SHARE.md). Full plan index. [cline-drivemode](../../plans/cline-drivemode/README.md).

## Brand

Both prototypes are styled from [CLINE-BRAND-TOKENS.md](CLINE-BRAND-TOKENS.md), measured off cline.bot rather than guessed. Short version: violet `#9F58FA` on near-black `#0A0A0A` surfaces, hairline `0.8px` borders, `9px` radius, DM Sans for display, Space Grotesk for eyebrows and code. UI text is **Schibsted Grotesk**, because that is what the hub webview actually sets (`--font-sans` in `apps/cline-hub/src/webview/src/index.css`) — the site's Inter loses to product fidelity here. Discord blurple is deliberately absent — the Discord reference is information architecture, not palette.

Both prototypes also wear the same chrome: the hub activity rail (Home / Sessions / Chat / Drive / Agents / MCP / Settings) on the far left, `:25463` in the corner, and a composer that follows `components/Composer.tsx` — input line first, then a tool row carrying attach, `provider:model`, thinking, and the mode segment, with submit on the right. They should read as one product, not two mocks.

`drive-tab-discord-slack.html` carries two accent treatments behind one switcher so the choice can be made by looking rather than arguing:

- **Violet fill** — selected rows and the primary CTA are solid violet. Loud, unambiguous, closer to Discord's density of colour.
- **Violet edge** — selection is a violet left edge and a raised surface; only the CTA is filled. Quieter, closer to how cline.bot actually spends its accent.

## Earlier Chat-chrome exploration (still useful)

The first mock (`index.html`, keys 1/2/3) explored how call feel lands on the **existing Chat** surface. It opens with a superseded banner, labels each variant's fate inline (A kept as in-room feed behavior, B kept as the room stage, C rejected), and links across to the Drive tab. Screenshots: `variant-a.png`, `variant-b.png`, `variant-c.png` (captured pre-rebrand; the page itself is now on Cline tokens and hub chrome). That work still grounds the Call Stage reducer and ai-element assembly. It is no longer the primary IA.

Architecture frame (fixed, not reopened here). `@cline/drive` kernel wraps native Cline. The hub is the single writer. No new daemon, no Cursor DOM.

## Grounding: Cline surfaces mapped to the call metaphor

| Call concept | Existing Cline surface | Path |
|---|---|---|
| Drive home (primary) | New hub left-nav Drive tab | `apps/cline-hub` (planned; see DRV-DRIVE-TAB) |
| Shared screen | Hub chat feed + tool/terminal/code cards | `apps/cline-hub/src/webview/src/Chat.tsx`, `components/ai-elements/{tool,terminal,code-block,test-results,file-tree}.tsx` |
| Partner presence | Rive persona avatar (idle/listening/thinking/speaking/asleep) | `components/ai-elements/persona.tsx`; TUI has `apps/cli/src/tui/components/robot-animation.tsx` |
| Mic / mute | Web Speech + MediaRecorder input, device picker | `components/ai-elements/{speech-input,mic-selector}.tsx` |
| Voice out | Voice picker + audio player | `components/ai-elements/{voice-selector,audio-player}.tsx` |
| Live captions | Transcription element | `components/ai-elements/transcription.tsx` |
| Chat / composer | Hub composer; TUI input bar | `components/Composer.tsx`; `apps/cli/src/tui/components/input-bar.tsx` |
| Status | Status badges; TUI status bar | `components/ai-elements/status-badge.tsx`; `apps/cli/src/tui/components/status-bar.tsx` |
| Plan cursor (now/next) | Plan and task elements | `components/ai-elements/{plan,task}.tsx` |
| Join shortcut | Chat header Join call | Chat chrome; opens/focuses active Drive room |

Most `ai-elements` are bundled but not yet wired into `Chat.tsx`. The shared screen is assembly work over the hub event stream, not new component work.

## Chat variants (historical)

**A · Drive Layer.** Drive is a toggle on the existing hub Chat view. The feed is the shared screen. Additions are a persona chip in the header, a narration message style in the feed, a mic button in the composer, and ask/debug overlays on the plan/act pill. No new panels. Retained as the Join-call shortcut path and as the phase-1 feed behaviors inside a room.

**B · Call Stage.** When in a call, conversation and stage split. The stage is a last-event-wins reducer over hub session events. Call strip pins presence, mute, interrupt, and mode. Now/next shows the plan cursor. Still the stage target; it mounts inside the Drive tab room view (and can appear via the Chat shortcut).

**C · PiP Partner.** Rejected. Trades the screen-share core for a novelty overlay and has no VS Code story.

## Staging relative to the Drive tab

- **Phase 1.** Drive tab with one call room, nested roster shell, room join via the tab. Chat Join call is a shortcut into that room. Feed-level persona, narration, and mode overlays still apply.
- **Phase 2.** Stage + bidirectional share, room vs per-agent transcript focus, address set, call strip, steer, interrupt.
- **Phase 3.** Voice (mic, TTS, captions) on the proven call.
- **CLI parity (later).** Same room event contract in the TUI.

## Open product forks (preference calls)

From [DRIVE-TAB.md](DRIVE-TAB.md):

1. **Per-agent stream.** True private agent log vs filtered view of the same room events.
2. **User share MVP.** Pixel capture vs structured share (selection / file / terminal) until WebRTC.

Carried from the Chat wireframes (still open):

3. **Narration density.** Every tool call vs decision points only. Default remains decision-point density.
4. **Interrupt semantics.** Pause-after-tool vs hard-cancel. Default remains pause-after.
