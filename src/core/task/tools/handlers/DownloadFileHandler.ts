import type { ToolUse } from "@core/assistant-message"
import { ClineSayTool } from "@shared/ExtensionMessage"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import axios from "axios"

export class DownloadFileHandler implements IFullyManagedTool {
	readonly name = "download_file"

	getDescription(block: ToolUse): string {
		const fileUrl = block.params.fileUrl
		const savePath = block.params.savePath
		return `[${block.name} for '${fileUrl}' -> '${savePath}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const fileUrl = block.params.fileUrl
		const savePath = block.params.savePath

		// Early return if we don't have enough data yet
		if (!fileUrl || !savePath) {
			return
		}

		const config = uiHelpers.getConfig()

		// For partial blocks, just show the preview and return
		if (block.partial) {
			const partialMessage = JSON.stringify({
				tool: "webFetch",
				path: savePath,
				content: `Downloading file from ${fileUrl} to ${savePath}`,
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
			// Show notification if auto-approval is enabled
// 			showNotificationForApprovalIfAutoApprovalEnabled(
// 				`Downloading file from ${fileUrl} to ${savePath}`,
// 				config.autoApprovalSettings.enabled,
// 				config.autoApprovalSettings.enableNotifications,
// 			)

// 			// Remove any partial messages of this type
// 			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")

// 			// Create approval message in JSON format
// 			const approvalMessage = JSON.stringify({
// 				tool: "webFetch",
// 				path: savePath,
// 				content: `Cline wants to download a file:

// URL: ${fileUrl}
// Save path: ${savePath}

// Download this file?`,
// 				operationIsLocatedInWorkspace: false,
// 			} satisfies ClineSayTool)

// 			// Ask for approval
// 			const approved = await uiHelpers.askApproval("tool", approvalMessage)

// 			if (!approved) {
// 				const cancelMessage = JSON.stringify({
// 					tool: "webFetch",
// 					path: savePath,
// 					content: "File download cancelled by user",
// 					operationIsLocatedInWorkspace: false,
// 				} satisfies ClineSayTool)
// 				await uiHelpers.say("tool", cancelMessage)
// 				return
// 			}

			// Execute the download
			const result = await this.execute(config, block)
			
			// Show the result
			const toolMessage = JSON.stringify({
				tool: "webFetch",
				path: savePath,
				content: `Downloaded file from ${fileUrl} - Status: ${result}`,
				operationIsLocatedInWorkspace: false,
			} satisfies ClineSayTool)
			
			await uiHelpers.say("tool", toolMessage)
		} catch (error: any) {
			const errorMessage = JSON.stringify({
				tool: "webFetch",
				path: savePath,
				content: `Error downloading file: ${error.message}`,
				operationIsLocatedInWorkspace: false,
			} satisfies ClineSayTool)
			await uiHelpers.say("error", errorMessage)
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const fileUrl = block.params.fileUrl
		const savePath = block.params.savePath
		console.log("[DownloadFileHandler] Executing download_file with", { fileUrl, savePath })

		// Validate required parameters
		if (!fileUrl) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: fileUrl"
		}

		if (!savePath) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: savePath"
		}

		config.taskState.consecutiveMistakeCount = 0

		try {
			// Resolve the save path relative to current working directory
			const absoluteSavePath = path.resolve(config.cwd, savePath)

			// Ensure the directory exists
			const saveDir = path.dirname(absoluteSavePath)
			await fsPromises.mkdir(saveDir, { recursive: true })

			// Download the file using axios
			const response = await axios({
				method: "GET",
				url: fileUrl,
				responseType: "stream",
				validateStatus: () => true, // Don't throw on non-2xx status codes
			})

			// Get the HTTP status code
			const statusCode = response.status

			// If status is successful, save the file
			if (statusCode >= 200 && statusCode < 300) {
				const writer = fs.createWriteStream(absoluteSavePath)
				response.data.pipe(writer)

				// Wait for the file to be written
				await new Promise((resolve, reject) => {
					writer.on("finish", resolve)
					writer.on("error", reject)
				})
			}

			return `HTTP ${statusCode}`
		} catch (error: any) {
			const errorMessage = `Error downloading file: ${error.message}`
			console.error("[DownloadFileHandler] Error:", error)
			return errorMessage
		}
	}
}