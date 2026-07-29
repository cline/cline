# Schemas · Phase 0 index

**Purpose.** Name the schema packages Phase 0 must introduce before UI depth.  
**Ownership.** Types in `@cline/shared` (versioned events + durable shapes). Pure compile/policies in `@cline/drive`. FS commit via hub/host.

## Packages / files

| Area | Location | Contents | Status |
|---|---|---|---|
| Events | `sdk/packages/shared/src/drive/events.ts` | Versioned union: presence, call state, stage cards, narration, steer, interrupt, gate, handoff, **guidance artifacts** (problem, constraint, requirement, option, decision, open_question, checklist, coverage_gap) | landed |
| Participants / roster | `sdk/packages/shared/src/drive/room.ts` | Participant, roles, mute, stage | landed |
| Address | `sdk/packages/shared/src/drive/address.ts` | everyone \| agentIds \| pack | landed |
| AgentRef | `sdk/packages/shared/src/drive/agentRef.ts` | Locked union: `driveagent` \| `builtin` \| `configured` (migration-only). `PairAgentRefSchema` aliases this for `drive.defaults.pairAgent` | landed |
| AgentProfile | `sdk/packages/shared/src/drive/facets/schemas.ts` (`AgentProfileSchema`) | Appearance overlay: `id`, `ref`, `displayName?`, `nameInk`, `bodyInk` — no prompt/tool/model fields | landed |
| Facets | `sdk/packages/shared/src/drive/facets/` + `sdk/packages/drive/src/facets/` | Catalog, merge, tombstones, schemaVersion | landed (hub IO still open) |
| Driveagent home | `sdk/packages/shared/src/drive/home/` | Zod for `agent.yaml`, `permissions.yaml`, `env.yaml` (secretRef; reject plaintext secret keys); `DriveagentHome` composite | landed |
| Derived graph | `sdk/packages/shared/src/drive/home/schemas.ts` (`DriveagentDerivedGraphSchema`) | `{ version, agentSlug, nodes[], edges[], compiledAt }` | landed |
| Home compile | `sdk/packages/drive/src/home/compile.ts` | Pure `compileDriveagentHome` → ConfiguredAgent-shaped view; fixture: `examples/driveagent-pair-partner/` | landed |
| Host port | `sdk/packages/drive/src/hostPort.ts` | `DriveHostPort`, capability descriptor | landed |
| Reducers | `sdk/packages/drive/src/reduceRoom.ts` | Pure fold / projection | landed |

## Invariants to encode in types + tests

1. Events cannot carry raw audio bytes or full transcript blobs (DRV-PRIVACY).
2. Facet/profile documents cannot carry prompt/tool/provider/model fields (DEC-agent-SoT). **Targets:** `AgentAppearanceSchema`, `AgentProfileSchema`, `DRIVE_FACET_FORBIDDEN_PROMPT_KEYS` in `facets/schemas.ts` (+ tests in `facets.test.ts`).
3. `Team` string must not appear as a Drive type identifier (`RosterPack` only).
4. Unknown facet `schemaVersion` major → refuse load.
5. Derived graph files are not inputs to compile.
6. `learned_from` evidence is ids/paths/hashes — not utterance text by default (ARD-0004).
7. `env.yaml` `values` must not contain plaintext secret keys; use `secretRefs` (`DRIVE_ENV_FORBIDDEN_SECRET_KEYS`).

## Migration

| From | To | Rule |
|---|---|---|
| `.cline/agents/*.yaml` | `.driveagent/<slug>/` | Import once; `configured` AgentRef migration-only (`id`, not legacy `name`) |
| Chat-local Drive React state | Hub room snapshot | Phase 1 replaces scaffold as authority |
| Wireframe A Chat-header-only | Drive tab route | Tab is primary |

## Compile contract (homes)

Inputs: `agent.yaml`, `permissions.yaml`, `env.yaml`, `knowledge/catalog.yaml`, `knowledge/nodes/**`, `knowledge/edges.yaml` (exclude `knowledge/private/` by default).  
Output: `.derived/graph.json` with `{ version, agentSlug, nodes[], edges[], compiledAt }` stable-sorted by id.

Phase 0 stub: `compileDriveagentHome` projects identity/tools/skills/prompt into a ConfiguredAgent-shaped view; graph compile remains a follow-up.

## Reading order for implementers

1. [DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md)  
2. [ARD-0001](../ard/ARD-0001-driveagent-home.md) / [ARD-0002](../ard/ARD-0002-agent-graph-canonical-derived.md)  
3. [DRV-EVENTS](../features/DRV-EVENTS.md) / [DRV-PLATFORM-CONFIG](../features/DRV-PLATFORM-CONFIG.md)  
4. Example fixture `examples/driveagent-pair-partner/`  
5. This index
