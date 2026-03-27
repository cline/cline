---
name: spike
description: Run a bounded, evidence-driven technical validation workflow before implementation when a request mentions a spike, PoC, feasibility check, technical validation, de-risking, runtime uncertainty, or proving an architecture/toolchain before CONSTRUCTION. Use this for new-app architecture unknowns, integration risks, security-boundary validation, data-pipeline fit checks, and control-plane/runtime-plane proof work.
---

# Spike

## Overview

Use this skill to turn scattered technical uncertainty into a named `INCEPTION` workflow. The goal is not to build the product yet. The goal is to reduce uncertainty through bounded spikes, durable decision notes, live validation when possible, and a final readiness decision that says whether `CONSTRUCTION` should proceed or stay deferred.

## Start Here

Load these project artifacts first:

1. `aidlc-docs/aidlc-state.md`
2. `aidlc-docs/audit.md`
3. Relevant `aidlc-docs/inception/requirements/`, `aidlc-docs/inception/plans/`, and `aidlc-docs/inception/application-design/` files
4. Existing spike plan docs if they already exist
5. These references:
   - `references/spike-patterns.md`
   - `references/output-contracts.md`

If the spike sequence reveals a reusable process lesson, hand the result to `meta-knowledge` after the final readiness decision.

## When To Use

Use this skill when at least one of these is true:

- the user explicitly says `spike`, `PoC`, `기술검증`, `feasibility`, or `de-risk`
- the team must prove an architecture, runtime, integration, or data-handling assumption before implementation
- multiple technical unknowns are coupled tightly enough that design notes alone are not trustworthy
- the next safe step depends on live contract validation, not just reasoning
- the project needs to decide whether `CONSTRUCTION` should start or remain deferred

Do not use this skill for normal feature implementation, simple bug fixes, or late-stage polish work with no material architecture uncertainty.

## Core Workflow

### 1. Decide Whether A Spike Is Warranted

Start by naming the uncertainty clearly.

Good spike candidates:
- unclear local-to-remote invocation boundaries
- runtime inheritance or sandbox concerns
- protected-data handling and leakage surfaces
- external dependency contracts that need live verification
- data-pipeline or vector-store adoption decisions
- packaging, distribution, or update-plane uncertainty
- end-to-end trust-boundary ambiguity

If the unknown is small, isolated, and can be answered during normal implementation, do not open a formal spike.

### 2. Turn Unknowns Into Bounded Spike Questions

Each spike should answer one primary question.

For every spike, define:
- the exact question
- why it matters now
- the expected artifact
- the validation mode
- the completion gate

If one spike has multiple unrelated questions, split it.

### 3. Sequence The Spikes

Use the sequencing guidance in `references/spike-patterns.md`.

Default order:
1. boundary and invocation questions
2. runtime and harness questions
3. protected data-handling questions
4. dependency or compatibility questions
5. data-pipeline or framework-fit questions
6. packaging and control-plane questions
7. end-to-end control-flow questions
8. readiness decision

Move a spike only when the dependency order truly changes.

### 4. Create Or Update Spike Planning Artifacts

Document the work before executing it.

Use these outputs:
- spike backlog / high-level plan under `aidlc-docs/inception/plans/`
- execution-ready sequence under `aidlc-docs/inception/plans/`
- one durable decision note per completed spike under `aidlc-docs/inception/application-design/`

Use the bundled templates:
- `assets/templates/spike-brief.md`
- `assets/templates/spike-decision.md`

When the spike set is substantial, track it with checkboxes and update them immediately when work is completed.

### 5. Execute The Spike With Evidence

Prefer evidence in this order:
1. live contract validation
2. direct runtime inspection
3. official documentation
4. architecture inference

If live validation is unavailable, say so explicitly and leave a bounded follow-up instead of claiming full closure.

Execution rules:
- keep the spike narrow
- record the exact runtime or API surface tested
- separate observed facts from inferences
- capture residual risks even when the spike passes
- fail closed when the boundary cannot be explained coherently

### 6. Write The Durable Decision

Every completed spike must leave behind a durable design note that answers:
- what was being validated
- what evidence was gathered
- what decision was made
- what remains risky
- what the next spike or next stage is

Plans track execution. Decision notes preserve the architecture truth.

### 7. Update State, Audit, And Next-Step Control

After each spike:
- append the raw user input and action summary to `aidlc-docs/audit.md`
- update the active spike plan checkboxes
- update `aidlc-docs/aidlc-state.md` so the next active spike or readiness decision is explicit

At the end of the sequence, produce a readiness decision with one of these outcomes:
- `Ready for CONSTRUCTION`
- `Conditionally Ready with bounded follow-ups`
- `CONSTRUCTION Deferred`

### 8. Hand Lessons To Meta-Knowledge

If the spike sequence revealed a reusable workflow pattern, route it to `meta-knowledge`.

Typical signals:
- repeated spike types now form a stable method
- a new template or script would save future work
- the team discovered a better order for technical validation
- a new skill boundary is justified

## Completion Gates

Do not finish a spike pass until all applicable items are handled:

- [ ] The technical unknowns were converted into bounded spike questions
- [ ] Spike ordering was justified rather than improvised
- [ ] Planning artifacts were created or updated under `aidlc-docs/inception/plans/`
- [ ] Each completed spike produced one durable decision note under `aidlc-docs/inception/application-design/`
- [ ] Evidence and inference were separated clearly
- [ ] Residual risks were named
- [ ] `aidlc-docs/audit.md` captured the user input and spike result
- [ ] `aidlc-docs/aidlc-state.md` points to the next spike or readiness decision
- [ ] Plan checkboxes were updated in the same pass as the completed work
- [ ] The final output includes a readiness decision or a clearly stated deferral
- [ ] Reusable lessons were handed to `meta-knowledge` when justified

## Notes

- This skill reinforces AIDLC `INCEPTION`; it does not replace it.
- Prefer a small number of sharp spikes over a long list of vague investigations.
- Tool choice should follow boundary clarity, not the other way around.
- A spike can succeed even when the answer is "do not proceed yet," as long as that decision is explicit and evidenced.
