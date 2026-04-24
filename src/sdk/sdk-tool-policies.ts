import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import type { McpHub } from "@/services/mcp/McpHub"

/**
 * Build SDK `toolPolicies` from the user's `AutoApprovalSettings`.
 *
 * The SDK defaults all tools to `{ autoApprove: true }` when no policy is
 * set, so we only need to emit entries for tools that should NOT be
 * auto-approved. This ensures `requestToolApproval` is called for tools
 * the user hasn't enabled.
 */
export function buildToolPolicies(
	settings: AutoApprovalSettings,
	mcpHub?: McpHub,
): Record<string, { enabled?: boolean; autoApprove?: boolean }> {
	const policies: Record<string, { enabled?: boolean; autoApprove?: boolean }> = {}

	const set = (tools: string[], autoApprove: boolean) => {
		for (const tool of tools) {
			policies[tool] = { autoApprove }
		}
	}

	set(
		["read_files", "read_file", "list_files", "list_code_definition_names", "search_codebase", "search_files"],
		!!settings.actions.readFiles,
	)
	set(["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"], !!settings.actions.editFiles)

	const commandAutoApprove = !!settings.actions.executeAllCommands || !!settings.actions.executeSafeCommands
	set(["run_commands", "execute_command"], commandAutoApprove)
	set(["fetch_web_content", "web_fetch", "web_search"], !!settings.actions.useBrowser)

	if (mcpHub) {
		const mcpEnabled = !!settings.actions.useMcp
		for (const server of mcpHub.getServers()) {
			for (const tool of server.tools ?? []) {
				const sdkName = `${server.name}__${tool.name}`
				const autoApprove = mcpEnabled && !!tool.autoApprove
				policies[sdkName] = { autoApprove }
			}
		}
	}

	return policies
}
