---
title: "UI Navigation Refactoring Guide for Cline"
description: "A comprehensive guide for refactoring Cline's UI navigation system from extension message-based navigation to React state management"
---



This guide provides context for refactoring Cline's UI navigation system, moving from extension message-based navigation to React state management using context and custom hooks.

## Key Files and Structure

### Message Types

Message types define the communication between the extension and webview.

- `src/shared/WebviewMessage.ts` - TypeScript interface defining the messages sent from webview to extension
  - Contains message types that should be removed in favor of direct navigation functions
  - Example: `"showChatView"` should be replaced with `navigateToChat()`

- `src/shared/ExtensionMessage.ts` - TypeScript interface defining the messages sent from extension to extension
  - Contains navigation actions that will be handled by ExtensionStateContext
  - Example: `action: "mcpButtonClicked"` triggers MCP view navigation

### Controller and Context

- `src/core/controller/index.ts` - Main controller that handles messages from the webview
  - Processes incoming WebviewMessages
  - Sends navigation commands via ExtensionMessages
  - Contains handlers that will be removed after refactoring

- `webview-ui/src/context/ExtensionStateContext.tsx` - React context for managing UI state
  - Maintains navigation state (which views are visible)
  - Provides navigation functions through the context (navigateToMcp, navigateToSettings, etc.)
  - Handles incoming extension messages for navigation

### Components

- `webview-ui/src/components/cline-rules/ClineRulesToggleModal.tsx` - Example component using direct message posting
  - Currently uses `vscode.postMessage()` directly for some actions
  - Should be updated to use navigation functions from ExtensionStateContext directly

- `webview-ui/src/components/chat/ServersToggleModal.tsx` - Example of refactored component
  - Uses `navigateToMcp()` directly from ExtensionStateContext
  - No longer depends on separate navigation hooks

## Understanding the Navigation Patterns

### Pattern 1: Webview-to-Extension-to-Webview (To Be Refactored)

This pattern occurs when a component wants to navigate to a different view:

1. Component sends a message to the extension: `vscode.postMessage({ type: "showChatView" })`
2. Extension controller processes it: `case "showChatView"`
3. Controller sends a navigation action back: `this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })`
4. ExtensionStateContext handles the action and updates state: `case "chatButtonClicked": navigateToChat()`

**Example from the code:**

```typescript
// WebviewMessage.ts - Message type to be removed
| "showChatView"

// controller/index.ts - Handler to be removed
case "showChatView": {
  this.postMessageToWebview({
    type: "action",
    action: "chatButtonClicked",
  })
  break
}

// ExtensionStateContext.tsx - Handling that will remain
case "chatButtonClicked":
  navigateToChat()
  break
```

### Pattern 2: Extension-Initiated Navigation (Must Remain)

This pattern occurs when the extension needs to control navigation:

1. Extension sends a message: `this.postMessageToWebview({ type: "action", action: "settingsButtonClicked" })`
2. ExtensionStateContext handles it and updates state: `case "settingsButtonClicked": navigateToSettings()`

**Example from the code:**

```typescript
// ExtensionMessage.ts
action?:
  | "chatButtonClicked"
  | "mcpButtonClicked"
  | "settingsButtonClicked"
  | "historyButtonClicked"
  | "didBecomeVisible"
  | "accountLogoutClicked"
  | "accountButtonClicked"
  | "focusChatInput"

// ExtensionStateContext.tsx
case "settingsButtonClicked":
  navigateToSettings()
  break
```

## The Refactoring Process

For each UI action that follows Pattern 1, follow these steps:

1. **Identify UI state variables needed**
   - ExtensionStateContext already includes view state variables:
     ```typescript
     const [showMcp, setShowMcp] = useState(false)
     const [mcpTab, setMcpTab] = useState<McpViewTab | undefined>(undefined)
     const [showSettings, setShowSettings] = useState(false)
     const [showHistory, setShowHistory] = useState(false)
     const [showAccount, setShowAccount] = useState(false)
     ```

2. **Use navigation functions from ExtensionStateContext directly**
   - ExtensionStateContext provides navigation functions:
     ```typescript
     const navigateToMcp = useCallback(/*...*/)
     const navigateToSettings = useCallback(/*...*/)
     const navigateToHistory = useCallback(/*...*/)
     const navigateToAccount = useCallback(/*...*/)
     const navigateToChat = useCallback(/*...*/)
     ```
   - Use these functions directly without intermediate hooks

3. **Update components to use the context**
   - Replace `vscode.postMessage()` calls with context functions:
     ```typescript
     // Before:
     vscode.postMessage({ type: "showChatView" })
     
     // After:
     const { navigateToChat } = useExtensionState()
     navigateToChat()
     ```

4. **Clean up message interfaces and controller**
   - Remove the action type from WebviewMessage interface
   - Remove the case handler from controller/index.ts

## Messages to Remove vs. Keep

### Messages to Remove (Pattern 1)

These messages from WebviewMessage.ts should be refactored to use direct navigation functions:

```typescript
| "showChatView"              // Use navigateToChat() instead
| "openMcpSettings"           // Use navigateToMcp() instead
| "openSettings"              // Use navigateToSettings() instead
```

### Messages to Keep (Pattern 2)

These actions in ExtensionMessage.ts must remain as they're initiated by the extension:

```typescript
action?:
  | "chatButtonClicked"       // Extension initiates chat view
  | "mcpButtonClicked"        // Extension initiates MCP view
  | "settingsButtonClicked"   // Extension initiates settings view
  | "historyButtonClicked"    // Extension initiates history view
  | "accountButtonClicked"    // Extension initiates account view
```

## Example Refactoring

Let's look at how `showChatView` would be refactored:

### Before Refactoring

```typescript
// Component.tsx
const handleButtonClick = () => {
  vscode.postMessage({ type: "showChatView" })
}

// controller/index.ts
case "showChatView": {
  this.postMessageToWebview({
    type: "action",
    action: "chatButtonClicked",
  })
  break
}

// ExtensionStateContext.tsx
case "chatButtonClicked":
  navigateToChat()
  break
```

### After Refactoring

```typescript
// Component.tsx
const { navigateToChat } = useExtensionState()
const handleButtonClick = () => {
  navigateToChat()
}

// controller/index.ts
// The showChatView case is removed

// ExtensionStateContext.tsx
// The chatButtonClicked case remains for extension-initiated navigation
case "chatButtonClicked":
  navigateToChat()
  break
```

## Best Practices

- **Direct Navigation**: Always use the navigation functions from ExtensionStateContext directly
- **Clean Views**: When navigating to a view, ensure other views are properly hidden
- **Consistent Naming**: Use consistent naming for navigation functions (`navigateTo<View>`)
- **Keep Extension Actions**: Maintain extension-initiated navigation actions in ExtensionMessage.ts
- **Document Dependencies**: Use proper dependency arrays in useCallback for navigation functions
- **Centralized Logic**: Keep all navigation logic in ExtensionStateContext
- **Avoid Extra Hooks**: Don't create separate hooks that merely wrap navigation functions
