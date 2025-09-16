# Cline Hook System Integration Design Document

## Executive Summary
This document outlines the design and implementation plan for integrating a Claude-compatible hook system into Cline. The hook system will allow users to intercept and modify tool executions, add custom validations, and extend Cline's functionality through external scripts.

## Compatibility Requirements

### Full Claude Hook Compatibility
Based on analysis of existing implementations, Cline's hook system will maintain **100% compatibility** with Claude's hook format and execution model. This ensures:

1. **Existing Claude hooks can be used directly**
   - The existing `/Users/griever/Developer/agent-hooks/src/claude-hook.ts` will work without modification
   - Uses the same MinimalHook base class that handles stdin/stdout JSON communication
   - Maintains the same event structure and response format

2. **Integration with Agent Manager**
   - Compatible with the centralized hook management described in `/Users/griever/Developer/agent-manager/HOOKS_CONFIGURATION_REFACTOR.md`
   - Hooks can be registered through the manager using the same NPX commands:
     ```bash
     npx @principal-ai/agent-hooks cline-hook --enable
     npx @principal-ai/agent-hooks cline-hook --disable
     npx @principal-ai/agent-hooks cline-hook --status
     ```
   - Configuration will follow Claude's format in `~/.cline/hooks.json`

3. **Event Bridge Compatibility**
   - Supports the same HTTP bridge mechanism on port 3043 (configurable)
   - Falls back to file storage using the same patterns
   - Compatible with the MinimalHook class's dual HTTP/file mode

