import type { McpHub } from "@/services/mcp/McpHub"

/**
 * Build a deny-by-default approval policy. The agent runtime independently
 * permits only its fixed set of bounded read-only tools without a prompt.
 */
export function buildToolPolicies(mcpHub?: McpHub): Record<string, { enabled?: boolean; autoApprove?: boolean }> {
	const policies: Record<string, { enabled?: boolean; autoApprove?: boolean }> = {
		"*": { autoApprove: false },
	}

	if (mcpHub) {
		for (const server of mcpHub.getServers()) {
			for (const tool of server.tools ?? []) {
				policies[`${server.name}__${tool.name}`] = { autoApprove: false }
			}
		}
	}

	return policies
}

export function isEditTool(toolName: string): boolean {
	return ["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"].includes(toolName)
}
