# DRV-SDLC-GUIDE · Senior engineering leadership on the call

Back to [README](../README.md). Phase 1 (persona + discovery loop) / Phase 2 (decision + coverage artifacts on stage) in [TASK-GRAPH](../TASK-GRAPH.md).  
Owns workflows **W-40 through W-45** (Group I · SDLC and requirements leadership).

## Problem / user value

Drive’s pair partner is supposed to feel like a **senior engineer**, not only a fast coder. People with less product or architecture experience need guidance through effective SDLC moves: frame the problem, gather requirements, force decisions, map workflows to coverage, freeze a phase entry gate, and teach *why* while work happens.

Without a named feature, that behavior stays accidental persona prose. With it, the room has explicit triggers, stage artifacts, and acceptance criteria for leadership guidance — the same discipline we use in planning docs, practiced live in the call.

## What this is not

| Not this | Why |
|---|---|
| A waterfall ceremony or mandatory wizard | Vision forbids lobby/setup theater; guidance is on-demand |
| A second planning product outside the room | Artifacts project on the **stage** and into handoff; hub stays single writer |
| Auto-starting a “process” on every join | Silence remains default; human asks or partner offers once when stuck |
| Replacing DRV-GATES / DRV-ADR | Those own approval and decision-record *plumbing*; this owns the *human coaching loop* |

## Decision defaults

| Topic | Default |
|---|---|
| Entry | Explicit phrases / mode (“let’s gather requirements”, “help me decide”) or partner offers **once** when the human is stuck without a problem statement |
| Artifacts | Structured stage cards: Problem, Constraints, Requirements (MoSCoW), Options, Decision, Open questions, Phase entry checklist, Coverage gaps |
| Tone | Teach while doing — explain tradeoffs in senior-engineer language; no jargon dump without a worked example |
| Persistence | Session-tier by default; durable only via explicit export / handoff / accepted learn (ARD-0004) |
| Skill home | Drive-conditional skill(s) under DRV-SKILL-PORT family; capability nodes on tech-lead Driveagent homes optional |

## Acceptance criteria

- Trigger phrases (and mode-pill affordance if present) enter an SDLC-guidance sub-loop without leaving the room.
- Partner produces staged artifacts in order appropriate to the ask: problem → constraints/non-goals → requirements → options → recommended decision → open questions → next verifiable slice.
- Requirements are typed as Must / Should / Could / Won’t (or equivalent MoSCoW) with at least one explicit non-goal.
- Architecture decisions show ≥2 real options, a recommendation, and consequences — never a single hidden choice.
- Workflow/coverage mapping names concrete workflow IDs or admits UNMAPPED/GAP (same honesty as [05-workflows.md](../05-workflows.md)).
- Phase entry / “ready to build” output is a checklist of decisions and invariants, not a calendar.
- Teaching moments narrate *why* a constraint exists (hub single-writer, privacy, RosterPack≠Team, compile-not-fork) when relevant to the task.
- Less-experienced user path: partner asks clarifying questions before coding when the problem is underspecified; does not silently invent scope.
- Artifacts remain privacy-strict; no transcript dump into `.driveagent` knowledge.
- Unit/smoke: phrase table classifies guidance intents; a fixture call produces a Problem + Constraints + Open questions stage set without writing durable memory.

## Dependencies

- DRV-SKILL-PORT (persona + phrase tables), DRV-NARRATION, DRV-STAGE, DRV-EVENTS, DRV-KERNEL (sub-mode / revise), DRV-PRIVACY.
- Soft: DRV-DRIVEAGENT-HOME / graph capability `sdlc-guidance` for recruitable tech-lead agents (Phase 2).
- Related docs: [LEADERSHIP-BRIEF.md](../LEADERSHIP-BRIEF.md), [ard/ARD-0000-status-board.md](../ard/ARD-0000-status-board.md).

## Surfaces touched

- Drive skills / rules (guidance playbook)
- `@cline/drive` intent table + optional guidance policy helpers
- Stage card event types (or reuse decision/plan events with guidance tags)
- Hub webview stage + feed narration
- Example Driveagent capability nodes (optional)

## Agent tasks

- [ ] Author the SDLC guidance skill (discovery, decision facilitation, coverage mapping, phase-entry freeze, teach-while-doing).
  - Owner package: repo skills + `@cline/drive` phrase table
  - Verify: live Drive session; cold reader can follow a requirements call without reading this file
  - Done when: W-40 and W-41 happy paths complete in smoke notes
- [ ] Define stage artifact event shapes (problem, constraint, requirement, option, decision, open_question, checklist, coverage_gap).
  - Owner package: `@cline/shared` / `@cline/drive`
  - Verify: schema tests; stage projection renders cards
- [ ] Wire triggers into mode-intent / guidance-intent table (Tier 0 regex first).
  - Owner package: `@cline/drive`
  - Verify: `bun -F @cline/drive test`
- [ ] Add example capability nodes on pair-partner or tech-lead home (`cap-requirements`, `cap-architecture-decision`).
  - Owner package: examples + DRV-AGENT-GRAPH
  - Verify: compile fixture; recruit lexical can match “requirements” / “architecture decision”
- [ ] Extend handoff (W-05 / W-32) to include guidance artifacts when present.
  - Owner package: `@cline/drive` handoff assembly
  - Verify: handoff fixture includes decisions + open questions

## Risks

- Guidance becomes a lecture that blocks joining/coding. Mitigation: on-demand; one offer when stuck; Instant Join unchanged.
- Artifacts become bureaucracy. Mitigation: small card set; MoSCoW required only in W-41; escape hatch “just implement X” returns to W-08.
- Persona fights Cline system prompt. Mitigation: same incremental port discipline as DRV-SKILL-PORT.