### Configuration Format (Claude-Compatible)
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /path/to/claude-hook.cjs",
        "timeout": 60
      }]
    }],
    "PostToolUse": [{
      "matcher": "write_to_file|replace_in_file",
      "hooks": [{
        "type": "command",
        "command": "claude-hook --port 3043 --dir ~/.cline/hook-events"
      }]
    }]
  }
}
```

### Hook Event Structure (Identical to Claude)
All events will include the same base fields:
- `session_id`: Task ID in Cline context
- `transcript_path`: Path to conversation log
- `cwd`: Current working directory
- `hook_event_name`: Event type (PreToolUse, PostToolUse, etc.)
- Tool-specific fields matching Claude's structure exactly

## Architecture Overview

### Core Components
1. **HookManager** - Central orchestrator for all hook operations
2. **HookExecutor** - Handles shell command execution with timeout and error handling
3. **HookConfiguration** - Manages hook configuration loading and validation
4. **Event Processors** - Transform Cline events to Claude-compatible format
5. **Integration Layer** - Minimal modifications to existing Cline components

## Agent Manager Integration

### Registration Through NPX Package
Cline will integrate with the existing `@principal-ai/agent-hooks` NPX package infrastructure:

1. **Hook Installation**
   ```bash
   # Add Cline entry to SupportedAgent enum in agent-hooks package
   export enum SupportedAgent {
     CLAUDE = 'claude',
     GEMINI = 'gemini',
     OPENCODE = 'opencode',
     CLINE = 'cline'  // New addition
   }
   ```

2. **Agent Info Configuration**
   ```typescript
   // In agent-hooks/src/minimal-hook.ts
   [SupportedAgent.CLINE]: {
     displayName: 'Cline',
     bridgeRoute: 'cline-hook',
     fallbackFileName: 'cline-hook-events.json',
     errorFileName: 'cline-hook-events-errors.json'
   }
   ```

3. **Configuration Management**
   - Cline will store hooks in `~/.cline/hooks.json` (similar to Claude's `~/.claude/settings.json`)
   - The agent-manager will handle enabling/disabling hooks via its existing UI
   - No deviation from Claude's JSON structure needed

### HTTP Bridge & File Fallback
Cline will support the same dual-mode operation as other agents:

1. **HTTP Mode** (Primary)
   - Listen on configurable ports (default 3043)
   - Route: `/cline-hook`
   - Same JSON event format over HTTP POST

2. **File Mode** (Fallback)
   - Write to `~/.cline/hook-events/cline-hook-events.json`
   - Errors to `~/.cline/hook-events/cline-hook-events-errors.json`
   - Identical file structure to Claude implementation

## Implementation Milestones

### Milestone 1: Foundation & Event System
**Goal**: Establish core hook infrastructure and event type system

#### Tasks:
1. **Create Hook Type Definitions**
   - Location: `src/core/hooks/types/`
   - Reference: `/Users/griever/Developer/agent-monitoring/src/event-processors/claude/claude-hook-types.ts:10-96`
   - Define all Claude event types (PreToolUse, PostToolUse, etc.)

2. **Implement HookConfiguration Loader**
   - Location: `src/core/hooks/HookConfiguration.ts`
   - Support for `.cline/hooks.json` (similar to Claude's `.claude/hooks.json`)
   - Reference: Claude docs configuration structure

3. **Create Event Transformation Layer**
   - Location: `src/core/hooks/EventTransformer.ts`
   - Reference: `/Users/griever/Developer/agent-monitoring/src/event-processors/claude/ClaudeEventProcessor.ts:31-152`
   - Map Cline's ToolUse to Claude hook event format

#### Deliverables:
- Type-safe hook event definitions
- Configuration schema and loader
- Event transformation utilities

---

### Milestone 2: Hook Execution Engine
**Goal**: Build the core hook execution mechanism

#### Tasks:
1. **Implement HookExecutor**
   - Location: `src/core/hooks/HookExecutor.ts`
   - Shell command execution using existing `execa` dependency
   - Reference: `/Users/griever/Developer/cline/src/core/task/index.ts:66` (execa usage)
   - 60-second timeout (matching Claude's default)
   - JSON input via stdin, JSON/exit code output handling

2. **Create HookManager**
   - Location: `src/core/hooks/HookManager.ts`
   - Pattern matching for tool names
   - Parallel hook execution
   - Response aggregation and conflict resolution

3. **Add Hook Response Handlers**
   - Location: `src/core/hooks/handlers/`
   - Handle approve/deny responses
   - Process context additions
   - Apply input/output modifications

#### Deliverables:
- Working hook executor with timeout handling
- Manager for coordinating multiple hooks
- Response processing system

---

### Milestone 3: PreToolUse & PostToolUse Integration
**Goal**: Integrate hooks into the tool execution pipeline

#### Critical Compatibility Note:
The hook system MUST maintain exact compatibility with Claude's event structure to ensure existing hooks work without modification. This means:
- Same JSON field names and structure
- Same stdin/stdout communication protocol
- Same exit code handling (0 = approve, non-zero = deny)
- Same timeout behavior (60 seconds default)

#### Integration Points:

1. **PreToolUse Hook Integration**
   - File: `/Users/griever/Developer/cline/src/core/task/ToolExecutor.ts:396`
   - Add before `this.coordinator.execute(config, block)`
   - Pass tool name and input to hooks
   - Handle deny/modify responses

2. **PostToolUse Hook Integration**
   - File: `/Users/griever/Developer/cline/src/core/task/ToolExecutor.ts:398`
   - Add after `await this.coordinator.execute(config, block)`
   - Include tool response in hook data
   - Allow response modification

3. **Update ToolExecutorCoordinator**
   - File: `/Users/griever/Developer/cline/src/core/task/tools/ToolExecutorCoordinator.ts:74-81`
   - Add hook injection points in `execute()` method
   - Maintain backward compatibility

#### Tool Mapping Reference:
| Cline Tool (from `src/shared/tools.ts:2-24`) | Claude Tool | Handler Location |
|---|---|---|
| `read_file` | Read | `src/core/task/tools/handlers/ReadFileToolHandler.ts` |
| `write_to_file` | Write | `src/core/task/tools/handlers/WriteToFileToolHandler.ts` |
| `replace_in_file` | Edit | `src/core/task/tools/handlers/WriteToFileToolHandler.ts` |
| `execute_command` | Bash | `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts` |
| `search_files` | Grep | `src/core/task/tools/handlers/SearchFilesToolHandler.ts` |
| `list_files` | Glob | `src/core/task/tools/handlers/ListFilesToolHandler.ts` |
| `web_fetch` | WebFetch | `src/core/task/tools/handlers/WebFetchToolHandler.ts` |

#### Deliverables:
- Working PreToolUse hooks for all tools
- Working PostToolUse hooks with response access
- Tool execution can be blocked/modified by hooks

---

### Milestone 4: Session & User Input Hooks
**Goal**: Add hooks for session lifecycle and user interactions

#### Tasks:

1. **UserPromptSubmit Hook**
   - Integration point: User message processing in Task class
   - Reference: `/Users/griever/Developer/cline/src/core/task/index.ts` (Task constructor and message handling)
   - Trigger before API calls
   - Allow prompt modification

2. **SessionStart Hook**
   - Integration point: Task initialization
   - Reference: Task constructor in `/Users/griever/Developer/cline/src/core/task/index.ts:92-100`
   - Include source type (startup/resume/clear)

3. **Stop/SubagentStop Hooks**
   - Integration point: Task completion
   - Reference: Task completion handling
   - Differentiate between main task and subtask completion

#### Deliverables:
- User input interception and modification
- Session lifecycle tracking
- Task completion notifications

---

### Milestone 5: Advanced Features
**Goal**: Implement remaining hook types and advanced features

#### Tasks:

1. **Notification Hook**
   - Create notification event system
   - Integration with VS Code notifications
   - Reference: `/Users/griever/Developer/cline/src/integrations/notifications/showSystemNotification.ts`

2. **PreCompact Hook**
   - Integration point: Context management
   - Reference: `/Users/griever/Developer/cline/src/core/context/context-management/ContextManager.ts`
   - Trigger before context window compaction

3. **Hook Debugging & Testing**
   - Add `--debug` flag support for hook execution logs
   - Create test harness for hook development
   - Reference: `/Users/griever/Developer/cline/src/test/` for test patterns

#### Deliverables:
- Complete hook type coverage
- Debugging capabilities
- Test framework for hooks

---

### Milestone 6: Configuration & User Experience
**Goal**: Polish the hook system for end users

#### Tasks:

1. **Configuration UI**
   - Add hooks configuration to VS Code settings
   - Reference: `/Users/griever/Developer/cline/src/core/webview/WebviewProvider.ts` for UI integration
   - Create hook management commands

2. **Documentation & Examples**
   - Write user documentation
   - Create example hooks for common use cases
   - Add to Cline's README and docs

3. **Error Handling & Recovery**
   - Graceful handling of hook failures
   - User-friendly error messages
   - Hook timeout configuration

#### Deliverables:
- User-friendly configuration interface
- Comprehensive documentation
- Robust error handling

---

## Technical Considerations

### Performance
- Hooks run with 60-second timeout by default
- Parallel execution for multiple matching hooks
- Minimal overhead when no hooks configured

### Security
- Hooks execute arbitrary shell commands
- Recommend validation of hook scripts
- Consider sandboxing options for future releases

### Compatibility
- Maintain backward compatibility with existing Cline functionality
- Support Claude hook format for easy migration
- Extensible design for future hook types

### Dependencies
- Existing: `execa` for shell execution
- Existing: VS Code API for notifications and UI
- No new external dependencies required

## Testing Strategy

1. **Unit Tests**
   - Hook executor with various response types
   - Configuration loading and validation
   - Event transformation accuracy

2. **Integration Tests**
   - Tool execution with hooks
   - Hook blocking and modification
   - Multiple hook coordination

3. **E2E Tests**
   - Full workflow with hooks configured
   - Error scenarios and recovery
   - Performance benchmarks

## Migration Path

For users migrating from Claude:
1. Copy `.claude/hooks.json` to `.cline/hooks.json`
2. Update any Claude-specific paths or commands
3. Test hooks with `--debug` flag
4. Adjust timeout settings if needed

## Success Criteria

- [ ] All Claude hook types implemented with exact field compatibility
- [ ] Existing claude-hook.ts works without modification
- [ ] Integration with agent-manager NPX package functional
- [ ] Minimal performance impact (<100ms overhead per hook)
- [ ] 100% backward compatibility maintained
- [ ] Comprehensive test coverage (>80%)
- [ ] User documentation complete
- [ ] Example hooks provided

## Timeline Estimate

- Milestone 1: 1 week
- Milestone 2: 1 week
- Milestone 3: 2 weeks
- Milestone 4: 1 week
- Milestone 5: 1 week
- Milestone 6: 1 week

**Total: 7 weeks**

## Appendix: File References

### Existing Hook Infrastructure
- MinimalHook base: `/Users/griever/Developer/agent-hooks/src/minimal-hook.ts`
- Claude hook wrapper: `/Users/griever/Developer/agent-hooks/src/claude-hook.ts`
- Manager configuration: `/Users/griever/Developer/agent-manager/HOOKS_CONFIGURATION_REFACTOR.md`

### Key Cline Files
- Tool execution: `/Users/griever/Developer/cline/src/core/task/ToolExecutor.ts`
- Tool coordination: `/Users/griever/Developer/cline/src/core/task/tools/ToolExecutorCoordinator.ts`
- Tool definitions: `/Users/griever/Developer/cline/src/shared/tools.ts`
- Task management: `/Users/griever/Developer/cline/src/core/task/index.ts`

### Reference Implementation
- Event processor: `/Users/griever/Developer/agent-monitoring/src/event-processors/claude/ClaudeEventProcessor.ts`
- Hook types: `/Users/griever/Developer/agent-monitoring/src/event-processors/claude/claude-hook-types.ts`
- Claude documentation: `https://docs.anthropic.com/en/docs/claude-code/hooks`