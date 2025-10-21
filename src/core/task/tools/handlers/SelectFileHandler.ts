import { ToolUse } from "@/core/assistant-message"
import { ClineSayTool } from "@/shared/ExtensionMessage"
import { ToolResponse } from "../.."
import { IFullyManagedTool } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"
import { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { HostProvider } from "@/hosts/host-provider"

export class SelectFileHandler implements IFullyManagedTool {
	readonly name = "select_file"

	getDescription(block: ToolUse): string {
		const title = block.params.title || "Select File"
		return `[${block.name} for '${title}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const title = block.params.title || "Select File"
		const canSelectFilesParam = block.params.canSelectFiles !== undefined ? block.params.canSelectFiles === "true" : true
		const canSelectFoldersParam = block.params.canSelectFolders !== undefined ? block.params.canSelectFolders === "true" : false
		const canSelectManyParam = block.params.canSelectMany !== undefined ? block.params.canSelectMany === "true" : false

		// For partial blocks, just show the preview and return
		if (block.partial) {
			const partialMessage = JSON.stringify({
				tool: "readFile",
				content: `选择文件/目录: ${title}`,
				operationIsLocatedInWorkspace: false,
			} satisfies ClineSayTool)
			
			// Handle auto-approval vs manual approval for partial
			if (uiHelpers.shouldAutoApproveTool(block.name)) {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await uiHelpers.say("tool", partialMessage, undefined, undefined, true)
			} else {
				await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
				await uiHelpers.ask("tool", partialMessage, true).catch(() => {})
			}
			return
		}

		try {
			// Execute the file selection
			const result = await this.execute(uiHelpers.getConfig(), block)
			
			// Show the result
			const toolMessage = JSON.stringify({
				tool: "readFile",
				content: `文件选择结果: ${result}`,
				operationIsLocatedInWorkspace: false,
			} satisfies ClineSayTool)
			
			await uiHelpers.say("tool", toolMessage)
		} catch (error: any) {
			const errorMessage = JSON.stringify({
				tool: "readFile",
				content: `文件选择错误: ${error.message}`,
				operationIsLocatedInWorkspace: false,
			} satisfies ClineSayTool)
			await uiHelpers.say("error", errorMessage)
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const title = block.params.title || "Select File"
		const canSelectFilesParam = block.params.canSelectFiles !== undefined ? block.params.canSelectFiles === "true" : true
		const canSelectFoldersParam = block.params.canSelectFolders !== undefined ? block.params.canSelectFolders === "true" : false
		const canSelectManyParam = block.params.canSelectMany !== undefined ? block.params.canSelectMany === "true" : false
		const filters = block.params.filters ? JSON.parse(block.params.filters) : undefined

		config.taskState.consecutiveMistakeCount = 0

		try {
			// Build dialog options - convert to proto format
			const dialogOptions: any = {
				canSelectMany: canSelectManyParam,
				canSelectFolders: canSelectFoldersParam,
				canSelectFiles: canSelectFilesParam,
				title: title,
			}

			// Handle file filters
			if (filters) {
				dialogOptions.filters = {
					files: filters
				}
			}

			// Show the file selection dialog using HostProvider
			const result = await HostProvider.window.showOpenDialogue(dialogOptions)

			if (result && result.paths && result.paths.length > 0) {
				if (canSelectManyParam) {
					// Return all selected file paths as JSON array
					return result.paths.join('\n')
				} else {
					// Return the first selected file path
					return result.paths[0]
				}
			} else {
				// User canceled the selection
				return "User canceled file selection"
			}
		} catch (error: any) {
			const errorMessage = `文件选择错误: ${error.message}`
			console.error("[SelectFileHandler] Error:", error)
			return errorMessage
		}
	}
}