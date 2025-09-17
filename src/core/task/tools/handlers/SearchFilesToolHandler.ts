import type { ToolUse } from "@core/assistant-message"
import { regexSearchFiles } from "@services/ripgrep"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import * as path from "path"
import { formatResponse } from "@/core/prompts/responses"
import { parseWorkspaceInlinePath } from "@/core/workspace/utils/parseWorkspaceInlinePath"
import { WorkspacePathAdapter } from "@/core/workspace/WorkspacePathAdapter"
import { resolveWorkspacePath } from "@/core/workspace/WorkspaceResolver"
import { telemetryService } from "@/services/telemetry"
import { ClineSayTool } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class SearchFilesToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.SEARCH

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.regex}'${
			block.params.file_pattern ? ` in '${block.params.file_pattern}'` : ""
		}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path
		const regex = block.params.regex

		const config = uiHelpers.getConfig()

		// Create and show partial UI message
		const filePattern = block.params.file_pattern

		const sharedMessageProps = {
			tool: "searchFiles",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: "",
			regex: uiHelpers.removeClosingTag(block, "regex", regex),
			filePattern: uiHelpers.removeClosingTag(block, "file_pattern", filePattern),
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		} satisfies ClineSayTool

		const partialMessage = JSON.stringify(sharedMessageProps)

		// Handle auto-approval vs manual approval for partial
		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const relDirPath: string | undefined = block.params.path
		const regex: string | undefined = block.params.regex
		const filePattern: string | undefined = block.params.file_pattern

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "path")
		}

		if (!regex) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "regex")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Parse workspace hint from the path
		const { workspaceHint, relPath: parsedPath } = parseWorkspaceInlinePath(relDirPath!)

		// Multi-workspace search logic
		let results: string = ""
		let searchPaths: Array<{ absolutePath: string; workspaceName?: string }> = []

		if (config.isMultiRootEnabled && config.workspaceManager) {
			const adapter = new WorkspacePathAdapter({
				cwd: config.cwd,
				isMultiRootEnabled: true,
				workspaceManager: config.workspaceManager,
			})

			if (workspaceHint) {
				// Search only in the specified workspace
				const absolutePath = adapter.resolvePath(parsedPath, workspaceHint)
				searchPaths = [{ absolutePath, workspaceName: workspaceHint }]
			} else {
				// Search across all workspaces
				const allPaths = adapter.getAllPossiblePaths(parsedPath)
				const workspaceRoots = adapter.getWorkspaceRoots()
				searchPaths = allPaths.map((absPath, index) => ({
					absolutePath: absPath,
					workspaceName: workspaceRoots[index]?.name || path.basename(workspaceRoots[index]?.path || absPath),
				}))
			}
		} else {
			// Single-workspace mode (backward compatible)
			const pathResult = resolveWorkspacePath(config, relDirPath!, "SearchFilesTool.execute")
			const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
			searchPaths = [{ absolutePath }]
		}

		// Execute searches in all relevant workspaces
		const allResults: string[] = []
		let totalResultCount = 0

		for (const { absolutePath, workspaceName } of searchPaths) {
			try {
				const workspaceResults = await regexSearchFiles(
					config.cwd,
					absolutePath,
					regex,
					filePattern,
					config.services.clineIgnoreController,
				)

				// Parse the result count from the first line
				const firstLine = workspaceResults.split("\n")[0]
				const resultMatch = firstLine.match(/Found (\d+) result/)
				if (resultMatch) {
					totalResultCount += parseInt(resultMatch[1], 10)
				}

				// If multi-workspace and we have results, annotate with workspace name
				if (
					config.isMultiRootEnabled &&
					searchPaths.length > 1 &&
					workspaceName &&
					workspaceResults &&
					!workspaceResults.startsWith("Found 0 results")
				) {
					// Skip the "Found X results" line and add workspace annotation
					const lines = workspaceResults.split("\n")
					const resultsWithoutHeader = lines.slice(2).join("\n") // Skip first two lines (count and empty line)

					if (resultsWithoutHeader.trim()) {
						allResults.push(`## Workspace: ${workspaceName}\n${resultsWithoutHeader}`)
					}
				} else if (!config.isMultiRootEnabled || searchPaths.length === 1) {
					// Single workspace mode or single workspace search
					allResults.push(workspaceResults)
				}
			} catch (error) {
				// If search fails in one workspace, continue with others
				console.error(`Search failed in ${absolutePath}:`, error)
			}
		}

		// Combine results
		if (config.isMultiRootEnabled && searchPaths.length > 1) {
			// Multi-workspace search result
			if (allResults.length === 0 || totalResultCount === 0) {
				results = "Found 0 results."
			} else {
				results = `Found ${totalResultCount === 1 ? "1 result" : `${totalResultCount.toLocaleString()} results`} across ${searchPaths.length} workspace${searchPaths.length > 1 ? "s" : ""}.\n\n${allResults.join("\n\n")}`
			}
		} else {
			// Single workspace result
			results = allResults[0] || "Found 0 results."
		}

		const sharedMessageProps = {
			tool: "searchFiles",
			path: getReadablePath(config.cwd, relDirPath!),
			content: results,
			regex: regex,
			filePattern: filePattern,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(parsedPath),
		} satisfies ClineSayTool

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath)) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			config.taskState.consecutiveAutoApprovedRequestsCount++

			// Capture telemetry
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			// Manual approval flow
			const notificationMessage = `Cline wants to search files for ${regex}`

			// Show notification
			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
				return formatResponse.toolDenied()
			} else {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
			}
		}

		return results
	}
}
