# Unit Of Work Story Map

## Mapping Strategy
- This request is architecture-planning oriented, so the map ties approved requirements and MVP stages to units rather than end-user stories.
- Each unit is linked to the primary requirements, MVP stage, and test obligations it must satisfy.

## Requirement To Unit Mapping

| Requirement / Focus Area | Unit 1 | Unit 2 | Unit 3 | Unit 4 | Unit 5 | Unit 6 |
|---|---|---|---|---|---|---|
| Runtime contract definition | X |  |  |  |  | X |
| Persistence boundary definition |  | X |  |  |  | X |
| Shim wrapper definition |  |  | X |  |  | X |
| Stream translation boundary |  |  | X | X | X | X |
| Claude Code baseline migration |  |  |  | X |  | X |
| Kiro CLI expansion path |  |  |  |  | X | X |
| `gh` todo-grade candidate framing |  |  |  |  | X |  |
| custom LangGraph CLI expansion path |  |  |  |  | X | X |
| Capability matrix and spike checklist | X |  |  |  | X | X |
| TDD-first test planning |  |  |  |  |  | X |

## MVP Stage Mapping

### MVP 1
- **Target**: Claude Code reference migration
- **Primary Units**:
  - Unit 1
  - Unit 2
  - Unit 3
  - Unit 4
  - Unit 6

### MVP 2
- **Target**: Kiro CLI expansion
- **Primary Units**:
  - Unit 5
  - Unit 6
- **Dependency Units**:
  - Units 1 through 3

### MVP 3
- **Target**: `gh` as todo-grade later candidate
- **Primary Units**:
  - Unit 5
- **Notes**:
  - This is documented as a later candidate, not a first implementation driver.

### MVP 4
- **Target**: custom LangGraph CLI out-of-process runtime
- **Primary Units**:
  - Unit 5
  - Unit 6
- **Dependency Units**:
  - Units 1 through 3

## Test Mapping

| Test Type | Unit 1 | Unit 2 | Unit 3 | Unit 4 | Unit 5 | Unit 6 |
|---|---|---|---|---|---|---|
| Adapter contract tests | X |  | X | X | X | X |
| Persistence ownership tests |  | X |  |  |  | X |
| Golden parser tests |  |  | X | X | X | X |
| Claude regression tests |  |  |  | X |  | X |
| Future runtime smoke tests |  |  |  |  | X | X |
| TDD skeleton strategy |  |  |  |  |  | X |

## Coverage Check
- All approved MVP stages are assigned to at least one unit.
- Testing responsibilities are explicitly assigned.
- Claude baseline work is not mixed with future runtime planning.
