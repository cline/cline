# Helper Skills

## Purpose

`aidlc-discovery-sprint` relies on baseline skills for specialized tasks. This file defines which helper skill to use and when.

## Primary Helper Skills

### `skill-installer`

Use when a required helper skill is not installed yet.

Typical use:

- initial bootstrap
- missing helper skill detection

### `playwright-interactive`

Use for exploratory browser work.

Typical use:

- review current routes
- inspect navigation gaps
- inspect unfinished layouts
- inspect empty, loading, and error states
- compare actual UI against discovery documents

### `screenshot`

Use to preserve visual evidence.

Typical use:

- pre-sprint baseline capture
- post-change comparison
- stakeholder review evidence
- artifact evidence for audit or sprint review

### `playwright`

Use for repeatable validation.

Typical use:

- sprint-end regression checks
- acceptance verification for the current discovery scope
- confirmation that changed screens still load and navigate

### `figma`

Use only when Figma is the active design source of truth.

Typical use:

- extract frame structure
- compare repo state with approved design
- resolve uncertainty when repo docs are incomplete

### `figma-implement-design`

Use only after a discovery decision is approved for code-oriented implementation follow-up.

Typical use:

- generate implementation-aligned follow-up tasks
- convert approved design changes into implementation steps

### `screen-interaction-design`

Use when the sprint needs detailed screen specifications, self-contained HTML prototypes, or step-by-step interaction flow documents. This skill is optional — invoke only when the sprint scope explicitly includes screen design work.

Typical use:

- generate screen inventory from user stories and functional design
- produce self-contained HTML prototypes with state switchers
- document interaction flows with happy path, error flows, and cross-screen journeys
- map screens to user stories and produce gap reports

Output artifacts (written to `aidlc-docs/discovery/screen-design/`):

- `screen-inventory.md`
- `prototypes/{screen-id}.html`
- `interaction-flows/{screen-id}-flow.md`
- `screen-story-matrix.md`

## Recommended Sequences

### Sprint 0 Without Figma

1. `playwright-interactive`
2. `screenshot`
3. update DISCOVERY artifacts
4. `playwright`

### Sprint 0 With Figma

1. `figma`
2. `playwright-interactive`
3. `screenshot`
4. update DISCOVERY artifacts
5. `playwright`

### Discovery Refinement With Approved Implementation Follow-Up

1. `playwright-interactive`
2. `screenshot`
3. update DISCOVERY artifacts
4. `figma-implement-design`
5. `playwright`

### Sprint With Screen Interaction Design

1. `playwright-interactive`
2. `screenshot`
3. `screen-interaction-design` (produces prototypes and interaction flows)
4. update DISCOVERY artifacts
5. `playwright` (validate prototypes in browser)

### Sprint With Screen Interaction Design And Figma

1. `figma`
2. `playwright-interactive`
3. `screenshot`
4. `screen-interaction-design` (produces prototypes and interaction flows)
5. update DISCOVERY artifacts
6. `playwright` (validate prototypes in browser)

## Escalation Rule

Do not pull in extra helper skills unless they solve a concrete stage need. Keep the sequence minimal.

## Related Custom Skill

After the sprint review, use `$meta-knowledge` when the sprint exposes reusable process lessons that should improve skills, rules, templates, or scripts.
