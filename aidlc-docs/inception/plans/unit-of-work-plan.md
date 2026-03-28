# Unit Of Work Plan

- [x] Analyze approved requirements and application design for decomposition boundaries
- [x] Select decomposition approach for the runtime extensibility program
- [x] Generate `aidlc-docs/inception/application-design/unit-of-work.md` with unit definitions and responsibilities
- [x] Generate `aidlc-docs/inception/application-design/unit-of-work-dependency.md` with dependency matrix
- [x] Generate `aidlc-docs/inception/application-design/unit-of-work-story-map.md` mapping requirements and MVP stages to units
- [x] Validate unit boundaries and dependencies
- [x] Ensure all approved MVP stages and test-planning responsibilities are assigned to units

## Decomposition Approach
- Use **architecture-first implementation units** rather than user-story grouping.
- Each unit should be independently designable and later buildable.
- Units should minimize cross-cutting overlap while preserving a clear critical path.

## Proposed Unit Boundaries

### Unit 1: Runtime Contract Foundation
- Scope:
  - runtime identity model
  - runtime registry
  - runtime adapter contract
  - capability model
  - compatibility and migration seam for existing provider-centric code
- Why first:
  - all later runtime integrations depend on this contract

### Unit 2: Persistence Boundary and Config Mediation
- Scope:
  - runtime configuration ownership
  - credential access boundary
  - capability cache ownership
  - execution metadata persistence rules
  - UI/proto/storage mapping seam
- Why separate:
  - it is the primary state boundary and security-sensitive area

### Unit 3: Shim Wrapper and Stream Translation Reference
- Scope:
  - process invocation abstraction
  - stdout/stderr normalization
  - failure normalization
  - stream parser and translator boundary
  - golden parser fixtures and contract-test seam
- Why separate:
  - this becomes the reusable runtime integration engine

### Unit 4: Claude Code Reference Migration
- Scope:
  - migrate current Claude Code flow onto the new architecture
  - preserve existing UX and behavior
  - establish regression baseline
- Why separate:
  - this is MVP 1 and the reference implementation for later runtimes

### Unit 5: Future Runtime Expansion Framework
- Scope:
  - Kiro CLI onboarding shape
  - `gh` onboarding shape
  - custom LangGraph CLI onboarding shape
  - runtime capability matrix
  - spike checklist templates
- Why separate:
  - this unit captures the forward extensibility model for Kiro, custom LangGraph CLI, and later runtime candidates without prematurely coupling them to the Claude baseline migration

### Unit 6: Test Architecture and TDD Skeleton Framework
- Scope:
  - adapter contract tests
  - shim parser golden tests
  - persistence boundary ownership tests
  - runtime smoke test design
  - TDD-first skeleton code strategy
- Why separate:
  - testing is a first-class workstream in the approved requirements

## Dependency Decisions
- Unit 1 must come first.
- Unit 2 depends on Unit 1.
- Unit 3 depends on Unit 1 and coordinates closely with Unit 2.
- Unit 4 depends on Units 1, 2, and 3.
- Unit 5 depends on Unit 1 and should reference constraints from Units 2 and 3, while treating Kiro as MVP 2 primary expansion target, custom LangGraph CLI as retained future runtime target, and `gh` as a todo-grade later candidate.
- Unit 6 runs in parallel with Units 1 through 6, but its final contract fixtures depend on Unit 1, its Claude regression framework depends on Unit 4, and its future-runtime smoke seams depend on Unit 5.

## Validation Criteria
- Each unit has a distinct architectural purpose.
- Claude Code remains the reference runtime for regression containment.
- Kiro CLI remains inside the Future Runtime Expansion Framework as the MVP 2 primary expansion target.
- custom LangGraph CLI remains an explicit future runtime target.
- `gh` is treated as a todo-grade later candidate rather than a first expansion driver.
- Future runtime onboarding stays outside Unit 4 to avoid mixing baseline migration with future expansion.
- Test design remains explicit rather than implicit inside implementation units.

## Planning Questions
- No additional clarification questions are required.
- Requirements, workflow planning, and application design already resolved the decomposition ambiguities.
