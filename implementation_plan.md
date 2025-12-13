# Implementation Plan: Remove Unwanted Focus Stealing in Cline

## [Overview]
Eliminate focus stealing from the text editor when using Cline code actions and UI interactions.

Cline currently steals focus from the user's text editor in multiple scenarios: using code actions (Fix/Explain/Improve/Add to Cline), clicking the plus button, adding terminal output, and various UI events. This happens because `focusChatInput()` always calls the `FocusChatInput` command which shows the webview and triggers focus events. The solution adds an optional `preserveEditorFocus` parameter throughout the command chain that prevents focus stealing for background operations while allowing it for explicit user actions like keyboard shortcuts or clicking "Focus Chat Input".

## [Types]
Add optional preserveEditorFocus parameter to proto definitions.

**File: proto/cline/ui.proto**
Add new message type:
```protobuf
message FocusChatInputRequest {
  bool preserve_editor_focus = 1;  // When true, show webview without stealing focus
}
```

Update service method signature:
```protobuf
service UiService {
  // Change from: rpc subscribeToFocusChatInput(EmptyRequest) returns (stream Empty);
  // To: rpc subscribeToFocusChatInput(FocusChatInputRequest) returns (stream Empty);
}
```

After proto changes, run `npm run protos` to regenerate TypeScript types.

## [Files]
Modify 7 existing files to support preserveEditorFocus parameter.

**Files to modify:**

1. **proto/cline/ui.proto** - Add FocusChatInputRequest message and update service definition
2. **src/hosts/vscode/commandUtils.ts** - Add preserveEditorFocus parameter to focusChatInput() and getContextForCommand()
3. **src/extension.ts** - Update FocusChatInput command handler to respect preserveEditorFocus
4. **src/core/controller/ui/subscribeToFocusChatInput.ts** - Handle FocusChatInputRequest instead of EmptyRequest
5. **webview-ui/src/components/chat/ChatView.tsx** - Update focus event listener to respect preserveEditorFocus
6. **webview-ui/src/services/grpc-client.ts** - Update subscribeToFocusChatInput to accept FocusChatInputRequest
7. **src/extension.ts** - Update terminal output command to pass preserveEditorFocus: true

**No new files to create.**

## [Functions]
Modify focus-related functions to conditionally preserve editor focus.

**1. src/hosts/vscode/commandUtils.ts**
- **focusChatInput(preserveEditorFocus?: boolean)**: Add optional parameter (default false)
  - Pass parameter to FocusChatInput command via args
  - Current signature: `async function focusChatInput()`
  - New signature: `async function focusChatInput(preserveEditorFocus?: boolean)`

- **getContextForCommand()**: Pass `preserveEditorFocus: true` to focusChatInput()
  - This ensures code actions don't steal focus
  
**2. src/extension.ts**
- **FocusChatInput command handler**: Accept preserveEditorFocus argument
  - When true: Only ensure webview is visible without calling `.show(true)`
  - When false/undefined: Current behavior with `.show(true)` to force focus
  - Pass parameter to sendFocusChatInputEvent()
  
**3. src/core/controller/ui/subscribeToFocusChatInput.ts**
- **subscribeToFocusChatInput()**: Change parameter from EmptyRequest to FocusChatInputRequest
- **sendFocusChatInputEvent(preserveEditorFocus?: boolean)**: Add optional parameter
  - Include preserveEditorFocus in the event sent to subscribers
  
**4. webview-ui/src/components/chat/ChatView.tsx**
- **focusChatInput event listener**: Modify to respect preserveEditorFocus from event
  - Only focus textarea if preserveEditorFocus is false/undefined
  - Keep webview visibility changes regardless

**5. src/extension.ts (Terminal Output command)**
- **TerminalOutput command handler**: Pass `preserveEditorFocus: true` when calling focusChatInput

## [Classes]
No new classes needed; existing classes will have methods updated.

**Modified class methods:**

1. **VscodeWebviewProvider** (src/hosts/vscode/VscodeWebviewProvider.ts)
   - May need `show(preserveFocus?: boolean)` helper method if not using command
   - Likely no changes needed if using command-based approach

## [Dependencies]
No new dependencies required.

This implementation uses existing infrastructure:
- Protobuf for type-safe message passing
- Existing command registration system
- Current gRPC streaming subscriptions
- Existing webview communication patterns

## [Testing]
Manual testing of all affected code paths.

**Test scenarios:**
1. **Code Actions** - Right-click code → Fix/Explain/Improve/Add to Cline
   - Verify: Webview shows content but editor stays focused
   
2. **Terminal Output** - Select terminal text → Add to Cline command
   - Verify: Content added to chat but editor stays focused
   
3. **Plus Button** - Click plus button in Cline sidebar
   - Verify: Task cleared, webview shown, but editor stays focused (if open)
   
4. **Focus Chat Input Command** - Use keyboard shortcut or command palette
   - Verify: Webview shows AND steals focus (expected behavior)
   
5. **Extension Startup** - Open VS Code with Cline
   - Verify: Cline initializes without stealing focus

6. **Switching Views** - Navigate between Settings/History/Chat
   - Verify: View changes don't steal focus from editor

**Test each scenario:**
- With editor actively focused
- With multiple editor splits
- With Cline already visible vs. hidden

## [Implementation Order]
Complete changes in logical dependency order.

1. **Update Proto Definition** (proto/cline/ui.proto)
   - Add FocusChatInputRequest message
   - Update subscribeToFocusChatInput service method
   - Run `npm run protos` to generate TypeScript types

2. **Update Backend Subscription Handler** (src/core/controller/ui/subscribeToFocusChatInput.ts)
   - Change function signature to use FocusChatInputRequest
   - Update sendFocusChatInputEvent to accept and pass preserveEditorFocus parameter

3. **Update Command Utilities** (src/hosts/vscode/commandUtils.ts)
   - Add preserveEditorFocus parameter to focusChatInput()
   - Update getContextForCommand() to pass preserveEditorFocus: true

4. **Update Extension Command Handlers** (src/extension.ts)
   - Modify FocusChatInput command to accept preserveEditorFocus argument
   - Conditionally show webview based on parameter
   - Pass parameter to sendFocusChatInputEvent()
   - Update TerminalOutput command to pass preserveEditorFocus: true

5. **Update Webview gRPC Client** (webview-ui/src/services/grpc-client.ts)
   - Update subscribeToFocusChatInput to accept FocusChatInputRequest

6. **Update Webview Component** (webview-ui/src/components/chat/ChatView.tsx)
   - Modify focusChatInput event listener to respect preserveEditorFocus
   - Only focus textarea when preserveEditorFocus is false/undefined

7. **Test All Scenarios**
   - Follow testing plan above
   - Verify no regressions in focus behavior
   - Confirm editor focus is preserved in all non-explicit cases
