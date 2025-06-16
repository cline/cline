# Context Overflow Contingency

This feature allows modes to automatically exit subtasks when context overflow occurs, preventing the system from getting stuck due to large content (like web pages) that exceed the model's context window.

## Overview

When enabled, the context overflow contingency feature monitors token usage and automatically triggers an `attempt_completion` with a customizable message when the context window approaches its limit. This is particularly useful for modes that interact with external content sources like browsers, file systems, or APIs that might return unexpectedly large amounts of data.

## Configuration

### Global Settings

You can enable context overflow contingency globally in your settings:

```json
{
	"contextOverflowContingencyEnabled": true,
	"contextOverflowContingencyMessage": "Task failed due to context overflow - content was too large to process",
	"contextOverflowContingencyTriggerTools": ["browser_action", "read_file", "search_files"]
}
```

### Mode-Specific Settings

You can also configure this feature per mode in your custom mode definitions:

```json
{
	"slug": "mcp-expert",
	"name": "🌐 MCP Expert",
	"roleDefinition": "You are an expert at handling browser interactions using PlayWright.",
	"whenToUse": "Use this mode for web scraping, browser automation, and web-based tasks.",
	"groups": ["read", "edit", "browser", "command", "mcp"],
	"contextOverflowContingency": {
		"enabled": true,
		"message": "Browser task failed because the webpage returned too much content, causing context overflow",
		"triggerTools": ["browser_action", "use_mcp_tool"]
	}
}
```

## Configuration Options

### `enabled` (boolean)

- **Default**: `false`
- **Description**: Whether to enable context overflow contingency for this mode

### `message` (string, optional)

- **Default**: `"Task failed because of a context overflow, possibly because webpage returned from the browser was too big"`
- **Description**: Custom message to display when context overflow occurs

### `triggerTools` (string[], optional)

- **Default**: `["browser_action", "read_file", "search_files", "list_files"]`
- **Description**: List of tools that can trigger the contingency. If not specified, any tool can trigger it.

## How It Works

1. **Context Monitoring**: The system continuously monitors token usage during task execution
2. **Threshold Detection**: When context usage reaches 90% of the model's context window, the contingency is evaluated
3. **Tool Filtering**: If `triggerTools` is specified, the contingency only activates if the last tool used is in the list
4. **Automatic Exit**: For subtasks, the system calls `attempt_completion` with the configured message and returns control to the parent task
5. **Error Reporting**: For main tasks, an error message is displayed to the user

## Use Cases

### Browser Automation

Perfect for modes that scrape web content where pages might be unexpectedly large:

```json
{
	"contextOverflowContingency": {
		"enabled": true,
		"message": "Web scraping failed - page content exceeded context limits",
		"triggerTools": ["browser_action"]
	}
}
```

### File Processing

Useful for modes that read large files or process multiple files:

```json
{
	"contextOverflowContingency": {
		"enabled": true,
		"message": "File processing failed due to content size - try processing smaller files or chunks",
		"triggerTools": ["read_file", "search_files"]
	}
}
```

### MCP Tool Integration

Helpful when using MCP tools that might return large datasets:

```json
{
	"contextOverflowContingency": {
		"enabled": true,
		"message": "MCP tool returned too much data, causing context overflow",
		"triggerTools": ["use_mcp_tool", "access_mcp_resource"]
	}
}
```

## Priority Order

Settings are applied in the following priority order:

1. **Global Settings**: Applied first if `contextOverflowContingencyEnabled` is `true`
2. **Mode-Specific Settings**: Applied if no global setting is enabled
3. **Default Behavior**: No contingency if neither global nor mode settings are configured

Global settings always take precedence over mode-specific settings when both are configured.

## Best Practices

1. **Enable for External Content**: Always enable for modes that fetch external content (web pages, APIs, large files)
2. **Customize Messages**: Provide clear, actionable messages that help users understand what happened
3. **Specific Tool Lists**: Use `triggerTools` to limit contingency to tools that commonly cause overflow
4. **Test Thoroughly**: Test your modes with large content to ensure the contingency works as expected
5. **Monitor Logs**: Check the logs for contingency triggers to understand usage patterns

## Example: MCP Expert Mode

Here's a complete example of a mode configured for browser interactions with context overflow protection:

```json
{
	"slug": "mcp-expert",
	"name": "🌐 MCP Expert",
	"roleDefinition": "You are Roo, an expert at handling browser interactions using PlayWright and other MCP tools. You excel at web scraping, automation, and data extraction while being mindful of context limitations.",
	"whenToUse": "Use this mode when you need to interact with web browsers, scrape content, automate web tasks, or use MCP tools for external integrations.",
	"groups": ["read", "edit", "browser", "command", "mcp"],
	"customInstructions": "When working with web content, be mindful of page sizes. If you encounter large pages, try to extract only the relevant information rather than processing the entire page content.",
	"contextOverflowContingency": {
		"enabled": true,
		"message": "Browser task failed because the webpage returned too much content, causing context overflow. Try targeting specific elements or smaller pages.",
		"triggerTools": ["browser_action", "use_mcp_tool", "access_mcp_resource"]
	}
}
```

This configuration ensures that if the browser returns a very large page, the subtask will automatically exit with a helpful message rather than getting stuck in a context overflow situation.
