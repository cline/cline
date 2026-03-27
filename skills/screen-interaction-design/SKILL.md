---
name: screen-interaction-design
description: Design screen specifications and interaction flows for web applications, producing actual HTML prototypes with step-by-step user journey documentation. Use this skill when you need UI screen specifications, interaction flow documents, clickable prototypes, or screen-story traceability for a web application. Trigger when the user mentions "screen design", "screen spec", "interaction flow", "UI prototype", "user flow", "screen inventory", or wants to bridge functional design artifacts to code generation with visual screen layouts. Also trigger for Korean terms like "화면기획", "화면설계", "인터랙션 플로우", "UI 프로토타입", "화면 명세". This skill orchestrates frontend-design (for HTML prototypes), doc-coauthoring (for interaction flow documentation), and webapp-testing (for Playwright validation).
---

# Screen Interaction Design

Design screen specifications and interaction flows that bridge the gap between functional design ("what components exist") and code generation ("actual implementation").

## When To Use

- Functional design artifacts exist but no visual screen specifications
- User stories have acceptance criteria but no step-by-step UI interaction flows
- HTML prototypes are needed before code generation begins
- Screen-to-story traceability mapping is required
- DISCOVERY phase needs structured screen design work

## Start Here

Read `core/workflow.md` for the complete workflow. It is IDE-agnostic and works across Claude Code, Cursor, Cline, and other tools.

## Quick Overview

The workflow has five phases:

1. **Screen Inventory** — analyze input artifacts, list all screens and their states
2. **Screen Design** — generate HTML prototypes per screen (delegate to `frontend-design`)
3. **Interaction Flow** — document step-by-step user journeys (delegate to `doc-coauthoring` pattern)
4. **Validation** — verify prototypes with Playwright (delegate to `webapp-testing`)
5. **Traceability** — map screens to user stories, identify gaps

Across all phases, treat persistence as a boundary, not a page concern. Screen outputs should record the current adapter mode, the source-of-truth shape, the demo dataset strategy, and the contract that must survive a future adapter replacement.

## Input Artifacts

The skill consumes whatever design artifacts exist:

- INCEPTION: user stories, personas, requirements
- CONSTRUCTION: functional design (business-logic-model, frontend-components, domain-entities)
- DISCOVERY foundation: brand story, CI design, layout structure (if available)

## Output Artifacts

All outputs go under `aidlc-docs/discovery/screen-design/`:

```
screen-design/
├── screen-inventory.md
├── screen-story-map.md
├── gap-report.md
└── screens/
    └── {screen-name}/
        ├── prototype.html
        ├── interaction-flow.md
        └── screenshots/
```

See `core/artifact-contract.md` for detailed schemas.

## Helper Skills

| Skill | When | Purpose |
|-------|------|---------|
| `frontend-design` | Phase 2 | Generate production-grade HTML prototypes with bold aesthetic direction |
| `doc-coauthoring` | Phase 3 | Structure interaction flow documents through iterative refinement |
| `webapp-testing` | Phase 4 | Playwright-based prototype validation and screenshot capture |

## Templates

- `core/screen-spec-template.md` — screen specification structure
- `core/interaction-flow-template.md` — interaction flow document structure
- `core/screen-states-checklist.md` — comprehensive screen states to verify
- `assets/prototype-boilerplate.html` — HTML prototype starting point

## Cross-IDE Usage

This skill is designed for cross-IDE compatibility:

- **Claude Code**: Use this SKILL.md directly
- **Cursor**: Copy `adapters/cursor-rule.mdc` to `.cursor/rules/screen-interaction-design.mdc`
- **Cline**: Reference `core/workflow.md` in your Cline rules
- **Kiro**: Reference `core/workflow.md` in your steering documents

The `core/` directory contains all IDE-agnostic workflow content.
