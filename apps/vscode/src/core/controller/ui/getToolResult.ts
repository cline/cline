import type { ToolResultRequest } from "@shared/proto/bedrock_coder/ui"
import { ToolResultResponse } from "@shared/proto/bedrock_coder/ui"
import type { Controller } from "../index"

export async function getToolResult(controller: Controller, request: ToolResultRequest): Promise<ToolResultResponse> {
	const result = controller.getToolResult(request.id)
	if (!result) {
		throw new Error("The retained tool result is no longer available.")
	}
	return ToolResultResponse.create({
		id: result.id,
		toolName: result.toolName,
		content: result.content,
		isError: result.isError,
		truncated: result.truncated,
		createdAt: result.createdAt,
	})
}
