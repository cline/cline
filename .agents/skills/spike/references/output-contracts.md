# Spike Output Contracts

## Purpose

This reference keeps spike work durable and auditable.

## Required Artifact Set

### Planning Artifacts

Use `aidlc-docs/inception/plans/` for:
- spike backlog or spike brief
- execution plan with ordering and checkboxes
- follow-up plan when a spike is conditional

### Durable Decision Artifacts

Use `aidlc-docs/inception/application-design/` for:
- per-spike validation notes
- contract updates that became durable architecture truth
- end-to-end control-flow validation
- readiness decision inputs

### State And Audit

Always update:
- `aidlc-docs/audit.md`
- `aidlc-docs/aidlc-state.md`

## Minimum Content For A Spike Brief

Each planned spike should name:
- purpose
- question
- why now
- dependencies
- validation mode
- expected deliverables
- completion gate

## Minimum Content For A Decision Note

Each completed spike should record:
- purpose
- live validation evidence or explicit limitation
- observed facts
- architecture interpretation
- decision
- residual risks
- next step

## Readiness Decision Outcomes

Use one of these exact outcomes:
- `Ready for CONSTRUCTION`
- `Conditionally Ready with bounded follow-ups`
- `CONSTRUCTION Deferred`

## Validation Hierarchy

Prefer evidence in this order:

1. live checks against the actual runtime or API
2. direct local inspection
3. official primary-source documentation
4. explicit inference from the above

If the spike closes using inference rather than live validation, say so directly and leave a bounded follow-up.

## Meta-Handoff Rule

If a spike sequence becomes a reusable method:
- update `aidlc-docs/meta-knowledge/knowledge-base.md`
- update `aidlc-docs/meta-knowledge/improvement-backlog.md`
- create or update a meta review
- propose or refine a skill when the pattern now deserves its own trigger
