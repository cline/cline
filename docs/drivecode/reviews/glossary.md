# Drivecode glossary (plain language)

Short definitions for terms that show up in PRs #1 and #2. Pair with [PR-1-2-drivecode-eli5-and-review.md](./PR-1-2-drivecode-eli5-and-review.md).

| Term | ELI5 | Precise meaning in these plans |
|---|---|---|
| **Drive / Drivecode** | Coding on a call with AI friends | Product + fork work to make Cline feel like a pair-programming call room |
| **Drive tab** | The home screen for rooms | Primary IA: sidebar of channels/call rooms (Discord-in-Slack chrome) |
| **Chat Join call** | Shortcut button | Opens/focuses the active Drive room; not the product home |
| **Room** | The call you are in | Typed object with participants, transcripts, stage, address set |
| **Hub** | The referee | Daemon on `ws://127.0.0.1:25463`; only writer of room state |
| **Stage** | Shared whiteboard of work | Last-event-wins projection of edits/tests/decisions (not pixel capture in MVP) |
| **Address set** | Who you are talking to | Recipients for the next send: everyone, selected agents, or a pack |
| **Roster** | Who is in the call | Participants (human or agent), each with seating sources |
| **RosterPack** | Saved seating chart | Human-curated preset of who to seat; **not** Cline `Team` |
| **Team (Cline)** | Runtime work group | Existing Cline execution-group concept; do not reuse the name for Drive seating |
| **AgentProfile** | Costume / name tag | Appearance overlay (displayName, inks, permission intent) on a real agent |
| **Driveagent / `.driveagent/`** | Agent’s personal binder | Durable home: config + knowledge graph; compiles into host runtime |
| **Knowledge graph** | Map of what the agent knows/can do | Canonical YAML nodes/edges; derived `graph.json` for tools |
| **Recruit** | “Who should do this?” | Rank agents (and maybe suggest packs) from a need query |
| **Seat / seatSources** | Sit down in the room | Hub op that adds a participant; sources refcount why they are seated |
| **Participant sheet** | Transcript \| Profile chooser | Roster click opens identity vs conversation (Discord/Slack pattern) |
| **Gated learn** | Ask before remembering | Propose → accept/reject/mute; no auto transcript → knowledge |
| **`@cline/drive` / drivecode-sdk** | Rulebook for call mode | Same package role: pure Drive kernel + host port + conformance; not a second runtime |
| **Events-first** | Tell the story as cards | Surfaces render versioned events; WebRTC pixels are later |
| **ARD** | Written decision | Architecture Decision Record; 0001–0004 are Proposed until accepted |
| **PRD 6** | Product requirements for portfolios | Driveagent portfolio / graph / recruit requirements doc |
| **DRV-\*** | Feature tickets as docs | Checklistable feature specs under `features/` |
| **Persona / narration** | How the partner talks | Senior-engineer tone; narrate decisions, not every keystroke |
| **Interrupt / raise hand** | Pause the partner | Pause after current tool (or hard cancel per policy) |
| **Conformance kit** | Honesty test for hosts | Fail-closed checks that a host really supports declared Drive capabilities |

## Forbidden shortcuts (from the plans)

- Do not default anything to port `:7891`.
- Do not put `systemPrompt` / tools / skills / provider / model into Drive facets.
- Do not auto-dump room transcripts into `.driveagent/**/knowledge/`.
- Do not name Drive seating types `Team`.
- Do not treat Chat Join as the only entry once Drive tab exists.
