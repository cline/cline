# ARD-0004: Gated learn; no transcript dump into agent knowledge

## Status

Recommended

## Metadata

- Date: 2026-07-25
- Deciders: Drivecode planning (cline-drivemode)
- Related: PRD 6, DRV-PRIVACY, BRIEF Lifecycle privacy, Constellation confirm/reject/mute

## Context

“Knowledge learned” is the most dangerous phrase next to a voice/chat pair-programming product. Drive’s privacy default is strict: no transcript or audio persistence. BRIEF’s lifecycle section similarly treats handoff privacy as policy, not an afterthought.

If we auto-write call content into `.driveagent/**/knowledge/`, we:

- Violate DRV-PRIVACY by another name.
- Create unreviewable lore that steers future turns.
- Teach users to distrust agent homes.

## Decision

1. **No automatic transcript → knowledge.** Room events are not durable agent memory.
2. **Learning is propose → accept | reject | mute.** Agents (or a post-call summarizer) may propose nodes/edges with evidence pointers (`learned_from` to artifact paths, skill ids, or event *ids*), never embedded raw utterance text by default.
3. **Accept is a human (or explicit policy) write** into canonical YAML under `knowledge/`, then compile (ARD-0002).
4. **Tiers:** ephemeral (RAM) / session (wiped on leave) / durable (home, opt-in). Only durable crosses the accept gate into canonical files.
5. **Turn injection** of portfolio context uses graduated retrieval (BRIEF read-mode spirit): prefer labels + short summaries; full node bodies only when selected or required by policy.
6. **Inject audit** records node ids (and optionally hashes), not prose, under privacy-tiered retention.
7. **`knowledge/private/`** is gitignored by convention; export/pack operations omit private and secretRefs.
8. **Main-chat privacy alignment.** Drive events already forbid raw audio / full transcript payloads ([DRV-EVENTS](../features/DRV-EVENTS.md), [DRV-PRIVACY](../features/DRV-PRIVACY.md)). Gated learn must not reintroduce those payloads through `learned_from` evidence blobs.
9. **Session end (W-05 / W-26).** Leaving or ending a call drops ephemeral and session-tier proposals. Only accepted durable edges remain under `.driveagent/`.

## Allowed evidence on proposals

| Allowed | Forbidden |
|---|---|
| Skill id / tool name used | Raw user utterance text |
| Artifact relative path | Full room transcript dump |
| Event id / hash | Audio bytes or STT buffers |
| Human-authored note on accept | Silent background write |

## Consequences

**Positive**

- Aligns portfolio learning with Drive privacy and BRIEF lifecycle discipline.
- Keeps recruitment evidence human-reviewable.
- Matches Constellation’s governance pattern users already value.

**Negative**

- Slower “magic memory” than competitors who silently retain chats.
- Requires UI for the accept queue (P3).

## Alternatives considered

- **Auto-durable summaries every call** — Rejected; privacy and lore poison.
- **Vector store of embeddings of transcripts** — Deferred/rejected for MVP; still a retention surface.
- **Drive facet “memory” strings** — Rejected; wrong store, hard to review, bypasses home compile.

## References

- [DRV-PRIVACY](../features/DRV-PRIVACY.md)
- BRIEF Lifecycle / handoff privacy
- PRD 6 P3 gated learn
- harrison-site Constellation: agents propose edges; humans confirm
