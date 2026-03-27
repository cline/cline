# Change Routing

## Purpose

Use this reference to send each lesson to the right target artifact.

## Route To A Skill

Target:

- `.agents/skills/<skill-name>/SKILL.md`
- `.agents/skills/<skill-name>/references/*`
- `.agents/skills/<skill-name>/scripts/*`
- `.agents/skills/<skill-name>/assets/templates/*`

Use when the lesson is about:

- trigger conditions
- step order
- helper-skill usage
- missing reference material
- missing templates
- repeated manual editing that should be scripted
- recurring architecture patterns that need to shape screen design, testing, or discovery guidance
- repository topology that should be enforced by an existing skill
- naming and placement guardrails for project-owned assets
- runtime ownership contracts across IDE adapters

## Route To A New Skill Proposal

Targets may include:

- `aidlc-docs/meta-knowledge/reviews/*`
- `aidlc-docs/meta-knowledge/improvement-backlog.md`
- `.agents/skills/meta-knowledge/assets/templates/new-skill-proposal.md`

Use when the lesson is about:

- a recurring workflow that does not fit an existing skill cleanly
- a domain or toolchain that needs its own trigger conditions
- repeated growth of one skill that would make it too broad or brittle
- a reusable capability that deserves its own scripts, references, or templates

When this route is selected:

- propose the new skill to the user instead of creating it silently
- explain why existing skills are a poor fit
- describe the expected scope, trigger conditions, and likely resources
- if the user approves creation, hand off to `$skill-creator`

## Route To A Rule

Targets may include:

- `AGENTS.md`
- future `.agents/.aidlc-rule-details/*`

Use when the lesson is about:

- a project-wide operating rule
- audit behavior
- artifact ownership
- stage transition behavior
- approval or validation requirements

## Route To A Project Artifact

Targets may include:

- `aidlc-docs/inception/*`
- `aidlc-docs/discovery/*`
- `aidlc-docs/meta-knowledge/*`

Use when the lesson is about:

- missing requirement coverage
- missing story coverage
- discovery-state drift
- missing meta review history

## Route To Self

Target:

- `.agents/skills/meta-knowledge/*`

Use when the lesson is about:

- how `meta-knowledge` gathers evidence
- how `meta-knowledge` routes or prioritizes lessons
- missing templates or scripts in `meta-knowledge`

## Task-Backlog Mapping Rule

When writing an execution plan (task list) for any meta-knowledge pass:

1. Each task that resolves an existing backlog item MUST include the backlog ID in parentheses.
2. Tasks that are new work (not linked to any backlog item) MUST be marked `(new)`.

**Format**:
```
- [ ] Task 3.3: Create test-production-separation diagram (resolves TS-07)
- [ ] Task 4.1: Add new validation script (new)
```

**Rationale**: Without explicit mapping, tasks and backlog items use separate namespaces. This rule prevents completion tracking misses like the TS-07 incident where work was done but the backlog item remained unchecked.

## Route To Backlog Only

Use this when:

- the improvement is valid but not urgent
- the current change scope is already full
- the lesson needs more evidence first

Use this especially when:

- a mock-only validation run proved the contract but a credential-backed live rerun still needs to happen later
- an infrastructure blocker should not erase the need for a final live execution pass

## Repository Topology Routing

When the lesson is about project-owned workflow topology:

- route to `workflow-provisioner` when the issue is provisioning shape, runtime links, or standalone project bootstrapping
- route to `skill-creator` when the issue is naming, placement, source-of-truth boundaries, or helper promotion rules
- route to workflow-bundle docs or metadata when the issue is authority wording, bootstrap documentation, or compatibility language
- route to backlog only when the issue is a valid cleanup/refactor candidate but the user has not asked for an actual topology migration

## Architecture Lesson Routing Example

When the lesson is an architecture pattern such as a persistence boundary:

- route it to `screen-interaction-design` if the pattern should change screen specs, data mapping notes, or handoff packets
- route it to `webapp-testing` if the pattern should change readiness gates, fixture strategy, or parity checks
- route it to `aidlc-discovery-sprint` if discovery artifacts should capture boundary assumptions before implementation
- route it to `meta-knowledge` itself if the routing rule was unclear or repeatedly missed

## External-Data Validation Routing

When the lesson is about mock versus live validation for an external-data skill:

- route to project validation docs when the execution procedure, acceptance wording, or evidence expectations need correction
- route to backlog when a credential-backed rerun must happen later and should remain visible until completed
- route to `meta-knowledge` templates or references when the same mock/live gap repeats across multiple skills
- do not mark the skill fully validated if required providers only succeeded through mock or fallback paths

## AIDLC Reinforcement Routing

When the lesson is that baseline AIDLC was too coarse for recurring project work:

- keep Layer1 stable and route the missing behavior into Layer2 skills, references, templates, or workflow metadata
- record the pattern in `knowledge-base.md` so it becomes a named reinforcement rather than chat-only memory
- add a backlog item when the reinforcement is valid but cannot be fully applied in the current pass
- use a meta review artifact when the same reinforcement spans multiple skills or project artifacts

## Shared Data Model Routing

When the lesson is about a shared multi-stage data model:

- route it to `aidlc-docs/construction/backend-foundation/*` when the issue is store responsibility, shared core tables, stage extension boundaries, or vector-index truth boundaries
- route it to `skill-creator` when a numbered stage skill must update the stage catalog, artifact-role contract, or shared data model docs before adding persistence guidance
- route it to `workflow-provisioner` when staged workflow scaffolding or verification should preserve the shared data model source of truth
- route it to backlog only when the schema idea is valid but the user did not ask for actual shared-model design work
