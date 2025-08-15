import * as path from "path"
import { parseSourceCodeForDefinitionsTopLevel } from "@services/tree-sitter"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"

export class ListCodeDefinitionNamesToolHandler implements IToolHandler {
	readonly name = "list_code_definition_names"

	constructor(private validator: ToolValidator) {}

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet
		if (block.partial) {
			return ""
		}

		const relDirPath: string | undefined = block.params.path

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError("list_code_definition_names", "path")
		}

		config.taskState.consecutiveMistakeCount = 0
		const absolutePath = path.resolve(config.cwd, relDirPath!)

		// Execute the actual parse source code operation
		const result = await parseSourceCodeForDefinitionsTopLevel(absolutePath, config.services.clineIgnoreController)

		return result
	}
}
