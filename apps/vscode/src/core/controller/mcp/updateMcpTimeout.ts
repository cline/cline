import { McpServers, UpdateMcpTimeoutRequest } from "@shared/proto/cline/mcp"
import { Controller } from ".."

export async function updateMcpTimeout(_controller: Controller, _request: UpdateMcpTimeoutRequest): Promise<McpServers> {
	return McpServers.create({})
}
