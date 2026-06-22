import { EmptyRequest } from "@shared/proto/cline/common"
import { McpServers } from "@shared/proto/cline/mcp"
import { StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

export async function subscribeToMcpServers(
	_controller: Controller,
	_request: EmptyRequest,
	_responseStream: StreamingResponseHandler<McpServers>,
	_requestId?: string,
): Promise<void> {
	return
}

export async function sendMcpServersUpdate(_mcpServers: McpServers): Promise<void> {
	return
}
