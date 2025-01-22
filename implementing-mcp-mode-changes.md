# MCP Mode Implementation Changes

## Overview

Implemented a tri-state MCP mode setting to replace the existing boolean toggle, allowing users to:

1. Fully enable MCP (including server use and build instructions)
2. Enable server use only (excluding build instructions to save tokens)
3. Disable MCP completely

## Changes Made

### 1. Type Definition

Added McpMode type in `src/shared/mcp.ts`:

```typescript
export type McpMode = "enabled" | "server-use-only" | "disabled"
```

### 2. VSCode Setting

Updated setting definition in `package.json`:

```json
"cline.mcp.enabled": {
    "type": "string",
    "enum": ["enabled", "server-use-only", "disabled"],
    "enumDescriptions": [
        "Full MCP functionality including server use and build instructions",
        "Enable MCP server use but exclude build instructions from AI prompts to save tokens",
        "Disable all MCP functionality"
    ],
    "default": "enabled",
    "description": "Control MCP server functionality and its inclusion in AI prompts"
}
```

### 3. McpHub Changes

Modified `src/services/mcp/McpHub.ts`:

-   Removed `isMcpEnabled()` method
-   Added `getMode(): McpMode` method that returns the current mode from VSCode settings

### 4. Message Types

Updated message types to support the new mode:

In `src/shared/WebviewMessage.ts` and `src/shared/ExtensionMessage.ts`:
- Added `mode?: McpMode` property with comment indicating its use with specific message types

### 5. MCP View Changes

Updated `webview-ui/src/components/mcp/McpView.tsx`:

-   Replaced checkbox with dropdown for mode selection
-   Updated state management to use McpMode type
-   Added mode-specific descriptions:
    - Enabled: "Full MCP functionality including server use and build instructions"
    - Server Use Only: "MCP server use is enabled, but build instructions are excluded from AI prompts to save tokens"
    - Disabled: Warning about MCP being disabled and token implications
-   Updated visibility conditions based on mode

### 6. System Prompt Generation

Added comment in `src/core/prompts/system.ts.checks` for implementing mode-specific content:

```typescript
// Mode checks for MCP content:
// - mcpHub.getMode() === "disabled" -> exclude all MCP content
// - mcpHub.getMode() === "server-use-only" -> include server tools/resources but exclude build instructions
// - mcpHub.getMode() === "enabled" -> include all MCP content (tools, resources, and build instructions)
```

The server building content to be conditionally included (only in "enabled" mode) spans the following sections in system.ts:
- Lines 1012-1015: Main section about creating MCP servers
- Lines 1017-1021: OAuth and authentication handling
- Lines 1025-1392: Example weather server implementation
- Lines 1394-1399: Guidelines for modifying existing servers
- Lines 1401-1405: Usage notes about when to create vs use existing tools

## Next Steps

1. Implement the system prompt changes using the mode checks provided in system.ts.checks
2. Test the implementation with all three modes to ensure proper functionality

## Testing Required

1. Verify mode switching in UI works correctly
2. Confirm proper state persistence
3. Test system prompt generation with each mode
4. Verify server connections behave correctly in each mode
5. Check token usage differences between modes
