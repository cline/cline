# Drivecode PRDs (cline-drivemode)

Product requirements for Drivecode features that sit on top of the existing drivemode plan set. Numbered for stable cross-reference from ARDs and feature specs.

| # | File | Focus |
|---|------|--------|
| PRD 6 | [prd-driveagent-portfolio.md](prd-driveagent-portfolio.md) | `.driveagent/` homes, per-agent knowledge graphs, recruit-into-call |

Related plan docs: [06-platform-config.md](../06-platform-config.md), [05-workflows.md](../05-workflows.md), [../README.md](../README.md).

Example agent home: [../examples/driveagent-pair-partner/](../examples/driveagent-pair-partner/).

**ARD** here means Architecture Decision Record (same role as ADR in cursor-drive / harrison-site). See [../ard/](../ard/).

## Lessons imported from `briefs`

The [BRIEF.md](https://github.com/hhalperin/briefs) work informs this area without replacing it:

| BRIEF primitive | Driveagent portfolio analog |
|---|---|
| Three-standard stack (AGENTS / SKILL / BRIEF) | Behavior / capability tools / **portfolio graph + home** |
| Canonical vs `latest/` derived | YAML knowledge source vs compiled `graph.json` |
| Graduated read modes | Retrieve a *slice* of the graph into a turn, not the whole DB |
| Subagent file scoping | Recruit + seat with bound definition + scoped graph context |
| Audit expected vs actual | Log which graph nodes were injected into a turn |
| Lifecycle privacy | No transcript dump into knowledge; gated propose/accept |
| Scope discipline | BRIEF stayed context-only; Driveagent graph stays portfolio/recruit, not a second prompt store |
