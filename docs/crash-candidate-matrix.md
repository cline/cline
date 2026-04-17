# Crash Candidate Matrix

This document tracks the currently known or suspected crash-class failure modes in the Cline VS Code extension.

It is intended to be updated as the team moves each candidate from suspicion to reproduction, test coverage, fix implementation, and verification.

## Status meanings

- **Suspected**: We have architectural or code evidence that this may cause crashes or severe instability.
- **Reproducing**: We are actively building a trigger and failure oracle.
- **Confirmed**: We can reliably trigger the failure or a clear crash-class symptom.
- **Fix in progress**: A fix is being implemented.
- **Mitigated**: A fix landed and targeted regression tests pass.
- **Residual risk**: The immediate failure was mitigated, but follow-up work still exists.
- **Closed**: The candidate is well-covered and no significant residual risk remains.

## Candidates

| ID | Title | Subsystem | Suspected root cause | Trigger pattern | Failure signal / oracle | Test layer | Likely files | Risk | Status |
|---|---|---|---|---|---|---|---|---|---|
| CAND-001 | Full-state rebroadcast of large `clineMessages` | Controller + webview state transport | Full task state, including entire chat history, is repeatedly materialized, JSON-stringified, transmitted, parsed, and rendered | Large conversation + frequent `postStateToWebview()` calls + partial updates | Payload size exceeds budget, rising memory, slower updates, stream breakage | Integration / extension-host | `src/core/controller/index.ts`, `src/core/controller/state/subscribeToState.ts`, `webview-ui/src/context/ExtensionStateContext.tsx` | Critical | Residual risk |
| CAND-002 | Full-array message persistence churn | Message state + disk persistence | Hot-path mutations trigger repeated whole-array writes and task-history bookkeeping | Thousands of message additions/updates during long tasks | Mutation latency growth, disk write amplification, memory / CPU drift | Integration | `src/core/task/message-state.ts`, `src/core/storage/disk.ts` | High | Residual risk |
| CAND-003 | File-edit string amplification | File edit pipeline | Very large file contents are duplicated across original, new, streamed, approval, pretty-diff, and final-content representations | Huge file edits, huge single-line files, repeated edit attempts | Peak heap far above file size, timeouts, extension-host instability | Integration / extension-host | `src/core/task/tools/handlers/WriteToFileToolHandler.ts`, `src/core/task/tools/handlers/ApplyPatchHandler.ts`, `src/integrations/editor/DiffViewProvider.ts` | Critical | Residual risk |
| CAND-004 | Base64 diff URI payload explosion | VS Code diff presentation | Original file content is embedded into virtual-doc URI query strings | Open diff editor for very large files | URI/open failure, extreme memory spike, freeze/crash while opening diff | Extension-host | `src/hosts/vscode/VscodeDiffViewProvider.ts`, `src/extension.ts` | Critical | Mitigated |
| CAND-005 | Quadratic patch matching and similarity fallback | Patch parsing | Fuzzy matching and Levenshtein-style similarity may blow up on large near-match contexts | Large near-match patches, long lines, repeated chunks | Time budget exceeded, high CPU, reduced-heap failure | Unit stress | `src/core/task/tools/utils/PatchParser.ts` | Critical | Mitigated |
| CAND-006 | Diff reconstruction blowup on giant inputs | Diff reconstruction | SEARCH/REPLACE reconstruction repeatedly splits, scans, and slices giant strings | Huge SEARCH blocks, giant single-line replace operations | Time budget exceeded, high memory growth, reduced-heap failure | Unit stress | `src/core/assistant-message/diff.ts` | High | Mitigated |
| CAND-007 | MCP pending notification backlog | MCP integration | Notifications accumulate while no active task consumes them | Noisy MCP server with no task callback | Queue length rises without bound, memory drifts upward | Integration / soak | `src/services/mcp/McpHub.ts` | High | Mitigated |
| CAND-008 | Unbounded MCP error accumulation | MCP integration | Error text is concatenated indefinitely for noisy or failing connections | Repeated transport errors / stderr bursts | Error string growth, higher memory use, degraded server-state updates | Integration | `src/services/mcp/McpHub.ts`, `src/core/controller/index.ts` | Medium | Mitigated |
| CAND-009 | Async teardown races in task abort | Task lifecycle | Async disposals are triggered but not fully awaited in abort flow | Repeated create/cancel/clear-task loops | Watchers / handles drift upward, events after teardown, unstable repeated churn | Integration / soak | `src/core/task/index.ts`, `src/core/context/context-tracking/FileContextTracker.ts`, `src/core/ignore/ClineIgnoreController.ts` | Critical | Mitigated |
| CAND-010 | Watcher accumulation from tracked files | File context tracking | Per-file watchers can accumulate as large tasks touch more files | Long tasks with many reads/edits across many files | Watcher count grows and does not return to baseline | Integration / soak | `src/core/context/context-tracking/FileContextTracker.ts` | High | Residual risk |
| CAND-011 | Focus-chain watcher / debounce lifecycle drift | Focus-chain task support | Long-lived watcher and debounce timers may race or outlive task lifecycle | Focus-chain enabled tasks with repeated restarts/cancels | Post-teardown updates or rising active-handle count | Integration / soak | `src/core/task/focus-chain/index.ts` | Medium | Mitigated |
| CAND-012 | Webview retained-memory pressure | Webview lifecycle | Hidden-but-retained webview keeps large React state and message history resident | Large tasks + hidden retained sidebar | Memory remains elevated despite user not viewing task UI | Extension-host / soak | `src/extension.ts`, `webview-ui/src/context/ExtensionStateContext.tsx` | High | Suspected |

## Next actions

- [ ] Add owner and priority assignments.
- [ ] Add evidence notes beside CAND-001 through CAND-006 as more workload shapes are covered.
- [ ] Add repro links and failing test paths once each candidate is under investigation.
- [ ] Update status as candidates move through the workflow.