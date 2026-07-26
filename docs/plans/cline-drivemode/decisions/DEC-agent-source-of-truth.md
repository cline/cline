# DEC · Agent source of truth

**Status.** Recommended  
**Date.** 2026-07-25  
**Deciders.** Drivecode leadership planning wave  
**Supersedes.** Literal reading of `00-vision.md` MVP non-goal “no Drive-owned agent definition format”  
**Related.** ARD-0001, PRD 6, `06-platform-config.md`, `DRV-AGENT-PROFILE`, `DRV-DRIVEAGENT-HOME`

## Context

Two stories existed at once:

1. **Appearance-only Drive.** Prompts, tools, and models live only in `.cline/agents/*.yaml`. Drive overlays display name and inks.
2. **Driveagent home.** `.driveagent/<slug>/` holds identity, permissions, env, and a knowledge graph, then **compiles** into the host runtime.

Leaving both as written guarantees a dual registry — the exact failure platform-config already forbids for Drive facets.

## Decision

**Authoring home is `.driveagent/<slug>/`. Runtime remains a single Cline path via compile.**

1. Humans and tools edit `.driveagent/<slug>/` (canonical YAML).
2. A pure compile in `@cline/drive` projects the home into a host-shaped view (Cline `ConfiguredAgent`-compatible first).
3. The hub (or host adapter) performs FS I/O at the boundary; the webview never becomes a second writer of room or definition state that affects seats without hub ops.
4. `AgentProfile` remains an **appearance overlay** (`displayName`, `nameInk`, `bodyInk`, permission *intent*, pack membership) and refs `{ kind: "driveagent", slug }` or `{ kind: "builtin", id }`.
5. Drive facet / profile files **must not** contain `systemPrompt`, `tools`, `skills`, `providerId`, or `modelId`.
6. Legacy `.cline/agents/*.yaml` may import **once** into a home. Dual-authoring forever is a failure mode extinguished by docs + lint/CI.
7. Builtin pair partner may ship as a read-only synthetic home (`editable: false`).

### AgentRef (locked)

```ts
type AgentRef =
  | { kind: "driveagent"; slug: string }
  | { kind: "builtin"; id: string }
  | { kind: "configured"; id: string }; // migration-only; lint warns; no new writes
```

### What changes in vision

Replace the MVP non-goal that forbade a Drive-owned definition format with:

> Drive does not store prompts/tools/models in call facets or `AgentProfile`. Agent definitions are authored under `.driveagent/<slug>/` and compile into the host runtime. There is exactly one runtime path.

## Consequences

**Positive**

- Portfolio, recruit, and profile sheet have a durable home.
- Platform overlay rule preserved.
- Portable to drivecode-sdk host adapters later.

**Negative**

- Migration and compile must exist before profile UI edits definitions in-sheet.
- Authors learn a small home layout.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Facet-only prompt store | Recreates dual registry |
| `.cline/agents` only forever | Insufficient for multi-file graph + recruit |
| `.claude/` directory name | Wrong host metaphor |
| Two runtimes (Drive runtime + Cline) | Violates harness/host layering |

## Verification

- Phase 0: type/lint test fails if a Drive facet file contains prompt/tool/model fields.
- Example `examples/driveagent-pair-partner/` compiles in a fixture test before Profile write UI ships.
- `configured` AgentRef creation paths emit lint warnings in CI.
