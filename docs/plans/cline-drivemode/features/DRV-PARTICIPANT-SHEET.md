# DRV-PARTICIPANT-SHEET · Transcript vs profile on roster click

Back to [README](../README.md). Phase 1–2 in [TASK-GRAPH](../TASK-GRAPH.md). Product: [PRD 6](../prd/prd-driveagent-portfolio.md). Decisions: [ARD-0001](../ard/ARD-0001-driveagent-home.md).

## Problem / user value

Main-chat demos treated a roster click as “open that agent’s stream and address them.” Discord and Slack treat click as identity first. Users need both: **see the conversation with this participant** and **inspect or edit who they are**. One click that silently does both causes misfires (private stream open, message still broadcast to everyone). Address-follows-focus stays valid only when the user chose Transcript.

## Acceptance criteria

- Primary click (or Enter) on a roster row opens a chooser or split affordance with exactly two intents: **Transcript** and **Profile**. Right-click / `…` always exposes both.
- **Transcript** focuses that participant’s stream (`agentStreams[id]` or room thread for self) per [DRV-TRANSCRIPT](DRV-TRANSCRIPT.md), and sets address-follows-focus to that agent (or clears to everyone for self) per [DRV-ADDRESS](DRV-ADDRESS.md).
- **Profile** opens the participant sheet without changing transcript focus unless the user also chooses Transcript.
- Sheet header is a **classifier strip**:
  - Kind: `human` | `agent` | `builtin`
  - Live: speaking / muted / sharing / stale
  - Role when pack-seated: lead | member
  - Permission intent + effective cap
  - Shortcut: “To: this agent”
- Human sheet (MVP): display name, presence, link to shared transcript. No skills list.
- Agent sheet sections (MVP progressive):
  1. Overview — appearance editor ([DRV-AGENT-PROFILE](DRV-AGENT-PROFILE.md))
  2. Capabilities — tools/skills from [DRV-DRIVEAGENT-HOME](DRV-DRIVEAGENT-HOME.md) (read projection)
  3. Access — permissions summary (locked reason if not editable)
  4. Knowledge — portfolio lens when [DRV-AGENT-GRAPH](DRV-AGENT-GRAPH.md) lands
  5. Files — home tree view / open-in-editor
- Editability is per-section. Appearance may be editable while definition is locked.
- Sheet is a client projection over hub + home loader. No second writable participant store.

## Dependencies

- [DRV-ROSTER](DRV-ROSTER.md), [DRV-TRANSCRIPT](DRV-TRANSCRIPT.md), [DRV-ADDRESS](DRV-ADDRESS.md), [DRV-AGENT-PROFILE](DRV-AGENT-PROFILE.md), [DRV-DRIVEAGENT-HOME](DRV-DRIVEAGENT-HOME.md) for agent sections.

## Surfaces touched

- `apps/cline-hub/src/webview/src/drive/` (`ParticipantSheet.tsx`, roster click handlers)
- Canvas / wireframe Drive-tab demos (chooser parity)

## Agent tasks

- [ ] Replace single-intent roster click with Transcript | Profile chooser; keep address-follows-focus only on Transcript.
  - Owner package: `@cline/cline-hub`
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: choosing Profile does not change address set; choosing Transcript focuses stream and addresses that agent.
- [ ] Ship classifier strip + Overview (appearance) for agent and human.
  - Owner package: `@cline/cline-hub`
  - Done when: live smoke shows kind, mute, and rename from Overview without leaving the call.
- [ ] Wire Capabilities + Files from home loader when DRV-DRIVEAGENT-HOME lands.
  - Owner package: `@cline/cline-hub` + hub read op
  - Done when: skills/tools lists match `agent.yaml` for a fixture home.

## Risks

- Click overload. Mitigation. Explicit two intents; double-click may default to Transcript (document the binding).
- Sheet becomes a prompt editor. Mitigation. Definition edits go through home files / editor; facets stay appearance-only ([ARD-0001](../ard/ARD-0001-driveagent-home.md)).
