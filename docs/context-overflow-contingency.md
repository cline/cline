# Context Overflow Contingency

This feature allows modes to automatically handle context overflow situations by exiting subtasks with customizable messages when the token window is exceeded.

## Overview

When working with browser interactions or other tools that can return large amounts of content, the context window can overflow, causing the AI to get stuck. The Context Overflow Contingency feature provides a way to gracefully handle these situations by:

1. Monitoring context token usage
2. Detecting when the context window is approaching its limit
3. Automatically exiting subtasks with a customizable message
4. Optionally restricting the contingency to specific tools

## Configuration

The feature is configured at the mode level using the `contextOverflowContingency` property:

```typescript
{
  slug: "my-mode",
  name: "My Mode",
  roleDefinition: "...",
  groups: ["browser"],
  contextOverflowContingency: {
    enabled: true,
    message: "Task failed because of a context overflow, possibly because webpage returned from the browser was too big",
    triggerTools: ["browser_action"] // Optional: only trigger for specific tools
  }
}
```

### Configuration Options

- **`enabled`** (boolean): Whether the context overflow contingency is active for this mode
- **`message`** (string, optional): Custom message to display when context overflow occurs. If not provided, a default message will be used
- **`triggerTools`** (string[], optional): Array of tool names that should trigger the contingency. If not provided, any tool can trigger it

## How It Works

1. **Token Monitoring**: The system continuously monitors the context token usage during task execution
2. **Threshold Detection**: When tokens exceed 90% of the context window minus reserved tokens, overflow is detected
3. **Tool Filtering**: If `triggerTools` is configured, the contingency only triggers for those specific tools
4. **Subtask Completion**: For subtasks, the system calls `finishSubTask()` with the configured message
5. **Main Task Handling**: For main tasks, an error message is displayed

## Usage Examples

### Browser-Focused Mode

```typescript
{
  slug: "browser-expert",
  name: "🌐 Browser Expert",
  roleDefinition: "You are an expert at browser automation and web scraping.",
  groups: ["browser", "read"],
  contextOverflowContingency: {
    enabled: true,
    message: "Browser task failed due to context overflow - webpage content was too large",
    triggerTools: ["browser_action"]
  }
}
```

### General Purpose Mode

```typescript
{
  slug: "general",
  name: "🔧 General",
  roleDefinition: "You are a general-purpose assistant.",
  groups: ["read", "edit", "browser", "command"],
  contextOverflowContingency: {
    enabled: true,
    message: "Task failed due to context overflow - please try with smaller content"
  }
}
```

## Implementation Details

### ContextOverflowHandler Class

The `ContextOverflowHandler` class manages the overflow detection and contingency triggering:

- **`recordToolUse(toolName: string)`**: Records the last tool used for filtering
- **`shouldTriggerContingency(contextTokens, contextWindow, maxTokens)`**: Determines if contingency should trigger
- **`triggerContingency()`**: Executes the contingency action

### Integration Points

1. **Task Class**: Each task has a `contextOverflowHandler` instance
2. **Token Monitoring**: Integrated into the `attemptApiRequest` method
3. **Tool Tracking**: Tool usage is recorded in `recordToolUsage` method

## Benefits

1. **Prevents Stuck Tasks**: Automatically handles situations where the AI would otherwise get stuck
2. **Customizable Messages**: Allows mode creators to provide context-specific error messages
3. **Tool-Specific Control**: Can be configured to only trigger for problematic tools
4. **Graceful Degradation**: Provides a clean way to exit subtasks and return control to parent tasks

## Testing

The feature includes comprehensive unit tests covering:

- Tool usage recording
- Contingency triggering logic
- Message customization
- Tool-specific filtering
- Subtask vs main task handling

Run tests with:

```bash
npm test src/core/context-overflow/__tests__/ContextOverflowHandler.test.ts
```

## Future Enhancements

Potential improvements could include:

1. **Dynamic Thresholds**: Allow configurable overflow thresholds per mode
2. **Retry Logic**: Attempt to reduce context before triggering contingency
3. **Tool-Specific Messages**: Different messages for different tools
4. **Telemetry**: Track overflow occurrences for analysis
