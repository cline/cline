import type { ToggleToolAutoApproveRequest } from "@shared/proto/cline/mcp"
import { McpServers } from "@shared/proto/cline/mcp"
import type { Controller } from "../index"

export async function toggleToolAutoApprove(
	_controller: Controller,
	_request: ToggleToolAutoApproveRequest,
): Promise<McpServers> {
	return McpServers.create({})
}
