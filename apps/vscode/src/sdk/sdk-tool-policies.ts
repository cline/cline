import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
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
				const sdkName = `${server.name}__${tool.name}`
				policies[sdkName] = { autoApprove: false }
			}
		}
	}

	return policies
}

const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
	/\bgit\s+commit\b[\s\S]*?--amend\b/,
	/\bgit\s+push\b[\s\S]*?(?:-f\b|--force\b)/,
	/\bgit\s+reset\s+--hard\b/,
	/\bgit\s+rebase\b/,
	/\brm\s+(?:-(?:rf|r\s*-f\b|-f\s*r\b|fr)\b|--recursive\s+--force\b)/,
]

function extractCommandStrings(input: unknown): string[] {
	if (typeof input === "string") {
		return [input]
	}
	if (Array.isArray(input)) {
		return input.filter((s): s is string => typeof s === "string")
	}
	if (input && typeof input === "object") {
		const obj = input as Record<string, unknown>
		if (Array.isArray(obj.commands)) {
			return obj.commands
				.map((c) => {
					if (typeof c === "string") {
						return c
					}
					if (c && typeof c === "object" && typeof (c as Record<string, unknown>).command === "string") {
						const cmdObj = c as { command: string; args?: string[] }
						return cmdObj.args?.length ? `${cmdObj.command} ${cmdObj.args.join(" ")}` : cmdObj.command
					}
					return ""
				})
				.filter(Boolean)
		}
		if (typeof obj.command === "string") {
			return [obj.command]
		}
		if (typeof obj.cmd === "string") {
			return [obj.cmd]
		}
	}
	return []
}

function inputContainsDangerousCommand(input: unknown): boolean {
	const commands = extractCommandStrings(input)
	return commands.some((cmd) => DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(cmd)))
}

/**
 * Evaluate the current UI auto-approval settings for a single SDK tool name.
 * Used both when building initial SDK policies and as a live guard in the
 * approval callback, so changes from the AutoApproveBar are respected even if
 * an SDK session was created before the toggle changed.
 *
 * When `input` is provided for command tools, destructive commands (e.g.
 * `git commit --amend`, `git push --force`, `rm -rf`) are excluded from
 * auto-approval even when `executeSafeCommands` is enabled.
 */
export function isToolAutoApproved(toolName: string, settings: AutoApprovalSettings, mcpHub?: McpHub, input?: unknown): boolean {
	if (isReadTool(toolName)) {
		return !!settings.actions.readFiles
	}
	if (isEditTool(toolName)) {
		return !!settings.actions.editFiles
	}
	if (isCommandTool(toolName)) {
		if (!settings.actions.executeSafeCommands) {
			return false
		}
		if (input !== undefined && inputContainsDangerousCommand(input)) {
			return false
		}
		return true
	}
	if (isBrowserTool(toolName)) {
		return !!settings.actions.useBrowser
	}

	const mcpTool = parseMcpToolName(toolName)
	if (mcpTool) {
		if (!settings.actions.useMcp || !mcpHub) {
			return false
		}
		const server = mcpHub.getServers().find((entry) => entry.name === mcpTool.serverName)
		const tool = server?.tools?.find((entry) => entry.name === mcpTool.toolName)
		return !!tool?.autoApprove
	}

	return false
}

function isReadTool(toolName: string): boolean {
	return ["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"].includes(
		toolName,
	)
}

function isEditTool(toolName: string): boolean {
	return ["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"].includes(toolName)
}

function isCommandTool(toolName: string): boolean {
	return toolName === "run_commands" || toolName === "execute_command"
}

function isBrowserTool(toolName: string): boolean {
	return toolName === "fetch_web_content" || toolName === "web_fetch" || toolName === "web_search"
}

function parseMcpToolName(toolName: string): { serverName: string; toolName: string } | undefined {
	const separatorIndex = toolName.indexOf("__")
	if (separatorIndex <= 0) return undefined
	const serverName = toolName.substring(0, separatorIndex)
	const mcpToolName = toolName.substring(separatorIndex + 2)
	if (!mcpToolName) return undefined
	return { serverName, toolName: mcpToolName }
}
