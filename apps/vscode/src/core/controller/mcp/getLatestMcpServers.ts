import type { Empty } from "@shared/proto/cline/common"
import { McpServers } from "@shared/proto/cline/mcp"
import type { Controller } from "../index"

export async function getLatestMcpServers(_controller: Controller, _request: Empty): Promise<McpServers> {
	return McpServers.create({})
}
