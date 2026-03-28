# Unit Of Work

## Unit Overview
This decomposition converts the approved architecture into implementation-ready units.  
The units are ordered around the critical path needed to move from provider-centric runtime wiring to an extensible runtime architecture.

## Unit 1: Runtime Contract Foundation
- **Goal**: Establish the core runtime abstraction used by all later units.
- **Primary Responsibilities**:
  - define runtime identity model
  - define runtime registry contract
  - define runtime adapter interface
  - define capability declaration model
  - define migration seam from existing provider-centric selection
- **Primary Outputs**:
  - runtime contract specification
  - runtime registry design
  - adapter interface definition
- **Why This Unit Exists**:
  - every later runtime integration depends on a stable contract
- **Priority**: Critical
- **Execution Order**: 1

## Unit 2: Persistence Boundary and Config Mediation
- **Goal**: Separate runtime state ownership from execution mechanics.
- **Primary Responsibilities**:
  - define ownership of runtime config
  - define credential boundary
  - define capability cache boundary
  - define execution metadata persistence boundary
  - define migration seam for UI, storage, and proto mapping
- **Primary Outputs**:
  - persistence boundary design
  - configuration mediation rules
  - migration impact notes
- **Why This Unit Exists**:
  - runtime extensibility fails quickly if config and credential ownership is unclear
- **Priority**: Critical
- **Execution Order**: 2

## Unit 3: Shim Wrapper and Stream Translation Reference
- **Goal**: Build the reusable runtime execution shell and translation boundary.
- **Primary Responsibilities**:
  - define process invocation abstraction
  - define stdout and stderr normalization
  - define failure normalization contract
  - define translator boundary for runtime-native streams
  - define golden parser fixture strategy
- **Primary Outputs**:
  - shim wrapper design
  - stream translator contract
  - parser fixture strategy
- **Why This Unit Exists**:
  - this is the reusable engine for any external or out-of-process runtime
- **Priority**: Critical
- **Execution Order**: 3

## Unit 4: Claude Code Reference Migration
- **Goal**: Recast current Claude Code integration as the first implementation on the new architecture.
- **Primary Responsibilities**:
  - map current Claude Code flow to runtime adapter model
  - preserve user-facing behavior and settings expectations
  - define regression baseline
  - establish reference example for later runtimes
- **Primary Outputs**:
  - Claude Code migration plan
  - Claude regression matrix
  - compatibility preservation plan
- **Why This Unit Exists**:
  - Claude Code is the baseline runtime and validates the architecture under real usage
- **Priority**: Critical
- **Execution Order**: 4

## Unit 5: Future Runtime Expansion Framework
- **Goal**: Define how future runtimes plug into the architecture after the Claude baseline is stable.
- **Primary Responsibilities**:
  - define Kiro CLI onboarding shape as MVP 2 primary expansion
  - define custom LangGraph CLI onboarding shape as MVP 4 target
  - define `gh` as a todo-grade later candidate
  - define shared capability matrix
  - define spike and verification checklist templates
- **Primary Outputs**:
  - future runtime extension plan
  - runtime capability matrix
  - spike checklist templates
- **Why This Unit Exists**:
  - future runtime onboarding needs a structured path without contaminating the baseline migration unit
- **Priority**: Important
- **Execution Order**: 5

## Unit 6: Test Architecture and TDD Skeleton Framework
- **Goal**: Make testing a first-class architecture concern from the start.
- **Primary Responsibilities**:
  - define adapter contract tests
  - define persistence ownership tests
  - define shim parser golden tests
  - define runtime smoke test strategy
  - define TDD-first skeleton test placement
- **Primary Outputs**:
  - test architecture plan
  - TDD skeleton strategy
  - regression and smoke test map
- **Why This Unit Exists**:
  - approved requirements explicitly require test design at architecture time
- **Priority**: Critical
- **Execution Order**: Parallel support unit

## Code Organization Strategy
- This is a brownfield project, so the focus is not greenfield directory creation.
- Units map to architectural workstreams rather than independent deployables.
- Later construction work should preserve existing project structure and introduce new runtime seams incrementally.

## Readiness Check
- Each unit has a distinct outcome.
- The decomposition preserves a clean critical path.
- The baseline runtime, future runtime strategy, and testing strategy are separated.
