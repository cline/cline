# Code Generation Plan - runtime-contract-foundation

## Plan Status
- [x] Step 1. Analyze unit design artifacts and approved constraints
- [x] Step 2. Read workspace root, brownfield structure, and existing provider selection seams
- [x] Step 3. Identify Unit 1 target stories, dependencies, and interface boundaries
- [x] Step 4. Freeze the executable code-generation sequence for Unit 1
- [x] Step 5. Create shared runtime contract types and identifiers
- [x] Step 6. Create runtime registry and registration validation layer
- [x] Step 7. Create legacy provider mapping and selection mediation helpers
- [x] Step 8. Refactor API handler construction to route through the runtime contract foundation
- [x] Step 9. Add Unit 1 contract and registry unit tests
- [x] Step 10. Add brownfield compatibility tests for existing provider selection behavior
- [x] Step 11. Write code-generation summary documentation for Unit 1
- [x] Step 12. Final verification and duplicate-file check

## Single Source Of Truth
- This document is the single source of truth for Code Generation in Unit 1.
- Application code changes must occur only in workspace-root source paths, never under `aidlc-docs/`.
- Generation must follow the step order in this file without skipping ahead.

## Unit Context
- **Unit**: Unit 1 - Runtime Contract Foundation
- **Goal**: Establish the shared runtime abstraction that later persistence, shim, Claude Code migration, Kiro CLI, `gh`, and custom LangGraph work can build on.
- **Primary stories / requirement focus**:
  - Runtime contract definition
  - Runtime identity resolution
  - Runtime registry contract
  - Runtime adapter definition
  - Capability declaration model
  - Legacy provider-centric migration seam
- **Story-map traceability**:
  - `unit-of-work-story-map.md`: Runtime contract definition, capability matrix foundation
  - `requirements.md`: extensible runtime architecture, persistence boundary preparation, shim-wrapper preparation, TDD-first skeleton requirement

## Dependencies And Interfaces
- **Depends on**: none at runtime; this is the root contract unit.
- **Provides to later units**:
  - canonical runtime ID model
  - additive registration surface
  - compatibility mediation for current `ApiProvider`-based state
  - capability declaration contract for future runtime validation
- **Key brownfield interfaces to preserve**:
  - `src/shared/api.ts` provider typing and shared API config semantics
  - `src/core/api/index.ts` `buildApiHandler()` entry point
  - `src/shared/storage/provider-keys.ts` provider-model-key lookup behavior
  - `src/shared/proto-conversions/models/api-configuration-conversion.ts` provider compatibility expectations
  - CLI state selection paths in `cli/src/agent/ClineAgent.ts` and `cli/src/utils/provider-config.ts`

## Database / Persistence Ownership
- Unit 1 owns no database entities.
- Unit 1 must not move credential storage or persistence ownership. That work belongs to Unit 2.
- Unit 1 may introduce read-only compatibility mapping helpers used by later persistence mediation.

## Code Locations
- **Workspace root**: `/mnt/a2c_data/home/.cline/worktrees/a4561/cline`
- **Primary application targets**:
  - `src/core/api/index.ts`
  - `src/shared/api.ts`
  - `src/shared/storage/provider-keys.ts`
  - `src/shared/proto-conversions/models/api-configuration-conversion.ts`
  - `src/core/api/providers/__tests__/claude-code.test.ts`
- **Planned new application paths**:
  - `src/core/api/runtime/contracts.ts`
  - `src/core/api/runtime/registry.ts`
  - `src/core/api/runtime/legacy-provider-mapping.ts`
  - `src/core/api/runtime/__tests__/registry.test.ts`
  - `src/core/api/runtime/__tests__/legacy-provider-mapping.test.ts`
- **Planned documentation path**:
  - `aidlc-docs/construction/runtime-contract-foundation/code/`

## Execution Steps

