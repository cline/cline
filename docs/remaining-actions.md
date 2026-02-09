# Remaining Implementation Actions (Beadsmith DAG/Beads)

Legend: [x] completed, [~] partial, [ ] future/blocked

## Bead Workflow - ALL COMPLETE
- [x] Implement per-bead git commits (shadow vs workspace) - BeadCommitService.ts wired into approveBead.ts
- [x] Wire a diff view into bead review - presentBeadDiff in TaskCheckpointManager
- [x] Expose bead settings in UI - In FeatureSettingsSection.tsx
- [~] BeadManager unit tests - Test file created, blocked by copilot-sdk env issue

## DAG Engine + Integration - ALL COMPLETE
- [x] Wire `DagFileWatcher` into controller lifecycle - Done in src/core/controller/index.ts
- [x] Apply `.beadsmithignore` rules to DAG analysis - Filters in analyseProject.ts and getImpact.ts
- [x] Persist DAG state into `ExtensionState` - dagIsAnalyzing, dagError, dagLastUpdated, dagSummary
- [x] Mount `DagPanel` in main UI - Done in App.tsx with ExtensionStateContext navigation
- [x] Add impact-path highlighting in graph view - impactNodeIds in ForceGraph.tsx

## Context Injection
- [x] Populate `dagImpact` in prompt context - Done in src/core/task/index.ts
- [ ] Impact-aware file selection (future enhancement) - Would auto-include affected file content

## Tests & Validation - BLOCKED
All tests blocked by copilot-sdk package.json issue preventing mocha from loading:
- [~] BeadManager unit tests - Test file exists at src/core/beads/__tests__/BeadManager.test.ts
- [ ] DAG bridge tests
- [ ] Impact analysis tests
- [ ] Integration tests
- [ ] Performance benchmarks

---

## Implementation Summary

### Core Features: 9/9 COMPLETE
1. DagFileWatcher wired into controller lifecycle
2. Per-bead git commits (BeadCommitService)
3. .beadsmithignore rules applied to DAG analysis
4. Diff view wired into bead review
5. DAG state persisted to ExtensionState
6. Bead settings exposed in UI
7. DagPanel mounted in main UI with navigation
8. dagImpact populated in prompt context
9. Impact-path highlighting in graph view

### Files Modified/Created This Session:
- `src/core/controller/index.ts` - Added getDagIgnoreController() getter
- `src/core/controller/dag/analyseProject.ts` - Added filterIgnoredFromGraph()
- `src/core/controller/dag/getImpact.ts` - Added filterIgnoredFromImpact()
- `src/core/controller/dag/queryNodes.ts` - Fixed property names (name, type)
- `src/core/api/providers/copilot-sdk.ts` - Fixed sessionConfig type cast
- `src/core/beads/__tests__/BeadManager.test.ts` - Fixed type assertions

### Blocked Items:
1. **Test Environment**: copilot-sdk package has broken package.json exports, preventing mocha from running
2. **Impact-aware file selection**: Future enhancement, not blocking core features

### To Unblock Tests:
The copilot-sdk package needs to have its package.json fixed with proper "exports" configuration, or tests need to be restructured to avoid the import chain that triggers copilot-sdk loading.
