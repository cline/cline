# Brief

Example Driveagent home for the builtin-style pair partner. Used by humans and by tools that lint or compile portfolio graphs.

## Discovery

1. `agent.yaml`
2. `permissions.yaml`
3. `knowledge/catalog.yaml`
4. `knowledge/edges.yaml`
5. `knowledge/nodes/**`

## Context

- Read full: `agent.yaml`, `permissions.yaml`, `knowledge/catalog.yaml`, `knowledge/edges.yaml`, `BRIEF.md`
- Headings: `knowledge/nodes/**`
- Exclude: `.derived/**`, `env.yaml`, `knowledge/private/**`, `**/*.lock`

## Agents

- graph-compiler: `knowledge/**`, `agent.yaml`
- recruit-indexer: `knowledge/catalog.yaml`, `knowledge/edges.yaml`, `.derived/graph.json`
- profile-ui: `agent.yaml`, `permissions.yaml` (readonly)

## Lifecycle

- privacy: redact env values and private knowledge from handoffs
- checkpoint_on: after compile
