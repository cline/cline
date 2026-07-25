# ARD-0001: `.driveagent/` is the agent home

## Status

Proposed

## Metadata

- Date: 2026-07-25
- Deciders: Drivecode planning (cline-drivemode)
- Related: PRD 6, [06-platform-config.md](../06-platform-config.md), DRV-AGENT-PROFILE
- Inspired by: BRIEF [dot-agents layout](https://github.com/hhalperin/briefs/blob/main/docs/standards/brief/dot-agents-layout.md) (canonical vs derived)

## Context

We need a durable place for each Drive-managed agent’s configuration: capabilities/tools, permissions/approvals, env, and knowledge. Candidates:

1. Inflate Drive `AgentProfile` facets to hold prompts/tools/skills.
2. Keep using only `.cline/agents/*.yaml` and treat Drive as appearance-only forever.
3. Introduce a product home directory **`.driveagent/<slug>/`** with a compile path into the host runtime.
4. Reuse `.claude/` naming for familiarity with Claude Code.

## Decision

**Option 3.** Each Drive-managed agent has a home at:

```text
<workspace>/.driveagent/<slug>/
```

with optional user-tier homes under `~/.driveagent/<slug>/` using the same two-tier resolution spirit as ConfiguredAgent search paths.

1. **Slug is identity.** Display names are labels (same rule as `AgentProfileId`).
2. **Drive `AgentProfile` remains an overlay** (displayName, nameInk, bodyInk, permission *intent*, pack membership). It refs `{ kind: "driveagent", slug }` or `{ kind: "builtin", id }`.
3. **Definition files live only in the home** (`agent.yaml`, `permissions.yaml`, `env.yaml`, `knowledge/`).
4. **Compile, don’t fork.** A loader projects the home into whatever the host needs to run a turn (Cline `ConfiguredAgent`-shaped view first). No second prompt store in Drive config.
5. **Do not name the directory `.claude/`.** That host metaphor is wrong for Cline and confuses adapters. UI copy says “agent home” or “Driveagent.”
6. **Builtin pair partner** may be a read-only synthetic home (`editable: false`) shipped with the product.
7. **Profile UX** projects the home: classifier strip, capabilities, file tree, edit when FS + policy allow. Definition edits while seated mark the seat **stale until reseat** (no mid-turn hot-swap).
8. **Roster click** is not “open home.” It opens [DRV-PARTICIPANT-SHEET](../features/DRV-PARTICIPANT-SHEET.md) (Transcript | Profile). Profile is the projection surface for this home.
9. **Hub ownership.** Home reads/writes that affect seats go through hub ops on `:25463`. Webview never becomes a second writer of room state. Compile may run in `@cline/drive` (pure) with the hub performing FS I/O at the boundary.
10. **Migration.** Existing `.cline/agents/*.yaml` may import into a home once. Dual-authoring forever is a failure mode to extinguish in docs and lint.

## Invariants (binding)

1. No Drive facet file contains `systemPrompt`, `tools`, `skills`, `providerId`, or `modelId`.
2. Slug directories are `[a-z0-9-]+`; display names are free text.
3. UI never says `.claude/` for this product home.
4. Spoken “team” is pack displayName or recruit query text, never a type in this home.

## Consequences

**Positive**

- Clear ownership boundary matching PRD 6 and platform-config overlay rule.
- Portable to drivecode-sdk host adapters later.
- Mirrors BRIEF’s canonical directory discipline.

**Negative**

- Migration path needed from flat `.cline/agents/*.yaml` (import once or compile bridge).
- Two concepts for users briefly: Cline agents vs Driveagent homes (docs must say Driveagent is the authoring home when Drive manages the agent).

## Alternatives considered

- **Facet-only registry** — Rejected; recreates the dual-prompt store platform-config already rejected.
- **`.cline/agents/` only forever** — Insufficient for multi-file knowledge graphs and recruit indexes.
- **`.claude/` directory name** — Rejected; host-specific and misleading under Cline.

## References

- PRD 6: [prd-driveagent-portfolio.md](../prd/prd-driveagent-portfolio.md)
- Platform overlay rule: [06-platform-config.md](../06-platform-config.md)
- BRIEF layout: `briefs/docs/standards/brief/dot-agents-layout.md`
