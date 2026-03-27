# [Screen Name] — Screen Specification

## Overview

| Field | Value |
|-------|-------|
| **Screen ID** | SCR-XXX |
| **Route** | /path |
| **Primary Actor** | [Persona name] |
| **Decision Question** | [What decision or judgment happens on this screen?] |
| **Related Stories** | US-X.X, US-X.X |
| **Priority** | MVP / Post-MVP |
| **Adapter Mode** | demo/mock / api-backed mock / live |

## Entry Points

How users arrive at this screen:

- [Source screen/action] → [trigger] → this screen
- Direct URL access: [behavior]

## Exit Points

Where users go from this screen:

- [Action] → [target screen]
- [Action] → [target screen]
- Browser back → [behavior]

## Component Tree

```
[ScreenName]
├── [Header / Navigation context]
├── [MainContent]
│   ├── [ComponentA]
│   │   ├── [SubComponentA1]
│   │   └── [SubComponentA2]
│   └── [ComponentB]
└── [Footer / ActionBar]
```

## Data Requirements

| Data | Source | Refresh |
|------|--------|---------|
| [data item] | [API endpoint or store] | [on-load / polling / event] |

## Persistence Boundary

| Field | Value |
|-------|-------|
| **Persistence Boundary Note** | [How this screen stays insulated from storage or adapter changes] |
| **Source-of-Truth Data Shape** | [Canonical DTO / API contract / domain shape] |
| **Demo Dataset / Seed Strategy** | [Curated mock payload, seed dataset, fixture source, or N/A] |
| **Contract Preservation Rule** | [Selectors, screen states, and actions that must not change when adapter changes] |

## User Permissions

| Permission | Required For |
|------------|-------------|
| [permission] | [which actions/sections] |

## States

| State | Trigger | Description | Visual Changes |
|-------|---------|-------------|----------------|
| initial | Page load | [description] | [what changes visually] |
| loading | Data fetch | [description] | [what changes visually] |
| populated | Data received | [description] | [what changes visually] |
| empty | No data | [description] | [what changes visually] |
| error | API failure | [description] | [what changes visually] |

## Layout

### Desktop (1280px+)

```
+--------------------------------------------------+
|  [Header / Nav]                                   |
+--------------------------------------------------+
|         |                                         |
| [Side]  |  [Main Content Area]                    |
|         |                                         |
|         |  +-----------------------------------+  |
|         |  | [Component A]                     |  |
|         |  +-----------------------------------+  |
|         |                                         |
|         |  +-----------------------------------+  |
|         |  | [Component B]                     |  |
|         |  +-----------------------------------+  |
|         |                                         |
+--------------------------------------------------+
```

### Mobile (375px)

```
+----------------------+
| [Header]             |
+----------------------+
| [Component A]        |
+----------------------+
| [Component B]        |
+----------------------+
| [Footer]             |
+----------------------+
```

## Interaction Notes

- [Any special behavior, animations, or constraints]
- [Keyboard shortcuts if applicable]
- [Accessibility considerations specific to this screen]
- [Selector seeds or test hooks that should remain stable across adapter changes]
