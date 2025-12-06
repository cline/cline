import * as path from "node:path"
import type { ToolUse } from "@core/assistant-message"
import { regexSearchFiles } from "@services/ripgrep"
import { arePathsEqual, getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { SearchAgent } from "@/core/agents/SearchAgent"
import { formatResponse } from "@/core/prompts/responses"
import { parseWorkspaceInlinePath } from "@/core/workspace/utils/parseWorkspaceInlinePath"
import { WorkspacePathAdapter } from "@/core/workspace/WorkspacePathAdapter"
import { resolveWorkspacePath } from "@/core/workspace/WorkspaceResolver"
import { telemetryService } from "@/services/telemetry"
import { ClineSayTool } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

interface SearchPath {
	absolutePath: string
	workspaceName?: string
	workspaceRoot?: string
}

interface SearchResult {
	workspaceName?: string
	workspaceResults: string
	resultCount: number
	success: boolean
}

interface WorkspaceContext {
	isMultiRootEnabled: boolean
	usedWorkspaceHint: boolean
	resolvedToNonPrimary: boolean
	resolutionMethod: "hint" | "primary_fallback" | "path_detection"
}

export class SearchSubAgentHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.SEARCH_AGENT
	private static subagentCost = 0
	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	static getCost(): number {
		const cost = SearchSubAgentHandler.subagentCost
		SearchSubAgentHandler.subagentCost = 0
		return cost
	}

	private determineSearchPaths(
		config: TaskConfig,
		parsedPath: string,
		workspaceHint: string | undefined,
		originalPath: string,
	): SearchPath[] {
		if (!config.isMultiRootEnabled || !config.workspaceManager) {
			const pathResult = resolveWorkspacePath(config, originalPath, "SearchFilesTool.execute")
			const absolutePath = typeof pathResult === "string" ? pathResult : pathResult.absolutePath
			return [{ absolutePath, workspaceRoot: config.cwd }]
		}

		const adapter = new WorkspacePathAdapter({
			cwd: config.cwd,
			isMultiRootEnabled: true,
			workspaceManager: config.workspaceManager,
		})

		if (workspaceHint) {
			const absolutePath = adapter.resolvePath(parsedPath, workspaceHint)
			const root = adapter.getWorkspaceRoots().find((r) => r.name === workspaceHint)
			return [{ absolutePath, workspaceName: workspaceHint, workspaceRoot: root?.path }]
		}

		const allPaths = adapter.getAllPossiblePaths(parsedPath)
		const workspaceRoots = adapter.getWorkspaceRoots()
		return allPaths.map((absPath, index) => {
			const root = workspaceRoots[index]
			return {
				absolutePath: absPath,
				workspaceName: root?.name || path.basename(root?.path || absPath),
				workspaceRoot: root?.path,
			}
		})
	}

	private async executeSearch(
		config: TaskConfig,
		absolutePath: string,
		workspaceName: string | undefined,
		workspaceRoot: string | undefined,
		regex: string,
		filePattern: string | undefined,
	): Promise<SearchResult> {
		try {
			const basePathForRelative = workspaceRoot || config.cwd
			const workspaceResults = await regexSearchFiles(
				basePathForRelative,
				absolutePath,
				regex,
				filePattern,
				config.services.clineIgnoreController,
			)

			const firstLine = workspaceResults.split("\n")[0]
			const resultMatch = firstLine.match(/Found (\d+) result/)
			const resultCount = resultMatch ? parseInt(resultMatch[1], 10) : 0

			return {
				workspaceName,
				workspaceResults,
				resultCount,
				success: true,
			}
		} catch (error) {
			console.error(`Search failed in ${absolutePath}:`, error)
			return {
				workspaceName,
				workspaceResults: "",
				resultCount: 0,
				success: false,
			}
		}
	}

	private formatSearchResults(config: TaskConfig, searchResults: SearchResult[], searchPaths: SearchPath[]): string {
		const isMultiWorkspace = config.isMultiRootEnabled && searchPaths.length > 1
		const resultParts: string[] = []
		let totalResultCount = 0

		for (const result of searchResults) {
			if (!result.success || !result.workspaceResults) {
				continue
			}

			totalResultCount += result.resultCount

			if (isMultiWorkspace && result.workspaceName && result.resultCount > 0) {
				const lines = result.workspaceResults.split("\n")
				const resultsWithoutHeader = lines.length > 2 ? lines.slice(2).join("\n") : result.workspaceResults
				if (resultsWithoutHeader.trim()) {
					resultParts.push(`## Workspace: ${result.workspaceName}\n${resultsWithoutHeader}`)
				}
			} else if (!isMultiWorkspace) {
				resultParts.push(result.workspaceResults)
			}
		}

		if (isMultiWorkspace) {
			if (totalResultCount === 0) {
				return "Found 0 results."
			}
			const resultLabel = totalResultCount === 1 ? "1 result" : `${totalResultCount.toLocaleString()} results`
			const workspaceLabel = searchPaths.length > 1 ? "s" : ""
			return `Found ${resultLabel} across ${searchPaths.length} workspace${workspaceLabel}.\n\n${resultParts.join("\n\n")}`
		}

		return resultParts[0] || "Found 0 results."
	}

	private async buildToolMessage(config: TaskConfig, block: ToolUse, content: string, parsedPath: string): Promise<string> {
		const sharedProps: ClineSayTool = {
			tool: block.params.input ? "searchAgent" : "searchFiles",
			path: getReadablePath(config.cwd, block.params.path),
			content,
			regex: block.params.regex,
			filePattern: block.params.input || block.params.file_pattern,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(parsedPath),
		}

		return JSON.stringify(sharedProps)
	}

	private async buildPartialToolMessage(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<string> {
		const config = uiHelpers.getConfig()
		const sharedProps: ClineSayTool = {
			tool: block.params.input ? "searchAgent" : "searchFiles",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", block.params.path)),
			content: "",
			regex: uiHelpers.removeClosingTag(block, "regex", block.params.regex),
			filePattern: block.params.input || uiHelpers.removeClosingTag(block, "file_pattern", block.params.file_pattern),
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
		}

		return JSON.stringify(sharedProps)
	}

	private buildWorkspaceContext(
		config: TaskConfig,
		searchPaths: SearchPath[],
		workspaceHint: string | undefined,
	): WorkspaceContext {
		const primaryWorkspaceRoot = searchPaths[0]?.workspaceRoot
		const resolvedToNonPrimary =
			searchPaths.length === 0 ||
			searchPaths.length > 1 ||
			(primaryWorkspaceRoot ? !arePathsEqual(primaryWorkspaceRoot, config.cwd) : true)

		let resolutionMethod: "hint" | "primary_fallback" | "path_detection"
		if (workspaceHint) {
			resolutionMethod = "hint"
		} else if (searchPaths.length > 1) {
			resolutionMethod = "path_detection"
		} else {
			resolutionMethod = "primary_fallback"
		}

		return {
			isMultiRootEnabled: config.isMultiRootEnabled || false,
			usedWorkspaceHint: !!workspaceHint,
			resolvedToNonPrimary,
			resolutionMethod,
		}
	}

	private capturePathResolutionTelemetry(
		config: TaskConfig,
		searchPaths: SearchPath[],
		workspaceHint: string | undefined,
	): void {
		if (!config.isMultiRootEnabled || !config.workspaceManager) {
			return
		}

		const resolutionType = workspaceHint
			? "hint_provided"
			: searchPaths.length > 1
				? "cross_workspace_search"
				: "fallback_to_primary"

		telemetryService.captureWorkspacePathResolved(
			config.ulid,
			"SearchFilesToolHandler",
			resolutionType,
			workspaceHint ? "workspace_name" : undefined,
			searchPaths.length > 0,
			undefined,
			true,
		)
	}

	private captureSearchPatternTelemetry(
		config: TaskConfig,
		searchPaths: SearchPath[],
		searchResults: SearchResult[],
		workspaceHint: string | undefined,
		searchDurationMs: number,
	): void {
		if (!config.isMultiRootEnabled || !config.workspaceManager) {
			return
		}

		const searchType = workspaceHint ? "targeted" : searchPaths.length > 1 ? "cross_workspace" : "primary_only"
		const resultsFound = searchResults.some((result) => result.resultCount > 0)

		telemetryService.captureWorkspaceSearchPattern(
			config.ulid,
			searchType,
			searchPaths.length,
			!!workspaceHint,
			resultsFound,
			searchDurationMs,
		)
	}

	private captureToolUsageTelemetry(
		config: TaskConfig,
		block: ToolUse,
		workspaceContext: WorkspaceContext,
		isAutoApproved: boolean,
		didApprove: boolean,
	): void {
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		telemetryService.captureToolUsage(
			config.ulid,
			block.name,
			config.api.getModel().id,
			provider,
			isAutoApproved,
			didApprove,
			workspaceContext,
			block.isNativeToolCall,
		)
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const partialMessage = await this.buildPartialToolMessage(block, uiHelpers)
		const isAutoApprove = await uiHelpers.shouldAutoApproveToolWithPath(block.name, block.params.path)

		if (isAutoApprove) {
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
		const searchInput: string | undefined = block.params.input

		if (searchInput) {
			return await this.performNaturalLanguageSearch(config, block, searchInput)
		}

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

		const { workspaceHint, relPath: parsedPath } = parseWorkspaceInlinePath(relDirPath!)
		const searchPaths = this.determineSearchPaths(config, parsedPath, workspaceHint, relDirPath!)
		const workspaceContext = this.buildWorkspaceContext(config, searchPaths, workspaceHint)

		this.capturePathResolutionTelemetry(config, searchPaths, workspaceHint)

		const searchStartTime = performance.now()
		const searchResults = await Promise.all(
			searchPaths.map(({ absolutePath, workspaceName, workspaceRoot }) =>
				this.executeSearch(config, absolutePath, workspaceName, workspaceRoot, regex, filePattern),
			),
		)
		const searchDurationMs = performance.now() - searchStartTime

		this.captureSearchPatternTelemetry(config, searchPaths, searchResults, workspaceHint, searchDurationMs)

		const results = this.formatSearchResults(config, searchResults, searchPaths)
		const completeMessage = await this.buildToolMessage(config, block, results, parsedPath)
		const isAutoApprove = await config.callbacks.shouldAutoApproveToolWithPath(block.name, relDirPath)

		if (isAutoApprove) {
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			this.captureToolUsageTelemetry(config, block, workspaceContext, true, true)
		} else {
			showNotificationForApproval(
				`Cline wants to search files for ${regex}`,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			this.captureToolUsageTelemetry(config, block, workspaceContext, false, didApprove)

			if (!didApprove) {
				return formatResponse.toolDenied()
			}
		}

		try {
			const { ToolHookUtils } = await import("../utils/ToolHookUtils")
			await ToolHookUtils.runPreToolUseIfEnabled(config, block)
		} catch (error) {
			const { PreToolUseHookCancellationError } = await import("@core/hooks/PreToolUseHookCancellationError")
			if (error instanceof PreToolUseHookCancellationError) {
				return formatResponse.toolDenied()
			}
			throw error
		}

		return results
	}

	private async performNaturalLanguageSearch(config: TaskConfig, block: ToolUse, searchInput: string): Promise<ToolResponse> {
		try {
			const agent = new SearchAgent(config, "x-ai/grok-code-fast-1", 3, (cost: number) => {
				SearchSubAgentHandler.subagentCost = cost
			})

			const searchResults = await agent.execute(searchInput)
			const formattedResults = Array.isArray(searchResults)
				? searchResults?.map((r) => (r.type === "text" ? r.text : ""))?.join("\n\n")
				: searchResults
			const completeMessage = await this.buildToolMessage(config, block, formattedResults, block.params.path || "")
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

			return searchResults
		} catch (error) {
			console.error("Natural language search error:", error)
			return `Natural language search error: ${error instanceof Error ? error.message : String(error)}`
		}
	}
}
