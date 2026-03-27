# Artifact Contracts

## Purpose

This reference defines the minimum artifact set that a DISCOVERY sprint should create or update.

## Canonical Project Artifacts

### AIDLC State

- `aidlc-docs/aidlc-state.md`

### Audit Log

- `aidlc-docs/audit.md`

### Discovery Root

- `aidlc-docs/discovery/`

### Inception Root

- `aidlc-docs/inception/`

## Recommended Sprint Folder Structure

Use this structure for new sprint-specific artifacts:

```text
aidlc-docs/discovery/
└── sprint-{n}/
    ├── sprint-brief.md
    ├── sprint-review.md
    ├── wireframes.md
    ├── playwright-summary.md
    └── inception-feedback.md
```

If the repository already uses a different pattern, preserve existing files and add the missing artifacts instead of rewriting history.

## Minimum Artifact Definitions

### `sprint-brief.md`

Must define:

- sprint goal
- sprint mode
- target screens
- target user flows
- persistence boundary assumptions for target screens when applicable
- explicit checklist for the sprint

### `sprint-review.md`

Must record:

- what changed
- what was validated
- what failed
- what stayed blocked
- persistence boundary status and any adapter-related risks
- next sprint backlog
- candidate lessons for `$meta-knowledge`

### `wireframes.md`

Must show:

- current screen structure
- key interaction regions
- missing states or unresolved areas
- adapter mode / source-of-truth notes when the wireframe depends on mock or swappable data

### `playwright-summary.md`

Must record:

- command or scope used
- result status
- notable failures
- blocked reasons if not executable

### `inception-feedback.md`

Must record:

- the discovery finding
- affected upstream artifact
- proposed change
- whether it blocks the next sprint

## Screen Design Artifacts (Optional)

When `screen-interaction-design` is invoked during a sprint, the following artifacts are produced under `aidlc-docs/discovery/screen-design/`:

```text
aidlc-docs/discovery/screen-design/
├── screen-inventory.md
├── prototypes/
│   └── {screen-id}.html
├── interaction-flows/
│   └── {screen-id}-flow.md
└── screen-story-matrix.md
```

### `screen-inventory.md`

Must define:

- complete list of screens with IDs
- states per screen (initial, loading, populated, empty, error, etc.)
- entry and exit points per screen
- mapping to source user stories
- adapter mode per screen when known
- source-of-truth contract reference when known

### `prototypes/{screen-id}.html`

Must be:

- self-contained single HTML file (embedded CSS/JS, no external dependencies)
- include state switcher bar for toggling between screen states
- responsive with desktop and mobile breakpoints

### `interaction-flows/{screen-id}-flow.md`

Must document:

- happy path flow with step-by-step user actions and system responses
- error flows with trigger conditions and recovery paths
- cross-screen navigation flows with Mermaid diagrams
- acceptance criteria coverage matrix
- persistence boundary notes when the flow crosses a storage or adapter seam

### `screen-story-matrix.md`

Must show:

- screen-to-story mapping table
- coverage status (covered, partial, uncovered)
- gap list with recommended actions

## Non-Destructive Update Rule

Never erase prior sprint history just to fit this structure. Extend the current documentation set and make the delta explicit.
