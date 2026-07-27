# Architecture Decision Records (ARD)

**ARD** = Architecture Decision Record (same artifact family as ADR in cursor-drive and harrison-site).

**Status board.** [ARD-0000-status-board.md](ARD-0000-status-board.md) — Accepted / Recommended / Proposed / Open in one place.  
**Leadership defaults.** Treat ARD-0001…0004 as **Recommended** pending Harrison `accept all` | `change: …`.

| ID | Title | Status | Features |
|---|---|---|---|
| [ARD-0000](ARD-0000-status-board.md) | Decision status board | Living | — |
| [ARD-0001](ARD-0001-driveagent-home.md) | `.driveagent/` is the agent home | Recommended | [DRV-DRIVEAGENT-HOME](../features/DRV-DRIVEAGENT-HOME.md), [DRV-PARTICIPANT-SHEET](../features/DRV-PARTICIPANT-SHEET.md) |
| [ARD-0002](ARD-0002-agent-graph-canonical-derived.md) | Canonical knowledge YAML; derived graph projection | Recommended | [DRV-AGENT-GRAPH](../features/DRV-AGENT-GRAPH.md) |
| [ARD-0003](ARD-0003-recruit-and-roster-pack.md) | Recruit ranks agents; RosterPack remains curated seating | Recommended | [DRV-RECRUIT](../features/DRV-RECRUIT.md), [DRV-ROSTER-PACK](../features/DRV-ROSTER-PACK.md) |
| [ARD-0004](ARD-0004-gated-learn-privacy.md) | Gated learn; no transcript dump into agent knowledge | Recommended | [DRV-AGENT-GRAPH](../features/DRV-AGENT-GRAPH.md), [DRV-PRIVACY](../features/DRV-PRIVACY.md) |
| [ARD-0005](ARD-0005-status-hub.md) | Status Hub: SQLite append-only status log in the Cline SDK | Accepted | — (SDK-scope; Drive is first consumer) |

Product requirements: [../prd/prd-driveagent-portfolio.md](../prd/prd-driveagent-portfolio.md).  
Success metrics: [../prd/prd-success-metrics.md](../prd/prd-success-metrics.md).

Example home: [../examples/driveagent-pair-partner/](../examples/driveagent-pair-partner/).

Related DECs: [../decisions/](../decisions/).