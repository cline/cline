# Code Generation Plan - persistence-boundary-and-config-mediation

## Plan Status
- [x] Step 1. Analyze Unit 2 design artifacts, stories, and dependencies
- [x] Step 2. Read workspace root, brownfield structure, and current storage/config seams
- [x] Step 3. Freeze Unit 2 implementation boundaries and migration-safe target paths
- [x] Step 4. Define the executable code-generation sequence for Unit 2
- [x] Step 5. Create runtime-facing persistence domain types and boundary errors
- [x] Step 6. Create runtime migration binding and config resolution helpers
- [x] Step 7. Create credential mediation and capability-cache ownership helpers
- [x] Step 8. Create execution metadata recording helpers and compatibility facade entry points
- [x] Step 9. Integrate Unit 2 boundary services into existing StateManager/config callers without breaking brownfield flows
- [x] Step 10. Add Unit 2 ownership, mapping, and cache tests
- [x] Step 11. Write Unit 2 code summary documentation
- [x] Step 12. Final verification and duplicate-file check

## Single Source Of Truth
- This document is the single source of truth for Code Generation in Unit 2.
- Application code changes must occur only in workspace-root source paths, never under `aidlc-docs/`.
- Generation must follow the step order in this file without skipping ahead.

## Unit Context
- **Unit**: Unit 2 - Persistence Boundary and Config Mediation
- **Goal**: Separate runtime state ownership from execution mechanics and create runtime-aware config/credential/cache/metadata mediation.
- **Primary stories / requirement focus**:
  - persistence boundary definition
  - runtime config ownership
  - credential boundary
  - capability cache boundary
  - execution metadata boundary
  - UI/storage/proto migration seam
- **Story-map traceability**:
  - `unit-of-work-story-map.md`: persistence boundary definition
  - `requirements.md`: FR-02 persistence boundary, FR-04 auth/config contract, NFR-05 security, NFR-06 maintainability

## Dependencies And Interfaces
- **Depends on**:
  - Unit 1 runtime contract foundation
- **Provides to later units**:
  - runtime-facing config access
  - runtime-scoped credential mediation
  - capability cache ownership seams
  - execution metadata record seams
  - compatibility facade for later Claude/Kiro/LangGraph work
- **Key brownfield interfaces to preserve**:
  - `src/core/storage/StateManager.ts`
  - `cli/src/utils/provider-config.ts`
  - `cli/src/agent/ClineAgent.ts`
  - `src/shared/storage/provider-keys.ts`
  - `src/shared/proto-conversions/models/api-configuration-conversion.ts`

## Database / Persistence Ownership
- Unit 2 still uses the existing storage substrate; it does not introduce a new database.
- Unit 2 owns boundary-layer policy and projection objects, not low-level disk mechanics.
- Unit 2 owns runtime-aware mapping policy for config, credentials, cache, and metadata.

## Code Locations
- **Workspace root**: `/mnt/a2c_data/home/.cline/worktrees/a4561/cline`
- **Primary application targets**:
  - `src/core/storage/StateManager.ts`
  - `cli/src/utils/provider-config.ts`
  - `cli/src/agent/ClineAgent.ts`
  - `src/shared/storage/provider-keys.ts`
  - `src/shared/proto-conversions/models/api-configuration-conversion.ts`
- **Planned new application paths**:
  - `src/core/api/runtime/persistence-types.ts`
  - `src/core/api/runtime/persistence-boundary.ts`
  - `src/core/api/runtime/runtime-config-facade.ts`
  - `src/core/api/runtime/runtime-migration-bindings.ts`
  - `src/core/api/runtime/__tests__/persistence-boundary.test.ts`
  - `src/core/api/runtime/__tests__/runtime-config-facade.test.ts`
- **Planned documentation path**:
  - `aidlc-docs/construction/persistence-boundary-and-config-mediation/code/`

## Execution Steps

