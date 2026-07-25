# Schemas · Phase 0 index

**Purpose.** Name the schema packages Phase 0 must introduce before UI depth.  
**Ownership.** Types in `@cline/shared` (versioned events + durable shapes). Pure compile/policies in `@cline/drive`. FS commit via hub/host.

## Packages / files (planned)

| Area | Planned location | Contents |
|---|---|---|
| Events | `sdk/packages/shared/src/drive/events.ts` | Versioned union: presence, call state, stage cards, narration, steer, interrupt, gate, handoff, **guidance artifacts** (problem, constraint, requirement, option, decision, open_question, checklist, coverage_gap) |
| Participants / roster | `sdk/packages/shared/src/drive/roster.ts` | Participant, seatSources, roles, mute, stale |
| Address | `sdk/packages/shared/src/drive/address.ts` | everyone \| agentIds \| pack |
| Facets | `sdk/packages/shared/src/drive/facets.ts` | Catalog, merge, tombestones, schemaVersion |
| AgentRef / profile | `sdk/packages/shared/src/drive/profile.ts` | AgentRef union per DEC-agent-SoT; AgentProfile overlay |
| Home / graph | `sdk/packages/shared/src/drive/home.ts` + `graph.ts` | agent/permissions/env + node/edge kinds |
| Host port | `sdk/packages/drive/src/host-port.ts` | `DriveHostPort`, capability descriptor |
| Reducers | `sdk/packages/drive/src/reduce-room.ts`, `project-stage.ts` | Pure fold / projection |

## Invariants to encode in types + tests

1. Events cannot carry raw audio bytes or full transcript blobs (DRV-PRIVACY).
2. Facet/profile documents cannot carry prompt/tool/provider/model fields (DEC-agent-SoT).
3. `Team` string must not appear as a Drive type identifier (`RosterPack` only).
4. Unknown facet `schemaVersion` major → refuse load.
5. Derived graph files are not inputs to compile.
6. `learned_from` evidence is ids/paths/hashes — not utterance text by default (ARD-0004).

## Migration

| From | To | Rule |
|---|---|---|
| `.cline/agents/*.yaml` | `.driveagent/<slug>/` | Import once; `configured` AgentRef migration-only |
| Chat-local Drive React state | Hub room snapshot | Phase 1 replaces scaffold as authority |
| Wireframe A Chat-header-only | Drive tab route | Tab is primary |

## Compile contract (homes)

Inputs: `agent.yaml`, `permissions.yaml`, `env.yaml`, `knowledge/catalog.yaml`, `knowledge/nodes/**`, `knowledge/edges.yaml` (exclude `knowledge/private/` by default).  
Output: `.derived/graph.json` with `{ version, agentSlug, nodes[], edges[], compiledAt }` stable-sorted by id.

## Reading order for implementers

1. [DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md)  
2. [ARD-0001](../ard/ARD-0001-driveagent-home.md) / [ARD-0002](../ard/ARD-0002-agent-graph-canonical-derived.md)  
3. [DRV-EVENTS](../features/DRV-EVENTS.md) / [DRV-PLATFORM-CONFIG](../features/DRV-PLATFORM-CONFIG.md)  
4. Example fixture `examples/driveagent-pair-partner/`  
5. This index → open schema PR
