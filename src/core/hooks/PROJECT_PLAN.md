# Hooks System - Project Plan & Linear Task Breakdown

## Executive Summary

The hooks system has a solid foundation with PreToolUse and PostToolUse working, but requires foundational work before adding the 6 planned hooks. This document breaks down the remaining work into phases and actionable Linear tasks.

---

## Current State Assessment

### ✅ What's Implemented
- PreToolUse and PostToolUse hooks fully functional
- HookFactory with workspace-level hook discovery
- StdioHookRunner for script execution
- CombinedHookRunner for multi-workspace scenarios
- Basic error handling and JSON I/O
- Feature flag (`hooksEnabled`) in settings
- Proto definitions for current hooks
- Implementation guide documentation

### ❌ What's Missing (Critical Gaps)

#### 1. **Global Hooks Directory Support**
- README mentions global Cline rules folder support
- Current implementation only checks workspace roots
- **Impact**: Users can't create universal hooks across projects

#### 2. **Context Modification Implementation**
- TODO comments in ToolExecutor
- Hooks can return `contextModification` but it's not used
- **Impact**: Core hook capability is non-functional

#### 3. **UI/UX Integration** 
- No visual feedback during hook execution
- No disclosure in API Request section
- No slow hook warnings
- No Settings UI toggle
- **Impact**: Poor user experience, no discoverability

#### 4. **Testing Infrastructure**
- README emphasizes TDD but zero tests exist
- **Impact**: Can't verify correctness, risky to add features

#### 5. **Telemetry & Metrics**
- No hook usage tracking
- No performance monitoring
- No failure tracking
- **Impact**: Can't measure adoption or debug issues

#### 6. **Platform-Specific Issues**
- Windows: PATHEXT doesn't include .ps1 (PowerShell)
- **Impact**: PowerShell hooks don't work on Windows

---

## Project Approach & Philosophy

### Guiding Principles

1. **Foundation First**: Complete core capabilities before adding new hooks
2. **Test-Driven**: Establish testing infrastructure early
3. **User Experience**: Make hooks discoverable and debuggable
4. **Incremental Delivery**: Ship value in phases
5. **Documentation-Driven**: Document as we build

### Phase Strategy

```
Phase 0: Foundation (Critical) → Phase 1: Testing & Quality → Phase 2: UX/Polish → Phase 3: New Hooks
```

This approach ensures:
- Solid foundation before expansion
- Quality through testing
- Good UX for current hooks before adding complexity
- Safe, incremental feature rollout

---

## Phase Breakdown

### Phase 0: Foundation (MUST DO FIRST)
**Goal**: Make existing hooks fully functional

**Why First**: These are critical gaps that affect core functionality. Without these, even the current hooks don't work properly.

**Estimated Duration**: 2-3 weeks

Tasks:
1. Implement context modification injection
2. Add global hooks directory support  
3. Fix Windows PowerShell support
4. Implement hook execution state tracking

### Phase 1: Testing & Quality (MUST DO SECOND)
**Goal**: Establish testing infrastructure and verify correctness

**Why Second**: Can't confidently add features without tests. Tests also serve as documentation and prevent regressions.

**Estimated Duration**: 2-3 weeks

Tasks:
1. Set up testing infrastructure
2. Write HookFactory tests
3. Write HookRunner tests
4. Write integration tests
5. Add error scenario tests

### Phase 2: UX & Discoverability (SHOULD DO THIRD)
**Goal**: Make hooks visible, debuggable, and user-friendly

**Why Third**: Good UX for existing hooks before adding more complexity. Improves adoption and debugging experience.

**Estimated Duration**: 2-3 weeks

Tasks:
1. Add UI for hook execution feedback
2. Add Settings toggle for hooksEnabled
3. Implement slow hook warnings
4. Add hook info to API Request disclosure
5. Create user documentation
6. Add telemetry events

### Phase 3: New Hooks (DO LAST)
**Goal**: Implement the 6 planned hooks

**Why Last**: Foundation is solid, tests exist, UX is good. Safe to expand.

**Estimated Duration**: 3-4 weeks

Tasks:
1. UserPromptSubmit hook
2. TaskStart hook
3. TaskResume hook
4. TaskCancel hook
5. TaskComplete hook
6. PreCompact hook

---

## Detailed Linear Task Breakdown

### PHASE 0: FOUNDATION (Critical Path)

#### Task 0.1: Implement Context Modification Injection
**Priority**: P0 (Critical)  
**Size**: Medium (5 points)  
**Labels**: `hooks`, `foundation`, `p0`

**Description**:
Context modification is a core hook capability that's currently non-functional. Hooks can return `contextModification` strings, but these are ignored (marked with TODO comments in ToolExecutor).

**Acceptance Criteria**:
- [ ] Context modifications from PreToolUse are injected into conversation before tool execution
- [ ] Context modifications from PostToolUse are injected after tool execution
- [ ] Multiple context modifications are combined appropriately
- [ ] Context appears in API conversation history
- [ ] Context is visible to the LLM in subsequent requests

**Implementation Details**:
1. In `ToolExecutor.handleCompleteBlock()`, after PreToolUse hook succeeds:
   - If `preToolUseResult.contextModification` exists, inject into `taskState.userMessageContent`
   - Format: `[Hook Context]\n${contextModification}`
2. For PostToolUse context modification:
   - Inject into next user message or create a system message
   - Consider if this should be part of tool result or separate
