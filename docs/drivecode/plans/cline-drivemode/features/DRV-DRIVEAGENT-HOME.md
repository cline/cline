# DRV-DRIVEAGENT-HOME · `.driveagent/<slug>/` agent home

Back to [README](../README.md). Phase 1+ in [TASK-GRAPH](../TASK-GRAPH.md). Product: [PRD 6](../prd/prd-driveagent-portfolio.md). Decision: [ARD-0001](../ard/ARD-0001-driveagent-home.md).

## Problem / user value

An agent on a Drive call needs more than a tinted name. Users need a durable **home** for capabilities, permissions, env, and knowledge files they can inspect from the profile sheet. Cline’s flat `.cline/agents/*.yaml` is not enough for multi-file portfolios. Naming the home `.claude/` would lie about the host. `.driveagent/<slug>/` is the product-owned home.

## Acceptance criteria

- Layout (workspace tier; user tier optional under `~/.driveagent/<slug>/`):

```text
.driveagent/<slug>/
  agent.yaml
  permissions.yaml
  env.yaml
  knowledge/          # owned with DRV-AGENT-GRAPH
  .derived/           # machine outputs only
```

- `agent.yaml` carries identity fields needed to compile a host runtime view: description, tools, skill refs, optional provider/model, maxIterations, prompt body or `promptPath`. Schema-validated.
- `permissions.yaml` carries preset **intent** and approval hooks. Effective preset still goes through `capPreset()` at seat time.
- `env.yaml` allows plain values and `secretRef` entries. Plaintext secrets in committed files fail lint.
- Loader resolves workspace then user (document first-match vs merge in schema README; default first-match-by-slug like ConfiguredAgent names).
- Compile projects home → Cline-executable view (ConfiguredAgent-shaped). Drive facets never store `systemPrompt` / tools / skills / model ([DRV-AGENT-PROFILE](DRV-AGENT-PROFILE.md) assertion remains).
- `AgentProfile.ref` supports `{ kind: "driveagent", slug }` and `{ kind: "builtin", id }`. Legacy `{ kind: "configured", name }` is migration-only.
- Hub ops: `drive_agent_home_get`, `drive_agent_home_open_path` (editor), optional write paths gated by FS + `agent.definition.write`.
- Seated definition is bound at seat time. Home edits mark seat **stale** until reseat; appearance still live-repaints.
- Builtin pair partner may be synthetic read-only (`editable: false`).

## Dependencies

- [DRV-PLATFORM-CONFIG](DRV-PLATFORM-CONFIG.md), [DRV-AGENT-PROFILE](DRV-AGENT-PROFILE.md), [DRV-PARTICIPANT-SHEET](DRV-PARTICIPANT-SHEET.md) for UI. [DRV-AGENT-GRAPH](DRV-AGENT-GRAPH.md) for `knowledge/`.

## Surfaces touched

- `sdk/packages/shared/src/drive/home/` (schemas)
- `sdk/packages/drive/src/home/` (resolve + compile, pure)
- `sdk/packages/core/src/hub/drive-home/` (ops, FS boundary)
- `apps/cline-hub/src/webview/src/drive/` (Files section)

## Agent tasks

- [ ] Land home schemas + no-secret-in-env lint + round-trip fixtures.
  - Owner package: `@cline/shared`
  - Verify: `bun -F @cline/shared test`
- [ ] Pure compile to ConfiguredAgent-shaped view; unknown slug → `unknown_agent`.
  - Owner package: `@cline/drive`
  - Verify: `bun -F @cline/drive test`
- [ ] Hub get/open ops; stale seat on definition change.
  - Owner package: `@cline/core`
  - Verify: `bun -F @cline/core test:unit`
- [ ] Optional import bridge from `.cline/agents/*.yaml` into a new home (one-shot CLI or op).
  - Owner package: `@cline/core` or CLI
  - Done when: import creates slug home without deleting the YAML until user confirms.

## Risks

- Dual homes (`.cline/agents` + `.driveagent`) forever. Mitigation. Import bridge; docs say Drive-managed agents author in `.driveagent/`.
- Compile drift. Mitigation. Bound definition at seat; reseat to apply.
