import type { ToolUse } from "@core/assistant-message"
import { loadMcpDocumentation } from "@core/prompts/loadMcpDocumentation"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class LoadMcpDocumentationHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.MCP_DOCS

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async handlePartialBlock(_block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		// Show loading message for partial blocks (though this tool probably won't have partials)
		await uiHelpers.say(this.name, "", undefined, undefined, true)
	}

	async execute(config: TaskConfig, _block: ToolUse): Promise<ToolResponse> {
		// Show loading message at start of execution (self-managed now)
		await config.callbacks.say(this.name, "", undefined, undefined, false)

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
