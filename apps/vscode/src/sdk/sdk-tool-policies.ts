import { defaultMcpToolNameTransform } from "@cline/core"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { McpTool } from "@shared/mcp"
import type { McpHub } from "@/services/mcp/McpHub"

/**
 * Build SDK `toolPolicies` for tools governed by Cline's auto-approval UI.
 *
 * The SDK defaults unlisted tools to auto-approved. For tools controlled by
 * AutoApproveBar/MCP per-tool settings, force the SDK to call
 * `requestToolApproval`; the approval callback then evaluates the latest
 * settings and either silently approves or shows the approval UI. This keeps
 * active sessions in sync when the user toggles auto-approval mid-task.
 */
export function buildToolPolicies(
	_settings: AutoApprovalSettings,
	mcpHub?: McpHub,
): Record<string, { enabled?: boolean; autoApprove?: boolean }> {
	const policies: Record<string, { enabled?: boolean; autoApprove?: boolean }> = {}

	const set = (tools: string[]) => {
		for (const tool of tools) {
			policies[tool] = { autoApprove: false }
		}
	}

	set(["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"])
	set(["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"])
	set(["run_commands", "execute_command"])
	set(["fetch_web_content", "web_fetch", "web_search"])

	if (mcpHub) {
		for (const server of mcpHub.getServers()) {
			for (const tool of server.tools ?? []) {
				// Must match the name the tool was registered under (createMcpTools),
				// otherwise the SDK's unlisted-tool default (auto-approve) applies.
				const sdkName = defaultMcpToolNameTransform({ serverName: server.name, toolName: tool.name })
				policies[sdkName] = { autoApprove: false }
			}
		}
	}

	return policies
}

/**
 * Evaluate the current UI auto-approval settings for a single SDK tool name.
 * Used both when building initial SDK policies and as a live guard in the
 * approval callback, so changes from the AutoApproveBar are respected even if
 * an SDK session was created before the toggle changed.
 */
export function isToolAutoApproved(toolName: string, settings: AutoApprovalSettings, mcpHub?: McpHub): boolean {
	if (isReadTool(toolName)) {
		return !!settings.actions.readFiles
	}
	if (isEditTool(toolName)) {
		return !!settings.actions.editFiles
	}
	if (isCommandTool(toolName)) {
		return !!settings.actions.executeSafeCommands
	}
	if (isBrowserTool(toolName)) {
		return !!settings.actions.useBrowser
	}

	const mcpTool = findMcpTool(toolName, mcpHub)
	if (mcpTool) {
		// Legacy-extension parity: the global "Use MCP servers" auto-approve toggle
		// OR the tool's per-tool checkbox is sufficient to auto-approve.
		return !!settings.actions.useMcp || !!mcpTool.autoApprove
	}

	return false
}

function isReadTool(toolName: string): boolean {
	return ["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"].includes(
		toolName,
	)
}

export function isEditTool(toolName: string): boolean {
	return ["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"].includes(toolName)
}

function isCommandTool(toolName: string): boolean {
	return toolName === "run_commands" || toolName === "execute_command"
}

function isBrowserTool(toolName: string): boolean {
	return toolName === "fetch_web_content" || toolName === "web_fetch" || toolName === "web_search"
}

/**
 * Find the MCP tool registered under the given SDK tool name. SDK names come
 * from `defaultMcpToolNameTransform` (sanitized/truncated/hashed when
 * `serverName__toolName` is not a valid identifier), so match by re-applying
 * the transform rather than string-splitting the name.
 */
function findMcpTool(toolName: string, mcpHub?: McpHub): McpTool | undefined {
	if (!mcpHub) {
		return undefined
	}
	for (const server of mcpHub.getServers()) {
		for (const tool of server.tools ?? []) {
			if (defaultMcpToolNameTransform({ serverName: server.name, toolName: tool.name }) === toolName) {
				return tool
			}
		}
	}
	return undefined
}
