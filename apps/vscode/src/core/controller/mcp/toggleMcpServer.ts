import type { ToggleMcpServerRequest } from "@shared/proto/cline/mcp"
import { McpServers } from "@shared/proto/cline/mcp"
import type { Controller } from "../index"

export async function toggleMcpServer(_controller: Controller, _request: ToggleMcpServerRequest): Promise<McpServers> {
	return McpServers.create({})
}
