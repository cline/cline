import * as path from "path"
import { listFiles } from "@services/glob/list-files"
import { formatResponse } from "@core/prompts/responses"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"

export class ListFilesToolHandler implements IToolHandler {
	readonly name = "list_files"

	constructor(private validator: ToolValidator) {}

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet
		if (block.partial) {
			return ""
		}

		const relDirPath: string | undefined = block.params.path
		const recursiveRaw: string | undefined = block.params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError("list_files", "path")
		}

		config.taskState.consecutiveMistakeCount = 0
		const absolutePath = path.resolve(config.cwd, relDirPath!)

		// Execute the actual list files operation
		const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200)

		const result = formatResponse.formatFilesList(absolutePath, files, didHitLimit, config.services.clineIgnoreController)

		return result
	}
}
