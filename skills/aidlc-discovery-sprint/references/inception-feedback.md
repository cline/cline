# Inception Feedback

## Purpose

Use this reference when DISCOVERY work reveals that upstream INCEPTION artifacts are incomplete, inconsistent, or no longer sufficient.

## When Feedback Is Required

Route a finding back into INCEPTION when discovery reveals:

- a missing functional requirement
- a missing non-functional requirement
- missing acceptance criteria
- a user flow that is not represented in stories
- a missing actor or persona concern
- a component or service boundary mismatch
- a dependency or integration assumption that discovery disproves

## Routing Guide

### Update Requirements

Target:

- `aidlc-docs/inception/requirements/requirements.md`

Use when the gap is about:

- missing scope
- missing system behavior
- missing constraint
- missing NFR

### Update User Stories

Target:

- `aidlc-docs/inception/user-stories/stories.md`

Use when the gap is about:

- missing user journey coverage
- acceptance criteria gaps
- missing state behavior from the user's perspective

### Update Application Design

Targets include:

- `aidlc-docs/inception/application-design/components.md`
- `aidlc-docs/inception/application-design/services.md`
- `aidlc-docs/inception/application-design/component-dependency.md`

Use when the gap is about:

- unclear component ownership
- missing service boundaries
- wrong integration assumptions
- missing dependency relationships

## Required Evidence

Every inception feedback note should include:

- the discovery observation
- the current evidence
- the affected user or system behavior
- the target artifact to update
- the proposed update
- whether the issue blocks the next sprint

## Decision Rule

If the discovery finding changes meaning, scope, or acceptance behavior, prefer updating INCEPTION artifacts before treating the issue as resolved.
