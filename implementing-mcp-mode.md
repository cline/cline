# Implementing MCP Mode Setting

## Overview

Currently, the MCP (Model Context Protocol) setting is a binary option (enabled/disabled) that controls whether MCP server functionality is included in AI prompts. We need to extend this to a trinary setting with the following modes:

1. **Enabled**: Full MCP functionality (current enabled state)
2. **Server Use Only**: Enable MCP server use but exclude build instructions from prompts
3. **Disabled**: No MCP functionality (current disabled state)

This change will help users better control token usage while maintaining access to MCP server capabilities when needed.

## Current Implementation

### VSCode Setting

Currently defined in `package.json`:

```json
"cline.mcp.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Include MCP server functionality in AI prompts. When disabled, the AI will not be aware of MCP capabilities. This saves context window tokens."
}
```

### Core Logic

-   `system.ts` uses the setting to conditionally include MCP content in prompts
-   `ClineProvider.ts` handles setting changes and webview communication

### UI

-   `McpView.tsx` displays a checkbox for toggling MCP functionality
-   Shows warning message when disabled

## Implementation Steps

### Implementation Order

The changes should be implemented in this order to minimize disruption:

1. Add new type definitions first
2. Update McpHub to handle both old and new setting values
3. Update message types and ClineProvider
4. Update VSCode setting definition
5. Update UI components
6. Update system prompt generation

### Step 1: Update VSCode Setting

In `package.json`, update the setting definition:

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

### Step 2: Update Type Definitions

In `src/shared/mcp.ts`, add the MCP mode type:

```typescript
export type McpMode = "enabled" | "server-use-only" | "disabled"
```

### Step 3: Update McpHub

In `src/services/mcp/McpHub.ts`, update the configuration reading:

```typescript
export class McpHub {
	public getMode(): McpMode {
		const mode = vscode.workspace.getConfiguration("cline.mcp").get<McpMode>("enabled", "enabled")

		// Handle legacy boolean values
		if (typeof mode === "boolean") {
			return mode ? "enabled" : "disabled"
		}

		return mode
	}
}
```

### Step 4: Update Message Types

In `src/shared/ExtensionMessage.ts` and `src/shared/WebviewMessage.ts`, update the message types:

```typescript
// ExtensionMessage.ts
export type ExtensionMessage =
	| {
			type: "mcpEnabled"
			mode: McpMode
	  }
	| {
			// ... other message types
	  }

// WebviewMessage.ts
export type WebviewMessage =
	| {
			type: "toggleMcp"
			mode: McpMode
	  }
	| {
			// ... other message types
	  }
```

### Step 5: Update ClineProvider

In `src/core/webview/ClineProvider.ts`, update the message handling:

```typescript
export class ClineProvider {
	// ... existing code ...

	private async handleWebviewMessage(message: WebviewMessage) {
		switch (message.type) {
			case "toggleMcp": {
				await vscode.workspace.getConfiguration("cline.mcp").update("enabled", message.mode, true)
				break
			}
			// ... other cases ...
		}
	}

	private async handleConfigurationChange(e: vscode.ConfigurationChangeEvent) {
		if (e && e.affectsConfiguration("cline.mcp.enabled")) {
			const mode = this.mcpHub?.getMode() ?? "enabled"
			await this.postMessageToWebview({
				type: "mcpEnabled",
				mode,
			})
		}
	}
}
```

### Step 6: Update System Prompt Generation

In `src/core/prompts/system.ts`, modify how MCP content is included:

```typescript
export const SYSTEM_PROMPT = async (
	cwd: string,
	supportsComputerUse: boolean,
	mcpMode: McpMode,
	browserSettings: BrowserSettings,
) => {
	// Base prompt content...

	// Include MCP content for both 'enabled' and 'server-use-only' modes
	if (mcpMode !== "disabled") {
		let mcpContent = `
====

MCP SERVERS

The Model Context Protocol (MCP) enables communication between the system and locally running MCP servers that provide additional tools and resources to extend your capabilities.

# Connected MCP Servers

When a server is connected, you can use the server's tools via the \`use_mcp_tool\` tool, and access the server's resources via the \`access_mcp_resource\` tool.
`

		// Add server listings...
		mcpContent += getServerListings()

		// Only include build instructions in full mode
		if (mcpMode === "enabled") {
			mcpContent += `
## Creating an MCP Server

[... build instructions content ...]`
		}

		return basePrompt + mcpContent
	}

	return basePrompt
}
```

### Step 5: Update UI

In `webview-ui/src/components/mcp/McpView.tsx`, replace the checkbox with a select:

```typescript
const McpModeSelect: React.FC<{
    value: McpMode;
    onChange: (value: McpMode) => void;
}> = ({ value, onChange }) => {
    return (
        <VSCodeDropdown
            value={value}
            onChange={(e) => onChange((e.target as HTMLSelectElement).value as McpMode)}
        >
            <option value="enabled">Fully Enabled</option>
            <option value="server-use-only">Server Use Only</option>
            <option value="disabled">Disabled</option>
        </select>
    );
};

// Update the main component
const McpView = ({ onDone }: McpViewProps) => {
    const [mcpMode, setMcpMode] = useState<McpMode>("enabled");

    useEffect(() => {
        vscode.postMessage({ type: "getMcpEnabled" });
    }, []);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "mcpEnabled") {
                setMcpMode(message.mode);
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, []);

    const handleModeChange = (newMode: McpMode) => {
        vscode.postMessage({
            type: "toggleMcp",
            mode: newMode,
        });
        setMcpMode(newMode);
    };

    return (
        // ... existing wrapper divs ...
        <div>
            <McpModeSelect value={mcpMode} onChange={handleModeChange} />
            {mcpMode === "server-use-only" && (
                <div style={{
                    marginTop: "4px",
                    marginLeft: "24px",
                    color: "var(--vscode-descriptionForeground)",
                    fontSize: "12px",
                }}>
                    MCP server use is enabled, but build instructions are excluded from AI prompts to save tokens.
                </div>
            )}
            {mcpMode === "disabled" && (
                <div style={{
                    padding: "8px 12px",
                    marginTop: "8px",
                    background: "var(--vscode-textBlockQuote-background)",
                    border: "1px solid var(--vscode-textBlockQuote-border)",
                    borderRadius: "4px",
                    color: "var(--vscode-descriptionForeground)",
                    fontSize: "12px",
                    lineHeight: "1.4",
                }}>
                    MCP is currently disabled. Enable MCP to use MCP servers and tools. Enabling MCP will use additional tokens.
                </div>
            )}
        </div>
    );
};
```

## Testing Plan

1. Functionality Testing

    - Test each mode:
        - Enabled: Full MCP functionality
        - Server Use Only: Verify servers work but build instructions are excluded
        - Disabled: No MCP functionality

2. UI Testing

    - Verify select component displays correctly
    - Check mode-specific messages
    - Test mode switching

3. System Prompt Testing
    - Verify correct sections are included/excluded based on mode
    - Check server listings in each mode
    - Validate build instructions presence/absence

## Implementation Notes

-   The system prompt directly checks the mode value to determine what content to include
-   The UI provides clear feedback about the implications of each mode
-   Error handling remains consistent with the existing implementation
