# Architecture Decision Records (ARD)

**ARD** = Architecture Decision Record (same artifact family as ADR in cursor-drive and harrison-site).

**Status board.** [ARD-0000-status-board.md](ARD-0000-status-board.md) — Accepted / Recommended / Proposed / Open in one place.  
**Acceptance.** 2026-07-29 human `accept all`: ARD-0000…0013 + DEC bundle. ARD-0014 (Chat-fork lifecycle) landed Accepted on `main` the same day and is indexed here.

| ID | Title | Status | Features |
|---|---|---|---|
| [ARD-0000](ARD-0000-status-board.md) | Decision status board | Living | — |
| [ARD-0001](ARD-0001-driveagent-home.md) | `.driveagent/` is the agent home | Accepted | [DRV-DRIVEAGENT-HOME](../features/DRV-DRIVEAGENT-HOME.md), [DRV-PARTICIPANT-SHEET](../features/DRV-PARTICIPANT-SHEET.md) |
| [ARD-0002](ARD-0002-agent-graph-canonical-derived.md) | Canonical knowledge YAML; derived graph projection | Accepted | [DRV-AGENT-GRAPH](../features/DRV-AGENT-GRAPH.md) |
| [ARD-0003](ARD-0003-recruit-and-roster-pack.md) | Recruit ranks agents; RosterPack remains curated seating | Accepted | [DRV-RECRUIT](../features/DRV-RECRUIT.md), [DRV-ROSTER-PACK](../features/DRV-ROSTER-PACK.md) |
| [ARD-0004](ARD-0004-gated-learn-privacy.md) | Gated learn; no transcript dump into agent knowledge | Accepted | [DRV-AGENT-GRAPH](../features/DRV-AGENT-GRAPH.md), [DRV-PRIVACY](../features/DRV-PRIVACY.md) |
| [ARD-0005](ARD-0005-status-hub.md) | Status Hub: SQLite append-only status log in the Cline SDK | Accepted — implemented | — (SDK-scope; Drive is first consumer) |
| [ARD-0006](ARD-0006-pip-partner-companion.md) | PiP Partner is a companion surface, not primary IA | Accepted | [DRV-PIP](../features/DRV-PIP.md) |
| [ARD-0007](ARD-0007-drive-as-cline-mode.md) | Drive is a Cline mode, not a separate product | Accepted | [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md), [DRV-TOGGLE](../features/DRV-TOGGLE.md) |
| [ARD-0008](ARD-0008-task-bank.md) | Task bank is Drive’s execution primitive | Accepted | [DRV-TASK-BANK](../features/DRV-TASK-BANK.md), [DRV-NOWNEXT](../features/DRV-NOWNEXT.md), [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md) |
| [ARD-0009](ARD-0009-runtime-topology-local-cloud.md) | Runtime topology for local and cloud Drive | Accepted | [DRV-MIC](../features/DRV-MIC.md), [DRV-TTS](../features/DRV-TTS.md), [DRV-PRIVACY](../features/DRV-PRIVACY.md) |
| [ARD-0010](ARD-0010-provider-harness-byok.md) | Drive provider harness (BYOK) with OOTB packs | Accepted | [DRV-PLATFORM-CONFIG](../features/DRV-PLATFORM-CONFIG.md), [DRV-MIC](../features/DRV-MIC.md), [DRV-TTS](../features/DRV-TTS.md) |
| [ARD-0011](ARD-0011-demo-share-track.md) | Demo share track (Cursor-like proof on stage) | Accepted | [DRV-DEMO-SHARE](../features/DRV-DEMO-SHARE.md), [DRV-SHARE](../features/DRV-SHARE.md), [DRV-STAGE](../features/DRV-STAGE.md) |
| [ARD-0012](ARD-0012-agent-router.md) | Agent router for multi-agent rooms | Accepted | [DRV-AGENT-ROUTER](../features/DRV-AGENT-ROUTER.md), [DRV-ADDRESS](../features/DRV-ADDRESS.md) |
| [ARD-0013](ARD-0013-state-partition.md) | Three-lane state partition (event log / live room / facets) | Accepted | [DRV-KERNEL](../features/DRV-KERNEL.md) |
| [ARD-0014](ARD-0014-chat-fork-lifecycle.md) | Chat-fork lifecycle (invisible auditable workers) | Accepted | [DRV-CHAT-FORK](../features/DRV-CHAT-FORK.md), [DRV-TRANSCRIPT](../features/DRV-TRANSCRIPT.md), [DRV-PARALLEL-WAVES](../features/DRV-PARALLEL-WAVES.md) |

Product requirements: [../prd/prd-driveagent-portfolio.md](../prd/prd-driveagent-portfolio.md), [../prd/prd-pip-partner.md](../prd/prd-pip-partner.md), [../prd/prd-drive-as-cline-mode.md](../prd/prd-drive-as-cline-mode.md), [../prd/prd-task-bank-drive-loop.md](../prd/prd-task-bank-drive-loop.md).  
Success metrics: [../prd/prd-success-metrics.md](../prd/prd-success-metrics.md).

Example home: [../examples/driveagent-pair-partner/](../examples/driveagent-pair-partner/).

Related DECs: [../decisions/](../decisions/).
