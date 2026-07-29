# 05 · Alignment with Driveagent homes

Back to [README](README.md).  
**Purpose.** Reconcile the meta-harness (`drivecode-sdk` role = `@cline/drive`) with ARD-0001 / DEC-agent-source-of-truth so implementers do not treat “no Drive-owned agent definition” as blocking homes.

## The apparent conflict

`01-problem-and-scope.md` listed Drive-owned agent definitions as out of scope, echoing an older vision non-goal. PRD 6 and ARD-0001 then introduced `.driveagent/<slug>/` as the authoring home.

## Resolution

These are compatible when layered correctly:

| Layer | Owns | Does not own |
|---|---|---|
| `.driveagent/<slug>/` | Canonical authoring (identity, permissions, env, knowledge) | Live room state |
| `@cline/drive` | Compile to host-shaped view; recruit index over compiled graphs; policies | FS writes, hub broadcast |
| Host (`DriveHostPort` / hub) | FS I/O, seat commits, single-writer room state | Second prompt store |
| `AgentProfile` facets | Appearance overlay + refs | Prompts/tools/models |

**Harness proposes compile/recruit/seat intents. Host commits. Apps project.**

## Amendments to earlier SDK wording

Interpret permanent out-of-scope “Drive-owned agent definition format” as:

> Drive call facets and profiles do not become a prompt/tool registry. Authoring homes are allowed; they compile into the host runtime through the harness/host port.

Update checklists and conformance:

1. Capability descriptor may declare `agentHomeCompile` and `recruitLexical`.
2. fakeHost tests: declaring compile and returning unvalidated prompts fails closed if schema invariants break.
3. Conformance ensures hosts cannot seat from facet-embedded prompts.

## Relationship to package decision

[DEC-package-location](../cline-drivemode/decisions/DEC-package-location.md) keeps this in-monorepo as `@cline/drive`. Homes do not justify a separate repo.

## Reading order

1. DEC-agent-source-of-truth  
2. ARD-0001 / ARD-0002  
3. `02-architecture.md` host port  
4. This file  
5. `cline-drivemode/schemas/README.md`