3. Test with both hooks returning context to verify combination logic

**Files to Modify**:
- `src/core/task/ToolExecutor.ts` - Remove TODOs and implement injection
- May need to modify message state handling

**Dependencies**: None

---

#### Task 0.2: Add Global Hooks Directory Support
**Priority**: P0 (Critical)  
**Size**: Small (3 points)  
**Labels**: `hooks`, `foundation`, `p0`

**Description**:
README specifies hooks can be in workspace `.clinerules/hooks` OR global Cline rules folder. Currently only workspace hooks are supported.

**Acceptance Criteria**:
- [ ] Hooks are discovered in global rules directory
- [ ] Global hooks directory path is `~/Documents/Cline/Rules/hooks` (or platform-specific Documents path)
- [ ] Global hooks run alongside workspace hooks
- [ ] Priority: workspace hooks run before global hooks (or configurable)
- [ ] Works on Windows, macOS, and Linux

**Implementation Details**:
1. Add `getGlobalHooksDir()` function in `src/core/storage/disk.ts`:
   - Use existing `ensureRulesDirectoryExists()` pattern
   - Return `${documentsPath}/Cline/Rules/hooks`
2. Modify `HookFactory.findHookScripts()`:
   - Check global hooks directory in addition to workspace roots
   - Decide on execution order (workspace first, then global, or vice versa)
3. Update `getWorkspaceHooksDirs()` to `getAllHooksDirs()` that includes both

**Files to Modify**:
- `src/core/storage/disk.ts` - Add getGlobalHooksDir()
- `src/core/hooks/hook-factory.ts` - Update discovery logic

**Dependencies**: None

---

#### Task 0.3: Fix Windows PowerShell Hook Support
**Priority**: P1 (High)  
**Size**: Small (2 points)  
**Labels**: `hooks`, `foundation`, `windows`, `p1`

**Description**:
PATHEXT on Windows doesn't include `.ps1`, so PowerShell hooks don't work. README asks: "Should we support PowerShell or document cmd-only?"

**Decision Needed**: Document cmd-only OR add .ps1 support

**Acceptance Criteria (if supporting .ps1)**:
- [ ] `.ps1` hooks are discovered on Windows
- [ ] PowerShell hooks execute correctly
- [ ] Falls back gracefully if PowerShell not available
- [ ] Documentation updated with PowerShell requirements

**Acceptance Criteria (if documenting cmd-only)**:
- [ ] README explicitly states Windows uses cmd/batch only
- [ ] IMPLEMENTATION_GUIDE updated with Windows limitations
- [ ] User documentation includes Windows-specific guidance

**Implementation Details (if supporting .ps1)**:
1. In `HookFactory.findHookInHooksDir()` Windows branch:
   - After checking PATHEXT, also check for `.ps1` extension
   - Execute with: `powershell.exe -File <path>` instead of direct spawn
2. Add fallback if PowerShell not found
3. Test on Windows with PowerShell hook

**Files to Modify**:
- `src/core/hooks/hook-factory.ts` - Add .ps1 handling
- Documentation files

**Dependencies**: None

---

#### Task 0.4: Implement Hook Execution State Tracking
**Priority**: P1 (High)  
**Size**: Medium (3 points)  
**Labels**: `hooks`, `foundation`, `p1`

**Description**:
Track hook execution state for metrics, UI feedback, and debugging. Foundation for later telemetry and UX features.

**Acceptance Criteria**:
- [ ] Track when hooks start/complete
- [ ] Store execution duration
- [ ] Track success/failure state
- [ ] Store error messages
- [ ] Make data available to UI and telemetry

**Implementation Details**:
1. Create `HookExecutionMetrics` interface:
   ```typescript
   interface HookExecutionMetrics {
     hookName: string
     startTime: number
     endTime: number
     duration: number
     success: boolean
     error?: string
   }
   ```
2. In `HookRunner`, track metrics in `run()` method
3. Store metrics in TaskState or new HookExecutionTracker class
4. Expose metrics through Task class for UI/telemetry access

**Files to Modify**:
- `src/core/hooks/hook-factory.ts` - Add metrics tracking
- `src/core/task/TaskState.ts` - Store hook metrics
- Create `src/core/hooks/HookExecutionTracker.ts` (optional)

**Dependencies**: None

---

### PHASE 1: TESTING & QUALITY

#### Task 1.1: Set Up Testing Infrastructure
**Priority**: P0 (Critical)  
**Size**: Medium (5 points)  
**Labels**: `hooks`, `testing`, `infrastructure`, `p0`

**Description**:
Create testing infrastructure for hooks system. README emphasizes TDD but no tests exist.

**Acceptance Criteria**:
- [ ] Test directory structure created
- [ ] Test fixtures for mock hooks
- [ ] Helper functions for common test patterns
- [ ] CI integration configured
- [ ] Test coverage reporting enabled

**Implementation Details**:
1. Create `src/core/hooks/__tests__/` directory
2. Create test fixtures in `src/core/hooks/__tests__/fixtures/`:
   - Mock hook scripts (bash, Python, Node.js)
   - Mock HookInput JSON files
   - Expected HookOutput samples
3. Create test utilities:
   - `MockHookRunner` class for testing without filesystem
   - Helper to create temporary hook directories
   - Helper to spawn test hooks
4. Configure test runner (Jest/Mocha) for hooks tests
5. Add to CI pipeline

