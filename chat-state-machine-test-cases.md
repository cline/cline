# Chat State Machine Test Cases

## 1. Basic Message Sending

### No Task State
- [ ] Send a message when there's no task (should create a new task)
- [ ] Send only images when there's no task
- [ ] Send only files when there's no task
- [ ] Send message + images + files when there's no task
- [ ] Press Enter with empty input (should do nothing)
- [ ] Press Enter with only whitespace (should do nothing)

### With Active Task
- [ ] Send a regular text message
- [ ] Send message with images
- [ ] Send message with files
- [ ] Send message with both images and files
- [ ] Send message that hits the 20 image/file limit
- [ ] Send message while previous message is still streaming

## 2. Mode Switching

### Plan/Act Toggle
- [ ] Toggle from Plan to Act mode with empty input
- [ ] Toggle from Act to Plan mode with empty input
- [ ] Toggle mode with text in input (should send message)
- [ ] Toggle mode with images selected
- [ ] Toggle mode with files selected
- [ ] Toggle mode with text + images + files
- [ ] Toggle mode using keyboard shortcut (Cmd/Ctrl+Shift+A)
- [ ] Toggle mode while API response is streaming
- [ ] Toggle mode while model selector is open (should save config first)
- [ ] Toggle mode during tool approval state

## 3. Button Interactions

### Primary Button (Approve/Run)
- [ ] Click primary button with no additional input
- [ ] Click primary button with text in input field
- [ ] Click primary button with images/files selected
- [ ] Click primary button during different ask states:
  - [ ] Tool approval
  - [ ] Command approval
  - [ ] API request failed
  - [ ] Completion result
  - [ ] Resume completed task

### Secondary Button (Reject/Cancel)
- [ ] Click secondary button with no input
- [ ] Click secondary button with text input
- [ ] Click secondary button while streaming (should cancel)
- [ ] Click secondary button during different states:
  - [ ] Tool approval
  - [ ] Command approval
  - [ ] API request failed
  - [ ] Auto approval limit reached

## 4. Input State Management

### Text Input
- [ ] Type and clear text multiple times
- [ ] Use quotes/context (activeQuote)
- [ ] Clear quote and type new message
- [ ] Paste large amounts of text
- [ ] Use @ mentions
- [ ] Use / slash commands
- [ ] Mix mentions and slash commands

### File/Image Management
- [ ] Add images one by one
- [ ] Add files one by one
- [ ] Remove individual images/files
- [ ] Clear all images/files at once
- [ ] Drag and drop images
- [ ] Drag and drop files
- [ ] Paste images from clipboard
- [ ] Try to exceed 20 item limit

## 5. State Transitions

### Streaming States
- [ ] Start typing while AI is responding
- [ ] Try to send message while streaming
- [ ] Cancel during streaming
- [ ] Mode toggle during streaming
- [ ] Add images/files during streaming

### Error States
- [ ] API request fails - retry
- [ ] API request fails - cancel
- [ ] Mistake limit reached
- [ ] Auto approval limit reached
- [ ] Network disconnection during request

## 6. Task Management

### New Task Creation
- [ ] Start new task from home screen
- [ ] Start new task after completion
- [ ] Start new task after error
- [ ] Close task and start new one
- [ ] Start new task with context from previous

### Task Resumption
- [ ] Resume interrupted task
- [ ] Resume completed task
- [ ] Resume task with pending tool approval
- [ ] Resume task that was streaming

## 7. Complex Workflows

### Multi-step Interactions
- [ ] Type message → Add image → Remove image → Send
- [ ] Start typing → Toggle mode → Continue typing → Send
- [ ] Type message → Cancel → Type new message → Send
- [ ] Approve tool → Type feedback → Send
- [ ] Reject tool → Provide alternative → Send

### Rapid Actions
- [ ] Send multiple messages quickly
- [ ] Toggle mode multiple times rapidly
- [ ] Add/remove files rapidly
- [ ] Switch between buttons quickly

