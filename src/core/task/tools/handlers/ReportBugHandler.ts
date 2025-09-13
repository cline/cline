import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { ClineAsk } from "@shared/ExtensionMessage"
import { createAndOpenGitHubIssue } from "@utils/github-url-utils"
import * as os from "os"
import * as vscode from "vscode"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class ReportBugHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = "report_bug"

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const partialMessage = JSON.stringify({
			title: uiHelpers.removeClosingTag(block, "title", block.params.title),
			what_happened: uiHelpers.removeClosingTag(block, "what_happened", block.params.what_happened),
			steps_to_reproduce: uiHelpers.removeClosingTag(block, "steps_to_reproduce", block.params.steps_to_reproduce),
			api_request_output: uiHelpers.removeClosingTag(block, "api_request_output", block.params.api_request_output),
			additional_context: uiHelpers.removeClosingTag(block, "additional_context", block.params.additional_context),
		})

		await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "report_bug")
		await uiHelpers.ask("report_bug" as ClineAsk, partialMessage, block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet
		if (block.partial) {
			return ""
		}

		const title = block.params.title
		const what_happened = block.params.what_happened
		const steps_to_reproduce = block.params.steps_to_reproduce
		const api_request_output = block.params.api_request_output
		const additional_context = block.params.additional_context

		// Validate required parameters
		if (!title) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: title"
		}
		if (!what_happened) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: what_happened"
		}
		if (!steps_to_reproduce) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: steps_to_reproduce"
		}
		if (!api_request_output) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: api_request_output"
		}
		if (!additional_context) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: additional_context"
		}

		config.taskState.consecutiveMistakeCount = 0

		// Show notification if auto-approval is enabled
		if (config.autoApprovalSettings.enabled && config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Cline wants to create a github issue...",
				message: `Cline is suggesting to create a github issue with the title: ${title}`,
			})
		}

		// Derive system information values algorithmically
		const operatingSystem = os.platform() + " " + os.release()
		const clineVersion = vscode.extensions.getExtension("saoudrizwan.claude-dev")?.packageJSON.version || "Unknown"
		const systemInfo = `VSCode: ${vscode.version}, Node.js: ${process.version}, Architecture: ${os.arch()}`
		const currentMode = config.mode
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const apiProvider = currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		const providerAndModel = `${apiProvider} / ${config.api.getModel().id}`

		// Ask user for confirmation
		const bugReportData = JSON.stringify({
			title,
			what_happened,
			steps_to_reproduce,
			api_request_output,
			additional_context,
			// Include derived values in the JSON for display purposes
			provider_and_model: providerAndModel,
			operating_system: operatingSystem,
			system_info: systemInfo,
			cline_version: clineVersion,
		})

		const { text, images, files: reportBugFiles } = await config.callbacks.ask("report_bug", bugReportData, false)

		// If the user provided a response, treat it as feedback
		if (text || (images && images.length > 0) || (reportBugFiles && reportBugFiles.length > 0)) {
			let fileContentString = ""
			if (reportBugFiles && reportBugFiles.length > 0) {
				fileContentString = await processFilesIntoText(reportBugFiles)
			}

			await config.callbacks.say("user_feedback", text ?? "", images, reportBugFiles)
			return formatResponse.toolResult(
				`The user did not submit the bug, and provided feedback on the Github issue generated instead:\n<feedback>\n${text}\n</feedback>`,
				images,
				fileContentString,
			)
		} else {
			// If no response, the user accepted the bug report
			try {
				// Create a Map of parameters for the GitHub issue
				const params = new Map<string, string>()
				params.set("title", title)
				params.set("operating-system", operatingSystem)
				params.set("cline-version", clineVersion)
				params.set("system-info", systemInfo)
				params.set("additional-context", additional_context)
				params.set("what-happened", what_happened)
				params.set("steps", steps_to_reproduce)
				params.set("provider-model", providerAndModel)
				params.set("logs", api_request_output)

				// Use our utility function to create and open the GitHub issue URL
				// This bypasses VS Code's URI handling issues with special characters
				await createAndOpenGitHubIssue("cline", "cline", "bug_report.yml", params)
			} catch (error) {
				console.error(`An error occurred while attempting to report the bug: ${error}`)
			}

			return formatResponse.toolResult(`The user accepted the creation of the Github issue.`)
		}
	}
}