### Step 5. Create runtime-facing persistence domain types and boundary errors
- Scope:
  - add normalized runtime projection types
  - add boundary-owned error types for config, credentials, cache, and metadata flows
- Target files:
  - create `src/core/api/runtime/persistence-types.ts`
- Expected result:
  - later services consume runtime-facing persistence entities instead of raw storage shapes

### Step 6. Create runtime migration binding and config resolution helpers
- Scope:
  - centralize runtime-to-legacy config mapping
  - implement deterministic config projection logic
  - preserve current precedence semantics
- Target files:
  - create `src/core/api/runtime/runtime-migration-bindings.ts`
  - create `src/core/api/runtime/persistence-boundary.ts`
- Expected result:
  - config resolution is centralized and migration-safe

### Step 7. Create credential mediation and capability-cache ownership helpers
- Scope:
  - add least-privilege credential resolution
  - add runtime-partitioned capability-cache access policy
- Target files:
  - create `src/core/api/runtime/persistence-boundary.ts`
  - modify `src/core/storage/StateManager.ts`
- Expected result:
  - runtime services can resolve credentials and cache state without direct raw storage access

### Step 8. Create execution metadata recording helpers and compatibility facade entry points
- Scope:
  - add boundary-owned execution/probe metadata recording interfaces
  - expose compatibility facade methods for legacy provider-centric callers
- Target files:
  - create `src/core/api/runtime/runtime-config-facade.ts`
  - modify `src/core/storage/StateManager.ts`
- Expected result:
  - metadata and compatibility writes are separated from direct execution logic

### Step 9. Integrate Unit 2 boundary services into existing StateManager/config callers without breaking brownfield flows
- Scope:
  - wire provider-config and agent session config paths through the new facade where appropriate
  - keep existing UI/CLI behavior stable
- Target files:
  - modify `cli/src/utils/provider-config.ts`
  - modify `cli/src/agent/ClineAgent.ts`
  - modify `src/shared/proto-conversions/models/api-configuration-conversion.ts`
- Expected result:
  - runtime-aware persistence mediation exists without breaking current provider-centric entry points

### Step 10. Add Unit 2 ownership, mapping, and cache tests
- Scope:
  - add TDD-aligned persistence ownership and compatibility tests
  - cover mapping resolution, credential mediation, cache partitioning, and metadata separation
- Target files:
  - create `src/core/api/runtime/__tests__/persistence-boundary.test.ts`
  - create `src/core/api/runtime/__tests__/runtime-config-facade.test.ts`
- Expected result:
  - Unit 2 has direct coverage for ownership and compatibility behavior

### Step 11. Write Unit 2 code summary documentation
- Scope:
  - summarize boundary services, changed seams, and test coverage
- Target files:
  - create `aidlc-docs/construction/persistence-boundary-and-config-mediation/code/code-summary.md`
- Expected result:
  - reviewable markdown summary aligned to Unit 2 code changes

### Step 12. Final verification and duplicate-file check
- Scope:
  - verify no duplicate brownfield files were created
  - verify all executed plan steps are marked complete
  - verify implementation stayed inside Unit 2 ownership scope
- Target files:
  - no new target; repository verification only
- Expected result:
  - Unit 2 is ready for review and approval gating

## Test Strategy For This Unit
- **Ownership tests**:
  - runtime config projection does not expose raw storage internals
  - credential mediation is explicit and least-privilege
- **Compatibility tests**:
  - provider-centric entry points still resolve through the new facade
  - proto conversion compatibility remains intact
- **Cache tests**:
  - capability cache is partitioned by runtime identity
  - stale cache degrades to refresh-needed semantics
- **Metadata tests**:
  - execution metadata is separated from config mutation

## Out Of Scope
- shim wrapper process execution
- stream translation logic
- Claude Code runtime migration details beyond persistence compatibility
- Kiro CLI, `gh`, and custom LangGraph runtime onboarding
