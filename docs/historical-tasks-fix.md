# Historical Tasks Rendering Bug Fix

## Problem Description

Historical (completed) tasks were not displaying their chat history when reopened from the task list. Users would click on a historical task and see an empty chat area with only "Zero-sized element" warnings from react-virtuoso.

### Symptoms

1. **New tasks worked fine** - Chat messages displayed normally during task execution
2. **Historical tasks failed** - After closing and reopening a task, the chat history was blank
3. **React Virtuoso errors** - Console showed repeated "Zero-sized element, this should not happen" warnings
4. **No component rendering** - ChatRow components mounted but returned 0 height

### Root Cause

The bug was in the `MessageRenderer` component's logic for handling `api_req_started` messages. The code had a "Deterministic flash fix" that would absorb (hide) api_req_started messages that were followed by low-stakes tools, expecting them to be included in a tool group.

```typescript
// BEFORE (Buggy code)
if (messageOrGroup.say === "api_req_started" && 
    isApiReqAbsorbable(messageOrGroup.ts, modifiedMessages)) {
    return null  // Hide the message, expecting tool group to show it
}
```

For historical/completed tasks, this created a scenario where:

1. **api_req_started at end of list** → `isApiReqAbsorbable` returned `true` (it saw low-stakes tools after it)
2. **MessageRenderer returned null** → The message was hidden
3. **Tool group was never created** → Because the message was at index 6 of 7 messages (near end)
4. **Result: Zero-sized element** → React Virtuoso tried to render a div with no content

### Debug Process

We added logging at multiple levels to trace the issue:

1. **ChatRow level** - No logs appeared (component never called)
2. **MessageRenderer level** - Logged `[MessageRenderer]` showing api_req_started being processed
3. **isApiReqAbsorbable level** - Showed `willAbsorb: true` for historical task messages
4. **ToolGroupRenderer level** - Never appeared (tool group not created)

This confirmed the api_req was being hidden without a replacement, causing the zero-height render.

## The Fix

Added a check to prevent absorption of messages near the end of the message list:

```typescript
// AFTER (Fixed code)
if (messageOrGroup.say === "api_req_started" && 
    index < groupedMessages.length - 1 &&  // NEW: Don't absorb near-end messages
    isApiReqAbsorbable(messageOrGroup.ts, modifiedMessages)) {
    return null
}
```

### Why This Works

- **For active tasks**: Messages in the middle of the list that are followed by tools still get absorbed correctly (no UI flash)
- **For historical tasks**: The final api_req_started (at or near the end) is NOT absorbed, so it renders normally with its thinking block UI
- **For all tasks**: Prevents hiding messages when there's no subsequent content to create a tool group

## Files Modified

### MessageRenderer.tsx

```typescript
// webview-ui/src/components/chat/chat-view/components/messages/MessageRenderer.tsx

// Added index check before absorbing api_req_started
if (messageOrGroup.say === "api_req_started" && 
    index < groupedMessages.length - 1 && 
    isApiReqAbsorbable(messageOrGroup.ts, modifiedMessages)) {
    return null
}
```

## Testing

After the fix:

- ✅ **New tasks continue to work** - Messages display during execution
- ✅ **Historical tasks now display** - Chat history shows when reopening tasks
- ✅ **No zero-sized element errors** - React Virtuoso renders properly
- ✅ **Thinking blocks render** - api_req_started messages show with their UI

## Related Changes

As part of fixing this issue, we also:

1. **Added missing props** to ChatRowProps (mode, reasoningContent, responseStarted, isRequestInProgress)
2. **Added thinking block components** (TypewriterText, BlinkingCursor, ThinkingBlock)
3. **Merged completion output UI** from task-completed-ui branch
4. **Created ExpandHandle component** for consistent expand/collapse UI

## Lessons Learned

1. **Absorption logic needs bounds checking** - Don't absorb messages at the end of a list if there's no subsequent content
2. **Debug logging is essential** - Multi-level logging helped identify exactly where messages disappeared
3. **Tool grouping can cause message loss** - If grouping logic fails to create a group, absorbed messages vanish
4. **Historical vs active tasks behave differently** - Logic that works for streaming may fail for completed tasks

## Commit History

- `7b7e61d49` - fix: prevent absorption of api_req_started at end of message list
- `adfea3f34` - feat: apply stash changes and clean up debug logs  
- `7d8e13809` - feat: restore PlanCompletionOutput and create ExpandHandle component
- `cad613991` - feat: use CopyButton in PlanCompletionOutput