### Step 5. Create shared runtime contract types and identifiers
- Scope:
  - introduce canonical runtime identifiers and capability declarations
  - define runtime adapter metadata separate from concrete provider classes
  - keep current `ApiProvider` surface backward-compatible
- Target files:
  - create `src/core/api/runtime/contracts.ts`
  - modify `src/shared/api.ts`
- Expected result:
  - later units can refer to runtime contracts without binding directly to provider switch logic

### Step 6. Create runtime registry and registration validation layer
- Scope:
  - implement additive registration API
  - define runtime definition catalog and validation rules
  - enforce fail-closed behavior for invalid registrations
- Target files:
  - create `src/core/api/runtime/registry.ts`
  - modify `src/core/api/index.ts`
- Expected result:
  - runtime definitions are registered declaratively rather than hardcoded only through a top-level switch

### Step 7. Create legacy provider mapping and selection mediation helpers
- Scope:
  - map existing `ApiProvider` values into canonical runtime IDs
  - preserve current mode/provider selection behavior for brownfield callers
  - isolate migration logic rather than scattering compatibility code
- Target files:
  - create `src/core/api/runtime/legacy-provider-mapping.ts`
  - modify `src/shared/storage/provider-keys.ts`
  - modify `src/shared/proto-conversions/models/api-configuration-conversion.ts`
- Expected result:
  - current state, proto, and provider-key code can resolve through the new runtime foundation without breaking persisted behavior

### Step 8. Refactor API handler construction to route through the runtime contract foundation
- Scope:
  - preserve `buildApiHandler()` as the public entry point
  - move provider resolution toward registry-driven selection
  - keep concrete handler instantiation behavior unchanged where possible
- Target files:
  - modify `src/core/api/index.ts`
- Expected result:
  - Unit 1 ends with a stable foundation while minimizing behavior drift before Unit 4 migrates Claude Code as the reference runtime

### Step 9. Add Unit 1 contract and registry unit tests
- Scope:
  - add TDD-aligned contract tests designed with the architecture
  - validate canonical IDs, registration validation, and capability declaration rules
- Target files:
  - create `src/core/api/runtime/__tests__/registry.test.ts`
- Expected result:
  - Unit 1 has direct coverage for the new contract foundation

### Step 10. Add brownfield compatibility tests for existing provider selection behavior
- Scope:
  - preserve current provider-to-handler resolution for existing supported providers
  - specifically pin Claude Code compatibility because it is the migration baseline
  - cover legacy provider mapping seams
- Target files:
  - create `src/core/api/runtime/__tests__/legacy-provider-mapping.test.ts`
  - modify `src/core/api/providers/__tests__/claude-code.test.ts`
- Expected result:
  - later units can refactor runtime onboarding without regressing current provider behavior

### Step 11. Write code-generation summary documentation for Unit 1
- Scope:
  - summarize contract foundation, changed seams, and test coverage
- Target files:
  - create `aidlc-docs/construction/runtime-contract-foundation/code/code-summary.md`
- Expected result:
  - reviewable markdown summary aligned to the generated code

### Step 12. Final verification and duplicate-file check
- Scope:
  - verify no duplicate brownfield files were created
  - verify all executed plan steps are marked complete
  - verify implementation stayed within Unit 1 boundaries
- Target files:
  - no new target; repository verification only
- Expected result:
  - Unit 1 is ready for review and approval gating

## Test Strategy For This Unit
- **Contract tests**:
  - canonical runtime ID registration
  - duplicate registration rejection
  - invalid capability declarations rejected
- **Compatibility tests**:
  - legacy `ApiProvider` maps to expected runtime definition
  - existing Claude Code resolution remains intact
- **TDD expectation**:
  - tests are created as part of the skeleton/foundation work, not deferred to a later cleanup step

## Out Of Scope
- Persistence ownership, credentials, and capability cache storage changes
- Shim wrapper process execution and stream translation
- Claude Code runtime migration details beyond compatibility preservation
- Kiro CLI, `gh`, and custom LangGraph runtime onboarding
