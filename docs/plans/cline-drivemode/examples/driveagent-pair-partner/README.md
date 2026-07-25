# Example Driveagent home (pair partner sketch)

Throwaway fixture for docs and future tests. Not a live workspace agent until copied under a real `<workspace>/.driveagent/`.

See [PRD 6](../../prd/prd-driveagent-portfolio.md), [ARD-0001](../../ard/ARD-0001-driveagent-home.md), [ARD-0002](../../ard/ARD-0002-agent-graph-canonical-derived.md).

## Layout

```text
examples/driveagent-pair-partner/
  BRIEF.md                 # what recruit/compile agents may read here
  agent.yaml
  permissions.yaml
  env.yaml
  knowledge/
    catalog.yaml
    nodes/
      cap-pair-programming.yaml
      cap-code-review.yaml
      case-router-race.yaml
    edges.yaml
  .derived/
    graph.json             # illustrative compile output
```