**Files to Create**:
- `src/core/hooks/__tests__/setup.ts`
- `src/core/hooks/__tests__/fixtures/` directory
- `src/core/hooks/__tests__/test-utils.ts`

**Dependencies**: None

---

#### Task 1.2: Write HookFactory Tests
**Priority**: P0 (Critical)  
**Size**: Large (8 points)  
**Labels**: `hooks`, `testing`, `p0`

**Description**:
Comprehensive tests for HookFactory hook discovery and instantiation.

**Acceptance Criteria**:
- [ ] Test hook discovery in workspace directories
- [ ] Test hook discovery in global directory
- [ ] Test multi-workspace hook combination
- [ ] Test missing hooks (NoOpRunner)
- [ ] Test executable permission checking
- [ ] Test Windows PATHEXT handling
- [ ] Test error scenarios

**Test Cases**:
```typescript
describe('HookFactory', () => {
  describe('create', () => {
    it('returns NoOpRunner when no hook exists')
    it('returns StdioHookRunner for single workspace hook')
    it('returns CombinedHookRunner for multi-workspace hooks')
    it('includes global hooks in combination')
    it('respects hook execution order')
  })
  
  describe('findHookScripts', () => {
    it('finds hooks in workspace root')
    it('finds hooks in global directory')
    it('skips non-executable files')
    it('finds Windows hooks by PATHEXT')
    it('finds .ps1 hooks on Windows')
  })
})
```

**Files to Create**:
- `src/core/hooks/__tests__/HookFactory.test.ts`

**Dependencies**: Task 1.1 (Testing Infrastructure)

---

#### Task 1.3: Write HookRunner Tests  
**Priority**: P0 (Critical)  
**Size**: Large (8 points)  
**Labels**: `hooks`, `testing`, `p0`

**Description**:
Tests for all HookRunner implementations: StdioHookRunner, NoOpRunner, CombinedHookRunner.

**Acceptance Criteria**:
- [ ] Test StdioHookRunner execution
- [ ] Test JSON I/O serialization
- [ ] Test hook timeout handling
- [ ] Test hook error handling
- [ ] Test CombinedHookRunner result merging
- [ ] Test NoOpRunner behavior

**Test Cases**:
```typescript
describe('StdioHookRunner', () => {
  it('executes hook script successfully')
  it('passes correct JSON input via stdin')
  it('parses JSON output from stdout')
  it('handles hook returning shouldContinue: false')
  it('handles hook with contextModification')
  it('handles hook with error')
  it('rejects on invalid JSON output')
  it('rejects on non-zero exit code')
})

describe('CombinedHookRunner', () => {
  it('runs all hooks in sequence')
  it('stops if any hook returns shouldContinue: false')
  it('combines context modifications')
  it('combines error messages')
  it('tracks slowest hook')
})
```

**Files to Create**:
- `src/core/hooks/__tests__/StdioHookRunner.test.ts`
- `src/core/hooks/__tests__/CombinedHookRunner.test.ts`
- `src/core/hooks/__tests__/NoOpRunner.test.ts`

**Dependencies**: Task 1.1 (Testing Infrastructure)

---

#### Task 1.4: Write Integration Tests
**Priority**: P1 (High)  
**Size**: Large (8 points)  
**Labels**: `hooks`, `testing`, `integration`, `p1`

**Description**:
End-to-end tests verifying hooks work correctly in real scenarios.

