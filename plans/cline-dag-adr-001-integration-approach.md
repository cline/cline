# ADR-001: Integration Approach — Fork Cline vs Standalone Extension

## Status

**Accepted** — 28 January 2026

## Context

The Cline+ project aims to add DAG-aware coding assistance and the "beads" (Ralph Wiggum loop) pattern to an AI coding agent. Two viable approaches exist:

1. **Fork Cline**: Modify the existing Cline codebase to add beads and DAG features
2. **Standalone Extension**: Build a new VS Code extension from scratch using the agent-build spec

The existing plan documents support both approaches:
- `cline-dag-agent-build.md` provides a complete standalone implementation
- `cline-beads-integration-findings.md` maps features to existing Cline code

This ADR resolves the ambiguity and establishes the canonical approach.

## Decision

**We will integrate into the existing Cline codebase (fork approach).**

The standalone agent-build specification serves as a reference implementation and can be used for:
- Understanding the architecture in isolation
- Prototyping new features before integration
- Testing DAG accuracy independently

However, the production implementation will be a fork/modification of Cline.

## Rationale

### Arguments for Fork (chosen)

| Factor | Benefit |
|--------|---------|
| **Existing ecosystem** | Cline has users, documentation, community. Building on it provides immediate value. |
| **MCP integration** | Cline's MCP support is mature. Rebuilding it from scratch would duplicate effort. |
| **UI components** | Chat interface, diff viewer, settings panel already exist and are polished. |
| **Provider support** | Multiple LLM providers already implemented and tested. |
| **Maintenance burden** | Single codebase to maintain rather than two parallel implementations. |
| **User migration** | Existing Cline users can upgrade without switching extensions. |

### Arguments for Standalone (not chosen)

| Factor | Benefit |
|--------|---------|
| **Clean slate** | No legacy constraints; can design optimal architecture |
| **Simpler initial build** | Less code to understand before starting |
| **Independent releases** | Can release without coordinating with Cline maintainers |

### Why Fork Wins

The core value proposition of Cline+ is **DAG awareness and beads**, not a new chat interface or LLM provider system. These features are additive to Cline's existing capabilities. Building them as modifications preserves the 80% of functionality that already works well.

The integration findings document (`cline-beads-integration-findings.md`) demonstrates that the integration points are well-defined and the required changes are localised to specific subsystems.

## Consequences

### Positive

- Faster time to usable product (reuse existing UI, providers, file operations)
- Access to Cline's existing test suite
- Community familiarity with the base extension
- Can contribute improvements back to upstream Cline

### Negative

- Must understand Cline's architecture before making changes
- Constrained by Cline's design decisions (proto/gRPC, React patterns)
- Upstream Cline changes may require merge conflict resolution
- Proto regeneration required for new state fields

### Neutral

- The standalone agent-build spec remains useful for documentation and testing
- DAG engine (Python microservice) implementation is identical in both approaches

## Implementation Plan

Based on this decision, the implementation order is:

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

### Phase 1: Foundation (Weeks 1-2)

- [x] Fork Cline repository
- [x] Add bead types to `src/shared/beads.ts`
- [ ] Extend `TaskState` with bead tracking fields
- [x] Add bead-related `ClineAsk`/`ClineSay` types to `ExtensionMessage.ts`
- [x] Regenerate protos
- [?] Verify existing functionality still works

### Phase 2: Bead Manager (Weeks 3-4)

- [x] Create `src/core/beads/BeadManager.ts`
- [x] Create `src/core/beads/SuccessCriteria.ts`
- [~] Modify `src/core/task/index.ts` to use bead boundaries
- [x] Add bead approval ask flow
- [x] Wire into `src/core/controller/index.ts`

### Phase 3: DAG Service (Weeks 5-7)

- [x] Add `dag-engine/` Python package (from agent-build spec)
- [x] Create `src/services/dag/DagBridge.ts`
- [x] Wire lifecycle into Controller
- [~] Add incremental analysis on file change
- [~] Add DAG state to `ExtensionState`

### Phase 4: DAG UI (Weeks 8-9)

- [x] Add DAG panel components to webview
- [x] Create gRPC service for DAG queries
- [x] Implement D3.js graph visualisation
- [~] Add impact highlighting

### Phase 5: Context Injection (Weeks 10-11)

- [x] Add DAG context to system prompt components
- [~] Implement context budget management
- [ ] Add impact-aware file selection
- [ ] Update `loadContext()` in task runner

### Phase 6: Bead Review UI (Weeks 12-13)

- [x] Add bead timeline component
- [~] Add bead review panel with diff + impact
- [x] Wire approval buttons to bead manager
- [ ] Add git commit per bead

### Phase 7: Testing & Polish (Weeks 14-16)

- [ ] Add unit tests for new components
- [ ] Run DAG accuracy validation
- [ ] Performance optimisation
- [ ] Documentation updates

## Alternatives Considered

### Alternative 1: Plugin/Extension to Cline

Instead of forking, build beads and DAG as a separate extension that communicates with Cline via VS Code extension API.

**Rejected because:** VS Code extension-to-extension communication is limited. Would require Cline to expose internal APIs, which couples the projects tightly anyway.

### Alternative 2: Upstream Contribution

Contribute beads and DAG directly to the Cline repository.

**Deferred:** This may be viable long-term, but the features are experimental. Building as a fork allows iteration without upstream coordination overhead. Once stable, selected features could be proposed as PRs.

### Alternative 3: MCP Server for DAG

Implement DAG analysis as an MCP server that Cline connects to.

**Partially adopted:** The DAG engine is a separate service (Python subprocess), similar in spirit to MCP. However, beads require deep integration with the task loop, which cannot be achieved via MCP alone.

## References

- `plans/cline-beads-integration-findings.md` — Detailed integration mapping
- `plans/cline-dag-agent-build.md` — Standalone reference implementation
- `plans/cline-dag-technical-spec.md` — Architecture specification
- `.clinerules/general.md` — Cline codebase patterns and conventions

---

## Appendix: File Change Summary

This table summarises which files need modification (from integration findings):

| Category | Files | Change Type |
|----------|-------|-------------|
| **Types & State** | `src/shared/beads.ts` (new) | Add |
| | `src/shared/ExtensionMessage.ts` | Modify |
| | `src/shared/storage/state-keys.ts` | Modify |
| | `src/core/task/TaskState.ts` | Modify |
| **Bead Manager** | `src/core/beads/*` (new) | Add |
| | `src/core/controller/index.ts` | Modify |
| | `src/core/task/index.ts` | Modify |
| **DAG Service** | `dag-engine/*` (new) | Add |
| | `src/services/dag/*` (new) | Add |
| **Proto** | `proto/cline/beads.proto` (new) | Add |
| | `proto/cline/dag.proto` (new) | Add |
| **UI** | `webview-ui/src/components/beads/*` (new) | Add |
| | `webview-ui/src/components/dag/*` (new) | Add |
| | `webview-ui/src/App.tsx` | Modify |
| | `webview-ui/src/components/chat/ChatRow.tsx` | Modify |

**Estimated lines of code:**
- New code: ~8,000 lines (TypeScript + Python)
- Modified code: ~500 lines
- Test code: ~3,000 lines

---

**Decision made by:** Project Lead
**Date:** 28 January 2026
**Review date:** After Phase 3 completion
