# Artifact Contract

## Input Artifacts

| Artifact | Source | Required | Usage |
|----------|--------|----------|-------|
| User stories (stories.md) | INCEPTION | Yes | Extract screens, states, acceptance criteria |
| Personas (personas.md) | INCEPTION | Recommended | Identify primary actors per screen |
| Requirements (requirements.md) | INCEPTION | Recommended | Functional/non-functional constraints |
| frontend-components.md | CONSTRUCTION | Recommended | Component definitions and hierarchy |
| business-logic-model.md | CONSTRUCTION | Recommended | Backend workflow steps that imply UI |
| domain-entities.md | CONSTRUCTION | Optional | Data shapes for mock data in prototypes |
| API definitions / route contracts | INCEPTION / DISCOVERY / CONSTRUCTION | Recommended | Record source-of-truth interface for UI mapping |
| business-rules.md | CONSTRUCTION | Optional | Validation rules and error conditions |
| nfr-requirements.md | CONSTRUCTION | Optional | Performance targets, security constraints |
| Brand story, CI design | DISCOVERY | Optional | Visual direction for prototypes |
| Layout structure | DISCOVERY | Optional | Page layout framework |

## Output Artifacts

### Directory Structure

```
aidlc-docs/discovery/screen-design/
├── screen-inventory.md
├── screen-story-map.md
├── gap-report.md
└── screens/
    └── {screen-name}/
        ├── prototype.html
        ├── interaction-flow.md
        └── screenshots/
            ├── desktop-{state}.png
            └── mobile-{state}.png
```

### screen-inventory.md

Complete list of all application screens with their states and metadata.

```markdown
# Screen Inventory

| ID | Screen Name | Route | Actor | Stories | States | Priority |
|----|-------------|-------|-------|---------|--------|----------|
| SCR-001 | Access Page | /access | All | US-1.1, 1.2 | initial, input, loading, pairing-wait, error, rate-limited | MVP |
```

### screen-story-map.md

Bidirectional mapping between screens and user stories.

```markdown
# Screen-Story Traceability Map

## Screen → Story

| Screen | Stories Covered | ACs Covered |
|--------|----------------|-------------|
| Access Page | US-1.1 (all), US-1.2 (AC1, AC2) | 8/10 |

## Story → Screen

| Story | Screens | Coverage |
|-------|---------|----------|
| US-1.1 | Access Page, Pairing Wait | Full |
```

### gap-report.md

Analysis of coverage gaps.

```markdown
# Gap Report

## Uncovered Stories
- US-X.X: [reason no screen exists]

## Partial Coverage
- US-X.X AC3: [which AC lacks UI representation]

## Recommendations
- [actionable next steps]
```

### prototype.html

Self-contained HTML file for one screen. Requirements:

- Single file with embedded CSS and JavaScript
- No external dependencies (except CDN fonts/icons)
- State switcher to toggle between all screen states
- Responsive: desktop (1280px+) and mobile (375px)
- Mock data representative of real application data
- Interactive: form inputs, buttons, hover states functional

### interaction-flow.md

Step-by-step interaction documentation for one screen.

```markdown
# [Screen Name] Interaction Flow

## Screen Specification
- **Route**: /path
- **Primary Actor**: [Persona]
- **Decision Question**: [which decision the actor makes here]
- **Entry Points**: [how users arrive]
- **Exit Points**: [where users go next]
- **Components**: [component tree]
- **Data Requirements**: [API endpoints needed]
- **Persistence Boundary Note**: [where this screen gets data and what can change safely]
- **Adapter Mode**: [demo/mock | api-backed mock | live]
- **Source-of-Truth Data Shape**: [canonical API or DTO]
- **Demo Dataset / Seed Strategy**: [if mock-backed]
- **Contract Preservation Rule**: [selectors, states, and actions that must survive adapter replacement]

## States
| State | Trigger | Visual Description |
|-------|---------|-------------------|
| initial | Page load | [description] |

## Happy Path Flow
1. User arrives → System shows [state]
2. User [action] → System [response]

## Error Flows
### [Error Scenario Name]
1. User [action] → System detects [condition]
2. System shows [error state]
3. User can [recovery action]

## Cross-Screen Flows
[Mermaid diagram]

## Acceptance Criteria Coverage
| AC | Flow Step | Verified |
|----|-----------|----------|
| US-X.X AC1 | Step 2 | Yes |
```
