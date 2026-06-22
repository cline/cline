import type { AddRemoteMcpServerRequest } from "@shared/proto/cline/mcp"
import { McpServers } from "@shared/proto/cline/mcp"
import type { Controller } from "../index"

export async function addRemoteMcpServer(_controller: Controller, _request: AddRemoteMcpServerRequest): Promise<McpServers> {
	return McpServers.create({})
}
