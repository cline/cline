import type { ToolUse } from "@core/assistant-message"
import { readFile } from "fs/promises"
import * as path from "path"
import { formatResponse } from "@/core/prompts/responses"
import type { ToolResponse } from "@/core/task"
import { Logger } from "@/services/logging/Logger"
import { MorphApplyService } from "@/services/morph/MorphApplyService"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { WriteToFileToolHandler } from "./WriteToFileToolHandler"

export class EditFileToolHandler implements IFullyManagedTool {
	readonly name = "edit_file"

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		const rel = block.params.target_file
		return `[${block.name}${rel ? ` for '${rel}'` : ""}]`
	}

	async handlePartialBlock(block: ToolUse, ui: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.target_file
		const instructions = block.params.instructions
		const codeEdit = block.params.code_edit

		// Only show a lightweight status message once we have a path
		if (!relPath) return

		const config = ui.getConfig()
		const displayPath = path.relative(config.cwd, path.resolve(config.cwd, relPath))
		const status = instructions ? `Instructions: ${instructions}` : "Waiting for instructions and code edit..."
		await ui.say(
			"tool",
			JSON.stringify({ tool: "edit_file", path: displayPath, content: codeEdit || status }),
			undefined,
			undefined,
			block.partial,
		)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const target_file = block.params.target_file
		const instructions = block.params.instructions
		const code_edit = block.params.code_edit

		if (!target_file) return await config.callbacks.sayAndCreateMissingParamError("edit_file", "target_file")
		if (!instructions) return await config.callbacks.sayAndCreateMissingParamError("edit_file", "instructions", target_file)
		if (!code_edit) return await config.callbacks.sayAndCreateMissingParamError("edit_file", "code_edit", target_file)

		const absPath = path.resolve(config.cwd, target_file)
		let initialCode: string
		try {
			initialCode = await readFile(absPath, "utf-8")
		} catch {
			Logger.warn(`[EditFileToolHandler] File not found or unreadable: ${absPath}`)
			return formatResponse.toolError(`File not found or cannot be read: ${target_file}`)
		}

		try {
			// Use Morph service with current state manager
			Logger.debug(
				`[EditFileToolHandler] Invoking Morph fast apply for '${target_file}' (instructionsLen=${instructions.length}, codeEditLen=${code_edit.length}, initialLen=${initialCode.length})`,
			)
			const morphService = new MorphApplyService(config.services.stateManager)
			const result = await morphService.applyEdit(initialCode, instructions, code_edit)

			if (result.startsWith("Error:")) {
				const errorMessage = result.substring(6).trim()
				Logger.warn(`[EditFileToolHandler] Morph Apply failed, initiating fallback: ${errorMessage}`)
				await config.callbacks.say(
					"error",
					`Morph Fast Apply failed for ${target_file}: ${errorMessage}. Instructing LLM to fall back to replace_in_file`,
				)
				return formatResponse.toolError(
					`Morph Fast Apply failed: ${errorMessage}. You MUST now use replace_in_file as a fallback to apply the required changes based on the original instructions.`,
				)
			}

			Logger.debug(
				`[EditFileToolHandler] Morph succeeded for '${target_file}', merged content length=${result.length}. Proceeding to write_to_file.`,
			)
			// Apply merged code by delegating to write_to_file
			const writeHandler = new WriteToFileToolHandler(this.validator)
			const writeBlock: ToolUse = {
				type: "tool_use",
				name: "write_to_file",
				params: { path: target_file, content: result },
				partial: false,
			}
			return await writeHandler.execute(config, writeBlock)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			Logger.error(`[EditFileToolHandler] Unexpected error during execution: ${message}`)
			await config.callbacks.say("error", `An unexpected error occurred while applying edit to ${target_file}: ${message}.`)
			return formatResponse.toolError(`Failed to apply edit: ${message}`)
		}
	}
}
