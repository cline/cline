import { StringRequest } from "@shared/proto/cline/common"
import { McpServers } from "@shared/proto/cline/mcp"
import type { Controller } from "../index"

export async function restartMcpServer(_controller: Controller, _request: StringRequest): Promise<McpServers> {
	return McpServers.create({})
}
