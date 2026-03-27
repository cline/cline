# Evidence Sources

## Purpose

Use this reference to decide which evidence is strong enough to justify a skill or rule improvement.

## Primary Sources

### Audit History

Look at:

- `aidlc-docs/audit.md`

Useful for:

- repeated user corrections
- repeated AI omissions
- stage drift
- friction caused by current workflow rules

### Sprint Reviews

Look at:

- `aidlc-docs/discovery/**/sprint-review.md`
- other project review notes

Useful for:

- lessons that recur across sprint boundaries
- workflow bottlenecks
- missing handoff artifacts

### Validation Summaries

Look at:

- Playwright summaries
- test failure summaries
- blocked execution notes

Useful for:

- repeated validation gaps
- missing test expectations
- missing completion gates
- distinguishing contract validation from live external-data completion
- detecting mock-only runs that still require credential-backed reruns
- preserving host-owned validation blockers as reusable evidence instead of one-off operator notes

### User Corrections

Look at:

- direct prompts where the user changes process expectations
- requests that refine how a skill should behave

Useful for:

- tightening trigger conditions
- adding missing workflow stages
- correcting assumptions
- detecting standalone-workflow expectations or global contamination concerns

### Topology And Runtime Signals

Look at:

- path migration work and directory rename requests
- bootstrap dry-run / actual-run output
- cross-IDE runtime drift such as copied skill trees or broken symlinks
- cases where framework- or tool-branded directory names caused confusion

Useful for:

- finding duplicate sources of truth
- identifying canonical namespace problems
- routing naming-and-placement lessons to the right skill
- distinguishing project-owned assets from thin runtime adapters

### Shared Data Model Signals

Look at:

- shared data model docs under `aidlc-docs/construction/backend-foundation/functional-design/`
- stage skill output contracts and handoff docs
- cases where each numbered stage starts inventing its own core run/artifact/evidence tables
- cases where PostgreSQL vector storage starts drifting into business-truth storage

Useful for:

- deciding whether a new persistence concern belongs in shared core tables or a stage extension table
- detecting schema drift between host-integrated workflows and stage-specific docs
- preserving Oracle truth versus PostgreSQL retrieval-index boundaries
- routing data-model governance lessons to `meta-knowledge`, `skill-creator`, and `workflow-provisioner`

### AIDLC Reinforcement Signals

Look at:

- repeated cases where baseline AIDLC alone was not enough to complete real project work
- evidence that progress depended on new Layer2 skills, templates, topology rules, or host-owned validation assets
- audit slices where the same gap kept resurfacing until it was turned into a reusable project-local workflow asset

Useful for:

- deciding whether a friction point is really a durable reinforcement pattern
- keeping Layer1 stable while still recording necessary workflow evolution
- routing "foundation too coarse" lessons into Layer2 skills, templates, metadata, and backlog items

### Existing Skill And Rule Files

Look at:

- `.agents/skills/*/SKILL.md`
- `.agents/skills/*/references/*`
- `AGENTS.md`
- `.agents/.aidlc-rule-details/*`

Useful for:

- finding outdated instructions
- finding duplication
- locating the real change target

## Evidence Ranking

Prefer evidence in this order:

1. repeated behavior across multiple interactions
2. explicit user correction
3. documented sprint finding with supporting artifacts
4. a single observed friction point with clear leverage
5. intuition only

Do not treat intuition-only evidence as enough for major rule changes.