## 8. Edge Cases with External Events

### Browser/System Events
- [ ] Receive new message while typing
- [ ] Window loses focus while typing
- [ ] Browser refresh with text in input
- [ ] Extension reload with active task
- [ ] Multiple Cline windows open

### Concurrent Operations
- [ ] Terminal command running + try to send message
- [ ] Browser action active + try to send message
- [ ] File operation in progress + user input
- [ ] MCP server request + user interaction

## 9. Special Input Cases

### Context and Mentions
- [ ] @ mention at start of message
- [ ] @ mention in middle of message
- [ ] Multiple @ mentions
- [ ] Invalid @ mention paths
- [ ] / command at start
- [ ] / command with parameters
- [ ] Invalid / commands

### Quote Handling
- [ ] Set quote → Send message
- [ ] Set quote → Clear quote → Send
- [ ] Set quote → Toggle mode
- [ ] Multiple quotes in succession

## 10. Performance and Stress Tests

### Large Data
- [ ] Very long message (10000+ characters)
- [ ] Maximum images (20)
- [ ] Large image files
- [ ] Many mentions in one message

### Rapid State Changes
- [ ] Spam Enter key
- [ ] Rapidly toggle between modes
- [ ] Quick approve/reject cycles
- [ ] Fast typing with immediate send

## 11. Accessibility and Keyboard Navigation

### Keyboard-only Usage
- [ ] Tab through all controls
- [ ] Use Enter to send
- [ ] Use Escape to cancel
- [ ] Navigate context menu with arrows
- [ ] Select mentions with keyboard

### Screen Reader Compatibility
- [ ] All buttons have proper labels
- [ ] State changes are announced
- [ ] Error messages are accessible

## 12. Model/API Configuration

### Model Switching
- [ ] Change model and send message
- [ ] Change provider and send message
- [ ] Invalid API key handling
- [ ] Model doesn't support images - try sending images
- [ ] Switch between models mid-conversation

## 13. Error Recovery

### Graceful Degradation
- [ ] API timeout - recovery options
- [ ] Invalid response format
- [ ] Partial message received
- [ ] Connection lost mid-stream
- [ ] Rate limit exceeded

### State Consistency
- [ ] Ensure UI state matches actual state after errors
- [ ] Verify button states after failures
- [ ] Check input preservation after errors
- [ ] Confirm proper cleanup after cancellation

## 14. Browser-specific Tests

### Different Browsers
- [ ] Chrome/Edge behavior
- [ ] Firefox behavior
- [ ] Safari behavior (if applicable)

### Browser States
- [ ] Incognito/Private mode
- [ ] With extensions that might interfere
- [ ] Different zoom levels
- [ ] Small window sizes

## 15. Integration Points

### VSCode Integration
- [ ] File selection from explorer
- [ ] Drag files from VSCode
- [ ] Terminal output integration
- [ ] Problems panel integration

### MCP Servers
- [ ] MCP tool approval flow
- [ ] MCP resource access
- [ ] MCP server disconnection
- [ ] Multiple MCP servers active

## Testing Strategy

1. **Start with basic flows** - Ensure fundamental operations work
2. **Test state transitions** - Verify all states transition correctly
3. **Test error cases** - Ensure graceful error handling
4. **Test edge cases** - Try unusual combinations
5. **Performance test** - Ensure responsive under load
6. **Integration test** - Verify all parts work together

## Debug Checklist

When testing, monitor console for:
- [ ] State machine transitions logged correctly
- [ ] Effects executed as expected
- [ ] No infinite loops or repeated effects
- [ ] Proper cleanup after operations
- [ ] Memory leaks (long sessions)
- [ ] Network request completion

## Regression Tests

After fixes, always verify:
- [ ] Basic send still works
- [ ] Mode toggle still works
- [ ] Buttons still respond
- [ ] Input state preserved correctly
- [ ] No new console errors
