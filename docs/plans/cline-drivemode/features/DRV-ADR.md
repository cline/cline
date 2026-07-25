# DRV-ADR · Architecture decision record

Back to [README](../README.md). Phase 0 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

The Drive effort makes several decisions that future contributors will want to relitigate (kernel package, hub as single writer, events-only screen share, no second daemon, buy-not-build SFU). An ADR makes them durable and reviewable, and gives agents a citable constraint document.

## Acceptance criteria

- One ADR drafted covering, at minimum: `@cline/drive` kernel placement, hub `:25463` as the single writer and only daemon, room-first domain model with Drive tab as primary UX and `joinCall` / Chat Join as façade/shortcut, events-first agent stage (bidirectional sharer pointer; WebRTC later), phased media strategy with buy-not-build SFU, no default second MCP on `:7891`.
- Each decision names the alternatives rejected and the evidence file that grounds it (include [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md) for UX IA).
- ADR status is `proposed` until the human accepts it. Plans do not block on acceptance (work proceeds, the ADR records).

## Dependencies

None. Drafts alongside DRV-EVENTS.

## Surfaces touched

- `docs/adr/` or the repo's existing decision-record location (create `docs/adr/` if absent)

## Agent tasks

- [ ] Locate or create the ADR directory and copy the numbering convention from any existing records.
  - Owner package: repo docs
  - Files likely: `docs/adr/`
  - Verify: file renders in markdown preview without broken links
  - Done when: directory and naming convention are settled.
- [ ] Draft the ADR from [01-architecture.md](../01-architecture.md) decisions D1 through D6, citing [02-research-streaming.md](../02-research-streaming.md) and [04-future-multi-user.md](../04-future-multi-user.md).
  - Owner package: repo docs
  - Files likely: `docs/adr/NNNN-drive-mode-architecture.md`
  - Verify: every decision has a named alternative and a grounding link
  - Done when: ADR exists with status `proposed` and README links it.

## Risks

- ADR drifts from the plan files as phases execute. Mitigation. The phase gates in TASK-GRAPH include a doc-sync check item when a decision changes.
