# Unit Of Work Dependency

## Dependency Matrix

| Unit | Depends On | Dependency Type | Reason |
|---|---|---|---|
| Unit 1: Runtime Contract Foundation | None | Root | Defines the shared contract |
| Unit 2: Persistence Boundary and Config Mediation | Unit 1 | Hard | Needs stable runtime identity and adapter contract |
| Unit 3: Shim Wrapper and Stream Translation Reference | Unit 1, Unit 2 | Hard + Coordination | Needs runtime contract and persistence-aware execution boundaries |
| Unit 4: Claude Code Reference Migration | Unit 1, Unit 2, Unit 3 | Hard | Needs contract, persistence, and shim/translation seams |
| Unit 5: Future Runtime Expansion Framework | Unit 1, Unit 2, Unit 3 | Hard + Reference | Needs the architecture to be shaped before onboarding new runtimes |
| Unit 6: Test Architecture and TDD Skeleton Framework | Unit 1, Unit 4, Unit 5 | Parallel + Hard checkpoints | Needs contract fixtures from Unit 1 and regression/smoke anchors from Units 4 and 5 |

## Dependency Narrative

### Critical Path
1. Unit 1
2. Unit 2
3. Unit 3
4. Unit 4
5. Unit 5

### Parallel Support Path
- Unit 6 begins as soon as Unit 1 is stable enough to define contract fixtures.
- Unit 6 deepens once Unit 4 and Unit 5 define runtime-specific regression and smoke-test seams.

## Integration Coordination Points
- **Contract coordination**:
  - Unit 1 with Units 2, 3, 4, 5, 6
- **Persistence coordination**:
  - Unit 2 with Units 3 and 4
- **Execution pipeline coordination**:
  - Unit 3 with Unit 4 and Unit 5
- **Regression coordination**:
  - Unit 4 with Unit 6
- **Future runtime coordination**:
  - Unit 5 with Unit 6

## Change Priority Mapping
- **Critical**:
  - Unit 1
  - Unit 2
  - Unit 3
  - Unit 4
- **Important**:
  - Unit 5
  - Unit 6

## Sequencing Guidance
- Do not start runtime-specific implementation design before Unit 1 is approved.
- Do not start Claude migration design before Unit 3 defines the shim and translator seams.
- Do not finalize Kiro or LangGraph onboarding design before Unit 5 inherits constraints from Units 1 through 3.
- Do not finalize regression and smoke-test scope before Units 4 and 5 stabilize the baseline and future-runtime targets.
