import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { ClineAsk } from "@shared/ExtensionMessage"
import { startDebugging } from "@/hosts/vscode/hostbridge/debug/debugService"
import { StartDebuggingRequest } from "@/shared/proto/index.host"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class DebugFileToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.DEBUG_FILE

	constructor(_validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.file_path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const filePath = block.params.file_path
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool(this.name)

		if (shouldAutoApprove) {
			return
		} else {
			await uiHelpers
				.ask("command" as ClineAsk, uiHelpers.removeClosingTag(block, "file_path", filePath), block.partial)
				.catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const filePath: string | undefined = block.params.file_path
		const debugConfigName: string | undefined = block.params.debug_config_name
		const environmentVariablesStr: string | undefined = block.params.environment_variables
		const programArgumentsStr: string | undefined = block.params.program_arguments

		// Validate required parameters
		if (!filePath) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "file_path")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Parse optional parameters
		let environmentVariables: Record<string, string> = {}
		let programArguments: string[] = []

		try {
			if (environmentVariablesStr) {
				environmentVariables = JSON.parse(environmentVariablesStr)
			}
			if (programArgumentsStr) {
				programArguments = JSON.parse(programArgumentsStr)
			}
		} catch (error) {
			return formatResponse.toolError(`Invalid JSON in environment_variables or program_arguments: ${error}`)
		}

		// Check if file exists using the workspace file system
		const absoluteFilePath = resolveWorkspacePath(config.cwd, filePath)

		// Check auto-approval
		const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(this.name)
		const shouldAutoApprove = autoApproveResult === true || (Array.isArray(autoApproveResult) && autoApproveResult[0])

		if (!shouldAutoApprove) {
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
				"command",
				`Cline wants to start debugging file:\n\n${filePath}${debugConfigName ? `\nUsing debug configuration: ${debugConfigName}` : ""}`,
				config,
			)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}
		}

		showNotificationForApprovalIfAutoApprovalEnabled(
			`Cline is starting debug session for ${filePath}`,
			config.autoApprovalSettings.enabled,
			config.autoApprovalSettings.enableNotifications,
		)

		try {
			// Build debug request
			const request = StartDebuggingRequest.create({
				filePath: absoluteFilePath,
				debugConfigName: debugConfigName || "",
				environmentVariables: environmentVariables,
				programArguments: programArguments,
			})

			// Start the debug session
			const result = await startDebugging(request)

			if (result.error) {
				return formatResponse.toolError(`Failed to start debug session: ${result.error.message}`)
			} else {
				return `Debug session started successfully for file: ${absoluteFilePath}${debugConfigName ? `\nUsing debug configuration: ${debugConfigName}` : ""}${Object.keys(environmentVariables).length > 0 ? `\nEnvironment variables: ${JSON.stringify(environmentVariables)}` : ""}${programArguments.length > 0 ? `\nProgram arguments: ${JSON.stringify(programArguments)}` : ""}\n\nDebug session ID: ${result.sessionId || "N/A"}`
			}
		} catch (error) {
			return formatResponse.toolError(`Debug file failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
}