**Acceptance Criteria**:
- [ ] Test PreToolUse hook blocking tool execution
- [ ] Test PostToolUse hook observing execution
- [ ] Test context modification injection
- [ ] Test multi-workspace hook execution
- [ ] Test hook failure scenarios
- [ ] Test performance (hooks shouldn't add >100ms overhead)

**Test Scenarios**:
```typescript
describe('Hooks Integration', () => {
  describe('PreToolUse', () => {
    it('blocks dangerous commands')
    it('allows safe operations')
    it('injects context modification')
  })
  
  describe('PostToolUse', () => {
    it('logs tool execution')
    it('tracks execution time')
    it('handles tool failures')
  })
  
  describe('Multi-workspace', () => {
    it('runs hooks from all workspace roots')
    it('combines results correctly')
    it('stops on first blocking hook')
  })
})
```

**Files to Create**:
- `src/core/hooks/__tests__/integration/hooks-integration.test.ts`

**Dependencies**: Tasks 1.1, 1.2, 1.3

---

#### Task 1.5: Add Error Scenario Tests
**Priority**: P1 (High)  
**Size**: Medium (5 points)  
**Labels**: `hooks`, `testing`, `error-handling`, `p1`

**Description**:
Test error scenarios and edge cases for robustness.

**Acceptance Criteria**:
- [ ] Test hook script not executable
- [ ] Test hook script not found
- [ ] Test hook returns malformed JSON
- [ ] Test hook hangs (timeout)
- [ ] Test hook crashes
- [ ] Test hook modifies Cline state (SDK callback)
- [ ] Test concurrent hook execution

**Test Cases**:
```typescript
describe('Hooks Error Scenarios', () => {
  it('handles missing hook script gracefully')
  it('handles non-executable hook')
  it('handles malformed JSON output')
  it('handles hook timeout')
  it('handles hook crash')
  it('prevents infinite recursion from SDK callbacks')
  it('handles filesystem changes during execution')
})
```

**Files to Create**:
- `src/core/hooks/__tests__/error-scenarios.test.ts`

**Dependencies**: Tasks 1.1, 1.2, 1.3

---

### PHASE 2: UX & DISCOVERABILITY

#### Task 2.1: Add Hook Execution UI Feedback
**Priority**: P1 (High)  
**Size**: Large (8 points)  
**Labels**: `hooks`, `ui`, `ux`, `p1`

**Description**:
Show users when hooks are running and their results. README specifies:
- Show in API Request disclosure (not visible by default)
- Show slow hooks with execution time
- Don't add noise for users who don't use hooks

**Acceptance Criteria**:
- [ ] Hook execution shown in API Request disclosure section
- [ ] Slow hooks (>100ms) get visual indicator
- [ ] Hook execution time displayed
- [ ] Hook errors clearly presented
- [ ] Context modifications visible
- [ ] No UI changes when hooks disabled

**UI Design**:
```
▼ API Request
  Model: Claude 3.5 Sonnet
  Tokens: 1,234 in / 5,678 out
  ▼ Hooks (2)
    ✓ PreToolUse (45ms)
    ⚠ PostToolUse (150ms) - Slow hook detected
      Context: "Logged to audit.log"
```

**Implementation Details**:
1. Add hook metrics to API request message structure
2. Update webview message types to include hook data
3. Add UI component in API Request disclosure
4. Style warnings for slow hooks
5. Display context modifications
6. Show errors prominently

**Files to Modify**:
- `src/shared/ExtensionMessage.ts` - Add hook metrics to message type
- `webview-ui/src/components/chat/ApiRequestInfo.tsx` (or similar)
- Add new component `webview-ui/src/components/hooks/HookExecutionInfo.tsx`

**Dependencies**: Task 0.4 (Hook execution state tracking)

---

#### Task 2.2: Add Settings UI for Hooks Toggle
**Priority**: P1 (High)  
**Size**: Small (3 points)  
**Labels**: `hooks`, `ui`, `settings`, `p1`

**Description**:
Add UI toggle in Settings to enable/disable hooks. Currently only accessible via global state.

**Acceptance Criteria**:
- [ ] Toggle visible in Settings view
- [ ] Labeled "Enable Hooks" with description
- [ ] Shows current state
- [ ] Changes persist immediately
- [ ] Works with existing `hooksEnabled` flag

**UI Design**:
```
[Settings]
  ...
  Developer Features
    ☑ Enable Hooks
      Allow executable scripts to run at specific points during task execution.
      Learn more about hooks →
```

**Implementation Details**:
1. Add toggle to Settings UI component
2. Wire to `hooksEnabled` global setting
3. Add tooltip/help text
4. Link to documentation
5. Consider adding hooks status indicator

**Files to Modify**:
- `webview-ui/src/components/settings/` - Add hooks toggle
- May need to update settings gRPC endpoints

**Dependencies**: None (but benefits from Task 2.5 documentation)

---

#### Task 2.3: Implement Slow Hook Warnings
**Priority**: P2 (Medium)  
**Size**: Medium (5 points)  
**Labels**: `hooks`, `ux`, `performance`, `p2`

**Description**:
Show users when hooks are executing slowly (>100ms). README specifies showing execution time and identifying the slow hook.

**Acceptance Criteria**:
- [ ] Detect hooks taking >100ms
- [ ] Show loading indicator during execution
- [ ] Display warning after slow hook completes
- [ ] Identify which hook was slow
- [ ] Provide actionable guidance
- [ ] Don't show for fast hooks (<100ms)

**UI Flow**:
```
[During execution]
"Running hooks..." (spinner)

[After slow hook]
⚠ Hook 'PreToolUse' took 250ms
  This may slow down task execution.
  Consider optimizing your hook or moving logic to PostToolUse.
```

**Implementation Details**:
1. Add threshold constant (100ms)
2. Track execution time in HookRunner
3. Show loading indicator in UI during execution
4. Display warning message for slow hooks
5. Include hook name and duration
6. Add link to optimization guide

**Files to Modify**:
- `src/core/hooks/hook-factory.ts` - Track slow hooks
- `webview-ui/src/components/chat/` - Add warning UI
- May need new message type for hook warnings

**Dependencies**: Task 0.4 (Hook execution state tracking)

---

#### Task 2.4: Add Hooks Info to API Request Disclosure
**Priority**: P2 (Medium)  
**Size**: Medium (5 points)  
**Labels**: `hooks`, `ui`, `transparency`, `p2`

**Description**:
Add detailed hook execution info to the API Request disclosure triangle (currently shows model, tokens, etc.). Users can expand to see hook details without clutter.

**Acceptance Criteria**:
- [ ] Hooks section in API Request disclosure
- [ ] Shows which hooks ran
- [ ] Shows execution time for each
- [ ] Shows success/failure status
- [ ] Shows context modifications
- [ ] Shows error messages
- [ ] Collapsed by default

**Implementation Details**:
1. Extend API Request message structure
2. Add hooks data to disclosure UI
3. Create collapsible section
4. Display all hook metrics
5. Link to hook documentation

**Files to Modify**:
- Same as Task 2.1 but more detailed implementation

**Dependencies**: Task 2.1 (Hook execution UI feedback)

---

#### Task 2.5: Create User Documentation
**Priority**: P1 (High)  
**Size**: Large (8 points)  
**Labels**: `hooks`, `documentation`, `p1`

**Description**:
Create comprehensive user-facing documentation for hooks. Currently only have developer implementation guide.

**Acceptance Criteria**:
- [ ] User guide in docs site
- [ ] Getting started tutorial
- [ ] Example hooks for common use cases
- [ ] Troubleshooting guide
- [ ] API reference
- [ ] Security considerations
- [ ] Platform-specific guidance (Windows/Mac/Linux)

**Documentation Structure**:
```
docs/features/hooks/
  overview.mdx - What are hooks, why use them
  getting-started.mdx - Create your first hook
  examples.mdx - Security, logging, integration patterns
  api-reference.mdx - Input/output schemas
  troubleshooting.mdx - Common issues and solutions
  security.mdx - Safe practices, what to avoid
```

**Content to Include**:
- What hooks are and when they run
- How to create a hook script
- JSON input/output format
- Code examples (bash, Python, Node.js)
- Common use cases (security, compliance, logging)
- Multi-workspace behavior
- Global vs workspace hooks
- Performance best practices
- Debugging techniques
- Security warnings

**Files to Create**:
- `docs/features/hooks/*.mdx` - Multiple documentation files
- Update `docs/docs.json` navigation

**Dependencies**: None (can reference IMPLEMENTATION_GUIDE.md)

---

#### Task 2.6: Add Telemetry for Hooks
**Priority**: P2 (Medium)  
**Size**: Medium (5 points)  
**Labels**: `hooks`, `telemetry`, `metrics`, `p2`

**Description**:
Track hooks usage, performance, and failures for product insights and debugging.

**Acceptance Criteria**:
- [ ] Track hook execution events
- [ ] Track execution duration
- [ ] Track success/failure rates
- [ ] Track hook types used
- [ ] Track performance issues (slow hooks)
- [ ] Respect user privacy settings
- [ ] Anonymize user data

**Telemetry Events**:
```typescript
// Hook executed
{
  event: 'hook_executed',
  hookName: 'PreToolUse',
  duration: 45,
  success: true,
  isGlobal: false,
  multiWorkspace: true
}

// Hook failed
{
  event: 'hook_failed',
  hookName: 'PreToolUse',
  errorType: 'json_parse_error',
  duration: 120
}

// Slow hook
{
  event: 'hook_slow',
  hookName: 'PostToolUse',
  duration: 250
}
```

**Implementation Details**:
1. Add telemetry calls in HookRunner
2. Track key metrics (execution time, errors)
3. Respect telemetry settings
4. Anonymize paths and user data
5. Add to existing telemetry service

**Files to Modify**:
- `src/core/hooks/hook-factory.ts` - Add telemetry calls
- `src/services/logging/` - May need new events

**Dependencies**: Task 0.4 (Hook execution state tracking)

---

### PHASE 3: NEW HOOKS

For each new hook (Tasks 3.1-3.6), follow this template:

**Size**: Medium (5 points each)  
**Labels**: `hooks`, `new-feature`  
**Dependencies**: All Phase 0, 1, 2 tasks complete

**General Approach for Each Hook**:
1. Define proto message in `proto/cline/hooks.proto`
2. Update `Hooks` interface in `hook-factory.ts`
3. Run `npm run protos` to generate types
4. Add hook execution point in appropriate file
5. Handle hook results (blocking vs observability)
6. Write tests
7. Update documentation

---

#### Task 3.1: Implement UserPromptSubmit Hook
**Priority**: P2 (Medium)  
**Location**: `src/core/task/index.ts` - `initiateTaskLoop()`  
**Type**: Blocking (can prevent prompt submission)

**Proto Definition**:
```protobuf
message UserPromptSubmitData {
  string prompt = 1;
  bool has_images = 2;
  bool has_files = 3;
}
```

**Use Cases**:
- Validate prompts before processing
- Add project context automatically
- Enforce prompt templates
- Log user interactions

**Implementation Notes**:
- Execute after user content prepared, before API request
- If blocked, don't send to API
- Context modification goes into user message

---

#### Task 3.2: Implement TaskStart Hook
**Priority**: P2 (Medium)  
**Location**: `src/core/task/index.ts` - `startTask()`  
**Type**: Blocking (can prevent task start)

**Proto Definition**:
```protobuf
message TaskStartData {
  string initial_prompt = 1;
  repeated string images = 2;
  repeated string files = 3;
}
```

**Use Cases**:
- Initialize project-specific context
- Set up logging/monitoring
- Validate prerequisites
- Add custom instructions

**Implementation Notes**:
- Execute after initialization, before first API request
- If blocked, abort task immediately
- Context modification enhances initial prompt

---

#### Task 3.3: Implement TaskResume Hook
**Priority**: P2 (Medium)  
**Location**: `src/core/task/index.ts` - `resumeTaskFromHistory()`  
**Type**: Blocking (can prevent resume)

**Proto Definition**:
```protobuf
message TaskResumeData {
  int64 time_since_last_message_ms = 1;
  bool was_completed = 2;
  int32 message_count = 3;
}
```

**Use Cases**:
- Refresh project state
- Validate dependencies still exist
- Update context based on time elapsed
- Log task resumption

**Implementation Notes**:
- Execute after loading saved state, before resuming
- Provide time since last activity
- Context modification updates resume context

---

#### Task 3.4: Implement TaskCancel Hook
**Priority**: P3 (Low)  
**Location**: `src/core/task/index.ts` - `abortTask()`  
**Type**: Observability only (cannot prevent cancellation)

**Proto Definition**:
```protobuf
message TaskCancelData {
  int32 api_request_count = 1;
  bool was_interrupted = 2;
  int32 message_count = 3;
}
```

**Use Cases**:
- Clean up external resources
- Log cancellation
- Revert partial changes
- Notify external systems

**Implementation Notes**:
- Execute at start of abort, before cleanup
- Cannot block cancellation (always continue)
- Errors logged but don't stop abort
- Useful for cleanup/logging

---

#### Task 3.5: Implement TaskComplete Hook
**Priority**: P2 (Medium)  
**Location**: `src/core/task/tools/handlers/AttemptCompletionHandler.ts`  
**Type**: Observability only (cannot prevent completion at this point)

**Proto Definition**:
```protobuf
message TaskCompleteData {
  string result = 1;
  bool had_command = 2;
  int32 api_request_count = 3;
  int32 message_count = 4;
}
```

**Use Cases**:
- Log successful completion
- Run post-completion validation
- Update external systems
- Generate reports

**Implementation Notes**:
- Execute after user approves completion
- Cannot prevent completion (user already approved)
- Good for logging and external integration

---

#### Task 3.6: Implement PreCompact Hook
**Priority**: P3 (Low)  
**Location**: `src/core/context/context-management/ContextManager.ts`  
**Type**: Observability only (cannot prevent compaction)

**Proto Definition**:
```protobuf
message PreCompactData {
  int32 messages_to_remove_count = 1;
  int32 total_message_count = 2;
  int32 estimated_tokens_saved = 3;
  string compaction_reason = 4;
}
```

**Use Cases**:
- Save important context before removal
- Log context management events
- Generate summaries
- Customize what gets kept

**Implementation Notes**:
- Execute before truncation, after detecting need
- Cannot prevent compaction (context must fit)
- Good for saving summaries or important data
- May be useful for future smart compaction strategies

---

## Summary: Task Count & Effort

### By Phase

| Phase | Tasks | Story Points | Duration |
|-------|-------|--------------|----------|
| Phase 0: Foundation | 4 | 13 | 2-3 weeks |
| Phase 1: Testing | 5 | 34 | 2-3 weeks |
| Phase 2: UX/Polish | 6 | 36 | 2-3 weeks |
| Phase 3: New Hooks | 6 | 30 | 3-4 weeks |
| **TOTAL** | **21** | **113** | **9-13 weeks** |

### By Priority

| Priority | Tasks | Story Points |
|----------|-------|--------------|
| P0 (Critical) | 7 | 36 |
| P1 (High) | 7 | 43 |
| P2 (Medium) | 6 | 29 |
| P3 (Low) | 2 | 5 |

---

## Linear Workflow Guide

### Step 1: Create Project & Milestones

**In Linear:**

1. **Create Project**: "Hooks System Foundation & Expansion"
   - Description: Complete hooks foundation, add testing, improve UX, implement 6 new hooks
   - Target Date: [13 weeks from start]
   - Status: In Progress

2. **Create Milestones**:
   - **Milestone 1**: "Foundation Complete" (3 weeks)
     - All Phase 0 tasks complete
     - Critical gaps fixed
     - Core capabilities functional
   
   - **Milestone 2**: "Quality Assured" (6 weeks)
     - All Phase 0 + Phase 1 tasks complete
     - Full test coverage
     - Verified correctness
   
   - **Milestone 3**: "Production Ready" (9 weeks)
     - All Phase 0 + 1 + 2 tasks complete  
     - Great UX
     - User documentation
     - Ready for wider adoption
   
   - **Milestone 4**: "Feature Complete" (13 weeks)
     - All phases complete
     - All 6 new hooks implemented
     - Full capability

---

### Step 2: Create Epic Structure

**Create these Epics in Linear:**

1. **Epic: Hooks Foundation**
   - Description: Fix critical gaps in existing hooks implementation
   - Milestone: Foundation Complete
   - Tasks: 0.1, 0.2, 0.3, 0.4

2. **Epic: Hooks Testing Infrastructure**
   - Description: Establish comprehensive testing for hooks system
   - Milestone: Quality Assured
   - Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

3. **Epic: Hooks UX & Discoverability**
   - Description: Make hooks visible, debuggable, and user-friendly
   - Milestone: Production Ready
   - Tasks: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6

4. **Epic: Task Lifecycle Hooks**
   - Description: Implement UserPromptSubmit, TaskStart, TaskResume hooks
   - Milestone: Feature Complete
   - Tasks: 3.1, 3.2, 3.3

5. **Epic: Task Completion Hooks**
   - Description: Implement TaskCancel, TaskComplete, PreCompact hooks
   - Milestone: Feature Complete
   - Tasks: 3.4, 3.5, 3.6

---

### Step 3: Create Tasks in Order

**IMPORTANT: Create tasks in this order to maintain dependencies**

#### Week 1-3: Phase 0 (Foundation)

**Start with Task 0.1** (highest priority, no dependencies):
```
Title: Implement Context Modification Injection
Epic: Hooks Foundation
Priority: P0
Size: 5 points
Labels: hooks, foundation, p0
Milestone: Foundation Complete

[Copy Description and Acceptance Criteria from PROJECT_PLAN.md Task 0.1]
```

**Then Task 0.2**:
```
Title: Add Global Hooks Directory Support
Epic: Hooks Foundation
Priority: P0
Size: 3 points
Labels: hooks, foundation, p0
Milestone: Foundation Complete

[Copy from PROJECT_PLAN.md Task 0.2]
```

**Then Task 0.3**:
```
Title: Fix Windows PowerShell Hook Support
Epic: Hooks Foundation
Priority: P1
Size: 2 points
Labels: hooks, foundation, windows, p1
Milestone: Foundation Complete

[Copy from PROJECT_PLAN.md Task 0.3]
```

**Finally Task 0.4**:
```
Title: Implement Hook Execution State Tracking
Epic: Hooks Foundation
Priority: P1
Size: 3 points
Labels: hooks, foundation, p1
Milestone: Foundation Complete
Blocks: Task 2.1, 2.3, 2.6

[Copy from PROJECT_PLAN.md Task 0.4]
```

#### Week 4-6: Phase 1 (Testing)

**Start with Task 1.1** (blocks all other testing tasks):
```
Title: Set Up Testing Infrastructure
Epic: Hooks Testing Infrastructure
Priority: P0
Size: 5 points
Labels: hooks, testing, infrastructure, p0
Milestone: Quality Assured
Blocks: Task 1.2, 1.3, 1.4, 1.5

[Copy from PROJECT_PLAN.md Task 1.1]
```

**Then Tasks 1.2 and 1.3** (can be worked in parallel):
```
Title: Write HookFactory Tests
Epic: Hooks Testing Infrastructure
Priority: P0
Size: 8 points
Labels: hooks, testing, p0
Milestone: Quality Assured
Blocked by: Task 1.1

[Copy from PROJECT_PLAN.md Task 1.2]
```

```
Title: Write HookRunner Tests
Epic: Hooks Testing Infrastructure
Priority: P0
Size: 8 points
Labels: hooks, testing, p0
Milestone: Quality Assured
Blocked by: Task 1.1

[Copy from PROJECT_PLAN.md Task 1.3]
```

**Then Task 1.4**:
```
Title: Write Integration Tests
Epic: Hooks Testing Infrastructure
Priority: P1
Size: 8 points
Labels: hooks, testing, integration, p1
Milestone: Quality Assured
Blocked by: Task 1.1, 1.2, 1.3

[Copy from PROJECT_PLAN.md Task 1.4]
```

**Finally Task 1.5**:
```
Title: Add Error Scenario Tests
Epic: Hooks Testing Infrastructure
Priority: P1
Size: 5 points
Labels: hooks, testing, error-handling, p1
Milestone: Quality Assured
Blocked by: Task 1.1, 1.2, 1.3

[Copy from PROJECT_PLAN.md Task 1.5]
```

#### Week 7-9: Phase 2 (UX)

**Task 2.1** (needs 0.4 complete first):
```
Title: Add Hook Execution UI Feedback
Epic: Hooks UX & Discoverability
Priority: P1
Size: 8 points
Labels: hooks, ui, ux, p1
Milestone: Production Ready
Blocked by: Task 0.4

[Copy from PROJECT_PLAN.md Task 2.1]
```

**Task 2.2** (can start anytime):
```
Title: Add Settings UI for Hooks Toggle
Epic: Hooks UX & Discoverability
Priority: P1
Size: 3 points
Labels: hooks, ui, settings, p1
Milestone: Production Ready

[Copy from PROJECT_PLAN.md Task 2.2]
```

**Task 2.3** (needs 0.4 complete):
```
Title: Implement Slow Hook Warnings
Epic: Hooks UX & Discoverability
Priority: P2
Size: 5 points
Labels: hooks, ux, performance, p2
Milestone: Production Ready
Blocked by: Task 0.4

[Copy from PROJECT_PLAN.md Task 2.3]
```

**Task 2.4** (needs 2.1 complete):
```
Title: Add Hooks Info to API Request Disclosure
Epic: Hooks UX & Discoverability
Priority: P2
Size: 5 points
Labels: hooks, ui, transparency, p2
Milestone: Production Ready
Blocked by: Task 2.1

[Copy from PROJECT_PLAN.md Task 2.4]
```

**Task 2.5** (can start anytime, helps 2.2):
```
Title: Create User Documentation
Epic: Hooks UX & Discoverability
Priority: P1
Size: 8 points
Labels: hooks, documentation, p1
Milestone: Production Ready

[Copy from PROJECT_PLAN.md Task 2.5]
```

**Task 2.6** (needs 0.4 complete):
```
Title: Add Telemetry for Hooks
Epic: Hooks UX & Discoverability
Priority: P2
Size: 5 points
Labels: hooks, telemetry, metrics, p2
Milestone: Production Ready
Blocked by: Task 0.4

[Copy from PROJECT_PLAN.md Task 2.6]
```

#### Week 10-13: Phase 3 (New Hooks)

**All Phase 3 tasks** should have:
- Milestone: Feature Complete
- Blocked by: All Phase 0, 1, 2 tasks

Create each task (3.1 through 3.6) using the template from PROJECT_PLAN.md.

---

### Step 4: Prioritize & Sequence Work

**Recommended Work Order:**

**Sprint 1-2 (Weeks 1-3): Foundation**
1. Start Task 0.1 (Critical path)
2. Parallel: Task 0.2, 0.3
3. Complete Task 0.4 (unblocks Phase 2)

**Sprint 3-4 (Weeks 4-6): Testing**
1. Start Task 1.1 (Blocks everything else)
2. Parallel: Task 1.2, 1.3 (Both need 1.1)
3. Parallel: Task 1.4, 1.5 (Both need 1.1-1.3)

**Sprint 5-6 (Weeks 7-9): UX**
1. Start Task 2.2, 2.5 (No dependencies)
2. Start Task 2.1 (After 0.4 complete)
3. Start Task 2.3, 2.6 (After 0.4 complete)
4. Complete Task 2.4 (After 2.1)

**Sprint 7-8 (Weeks 10-13): New Hooks**
1. Task 3.1, 3.2 (High value, blocking hooks)
2. Task 3.3, 3.5 (Medium value)
3. Task 3.4, 3.6 (Observability only)

---

### Step 5: Team Capacity Planning

**If 1 Developer:**
- Phase 0: 2-3 weeks
- Phase 1: 3 weeks
- Phase 2: 3 weeks  
- Phase 3: 3-4 weeks
- **Total: 11-13 weeks**

**If 2 Developers:**
- Phase 0: 2 weeks (parallel 0.2/0.3)
- Phase 1: 2 weeks (parallel 1.2/1.3, then 1.4/1.5)
- Phase 2: 2 weeks (parallel on independent tasks)
- Phase 3: 2 weeks (parallel hook implementation)
- **Total: 8 weeks**

**If 3+ Developers:**
- Can parallelize most tasks
- Watch for bottlenecks (Task 1.1 blocks Phase 1)
- **Total: 6-7 weeks**

---

### Step 6: Risk Management

**Critical Path Risks:**

1. **Context Modification Design** (Task 0.1)
   - Risk: Design choices affect all future hooks
   - Mitigation: Get PR review before merging
   - Impact: Could delay Phase 3

2. **Testing Infrastructure** (Task 1.1)
   - Risk: Blocks all Phase 1 work
   - Mitigation: Start early, get help if stuck
   - Impact: Delays quality assurance

3. **UI Integration Complexity** (Task 2.1)
   - Risk: May need webview message refactoring
   - Mitigation: Design messages upfront
   - Impact: Could delay Phase 2

**Mitigation Strategies:**

- **Technical Spikes**: Do 1-day spikes for Task 0.1 and 2.1 before committing
- **Early PR Reviews**: Get Phase 0 tasks reviewed quickly
- **Parallel Documentation**: Write docs while implementing (Task 2.5)
- **Regular Check-ins**: Review progress weekly against plan

---

### Step 7: Success Metrics

**Track these metrics to measure success:**

**Phase 0 Completion:**
- [ ] Context modification works in both PreToolUse and PostToolUse
- [ ] Global hooks directory discovered and executed
- [ ] Windows PowerShell hooks work (or documented limitation)
- [ ] Hook metrics tracked and accessible

**Phase 1 Completion:**
- [ ] Test coverage >80% for hooks code
- [ ] All hooks tests passing in CI
- [ ] Zero known bugs in hooks execution
- [ ] Integration tests cover real-world scenarios

**Phase 2 Completion:**
- [ ] Users can see hook execution in UI
- [ ] Settings toggle for hooks exists
- [ ] User documentation published
- [ ] Telemetry shows hook usage patterns

**Phase 3 Completion:**
- [ ] All 6 new hooks implemented
- [ ] Each hook has tests
- [ ] Documentation includes all hooks
- [ ] No performance regression (<100ms overhead)

---

### Step 8: Communication Plan

**Weekly Updates:**
- Share progress in team standup
- Update Linear task status
- Flag blockers immediately

**Milestone Reviews:**
- After each phase, demo to team
- Gather feedback from early users
- Adjust plan if needed

**Documentation:**
- Keep PROJECT_PLAN.md updated
- Update IMPLEMENTATION_GUIDE.md as needed
- Write user docs as features complete

---

## Quick Reference: What to Work on When

### RIGHT NOW (Critical Path)
1. **Task 0.1** - Context Modification Injection (P0, blocks future features)
2. **Task 0.2** - Global Hooks Directory (P0, core capability)

### NEXT (High Priority)
3. **Task 0.3** - Windows PowerShell Support (P1)
4. **Task 0.4** - Hook Execution Tracking (P1, blocks Phase 2 UI)
5. **Task 1.1** - Testing Infrastructure (P0, blocks all testing)

### AFTER FOUNDATION (Quality & UX)
6. **Task 1.2, 1.3** - Core tests (P0)
7. **Task 2.5** - User Documentation (P1, helps adoption)
8. **Task 2.2** - Settings Toggle (P1, discoverability)

### FINAL STRETCH (Polish & Expansion)
9. **Tasks 2.1, 2.3, 2.4, 2.6** - UI polish (P1-P2)
10. **Tasks 3.1-3.6** - New hooks (P2-P3)

---

## Conclusion

This plan provides:
- ✅ Clear phases with dependencies
- ✅ Detailed task breakdown for Linear
- ✅ Effort estimates and timelines
- ✅ Risk mitigation strategies
- ✅ Success metrics
- ✅ Prioritization guidance

**Key Takeaway**: Focus on **Foundation → Testing → UX → New Hooks** to deliver incrementally and maintain quality throughout.

The foundation work (Phase 0) is critical and should not be skipped. It fixes core gaps that affect even the current hooks. Testing (Phase 1) provides confidence for expansion. UX (Phase 2) ensures good experience before adding complexity. Only then are we ready to safely add 6 new hooks (Phase 3).

**Next Steps**:
1. Review this plan with the team
2. Create Linear project and epics
3. Start with Task 0.1 (Context Modification)
4. Work through phases sequentially
5. Ship incrementally, gather feedback
6. Celebrate milestones! 🎉
