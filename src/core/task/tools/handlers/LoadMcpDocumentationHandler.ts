import { loadMcpDocumentation } from "@core/prompts/loadMcpDocumentation"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"

export class LoadMcpDocumentationHandler implements IToolHandler {
	readonly name = "load_mcp_documentation"

	constructor() {}

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet (though this tool shouldn't have partial blocks)
		if (block.partial) {
			return ""
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			// Load MCP documentation
			const documentation = await loadMcpDocumentation(config.services.mcpHub)
			return documentation
		} catch (error) {
			return `Error loading MCP documentation: ${(error as Error)?.message}`
		}
	}
}
