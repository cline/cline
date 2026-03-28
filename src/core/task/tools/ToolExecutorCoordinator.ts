import type { ToolUse } from "@core/assistant-message"
import { CLINE_MCP_TOOL_IDENTIFIER } from "@/shared/mcp"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../index"
import { AccessMcpResourceHandler } from "./handlers/AccessMcpResourceHandler"
import { ActModeRespondHandler } from "./handlers/ActModeRespondHandler"
import { ApplyPatchHandler } from "./handlers/ApplyPatchHandler"
import { AskFollowupQuestionToolHandler } from "./handlers/AskFollowupQuestionToolHandler"
import { AttemptCompletionHandler } from "./handlers/AttemptCompletionHandler"
import { BrowserToolHandler } from "./handlers/BrowserToolHandler"
import { CondenseHandler } from "./handlers/CondenseHandler"
import { ExecuteCommandToolHandler } from "./handlers/ExecuteCommandToolHandler"
import { GenerateExplanationToolHandler } from "./handlers/GenerateExplanationToolHandler"
import { ListCodeDefinitionNamesToolHandler } from "./handlers/ListCodeDefinitionNamesToolHandler"
import { ListFilesToolHandler } from "./handlers/ListFilesToolHandler"
import { LoadMcpDocumentationHandler } from "./handlers/LoadMcpDocumentationHandler"
import { NewTaskHandler } from "./handlers/NewTaskHandler"
import { PlanModeRespondHandler } from "./handlers/PlanModeRespondHandler"
import { ReadFileToolHandler } from "./handlers/ReadFileToolHandler"
import { ReportBugHandler } from "./handlers/ReportBugHandler"
import { SearchFilesToolHandler } from "./handlers/SearchFilesToolHandler"
import { UseSubagentsToolHandler } from "./handlers/SubagentToolHandler"
import { SummarizeTaskHandler } from "./handlers/SummarizeTaskHandler"
import { UseMcpToolHandler } from "./handlers/UseMcpToolHandler"
import { UseSkillToolHandler } from "./handlers/UseSkillToolHandler"
import { WebFetchToolHandler } from "./handlers/WebFetchToolHandler"
import { WebSearchToolHandler } from "./handlers/WebSearchToolHandler"
import { WriteToFileToolHandler } from "./handlers/WriteToFileToolHandler"
import { AgentConfigLoader } from "./subagent/AgentConfigLoader"
import { ToolValidator } from "./ToolValidator"
import type { TaskConfig } from "./types/TaskConfig"
import type { StronglyTypedUIHelpers } from "./types/UIHelpers"

export interface IToolHandler {
	readonly name: ClineDefaultTool
	execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse>
	getDescription(block: ToolUse): string
}

export interface IPartialBlockHandler {
	handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void>
}

export interface IFullyManagedTool extends IToolHandler, IPartialBlockHandler {
	// Marker interface for tools that handle their own complete approval flow
}

/**
 * A wrapper class that allows a single tool handler to be registered under multiple names.
 * This provides proper typing for tools that share the same implementation logic.
 */
export class SharedToolHandler implements IFullyManagedTool {
	constructor(
		public readonly name: ClineDefaultTool,
		private baseHandler: IFullyManagedTool,
	) {}

	getDescription(block: ToolUse): string {
		return this.baseHandler.getDescription(block)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		return this.baseHandler.execute(config, block)
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		return this.baseHandler.handlePartialBlock(block, uiHelpers)
	}
}

/**
 * Coordinates tool execution by routing to registered handlers.
 * Falls back to legacy switch for unregistered tools.
 */
export class ToolExecutorCoordinator {
	private handlers = new Map<string, IToolHandler>()
	private dynamicSubagentHandlers = new Map<string, IToolHandler>()

	private readonly toolHandlersMap: Record<ClineDefaultTool, (v: ToolValidator) => IToolHandler | undefined> = {
		[ClineDefaultTool.ASK]: (_v: ToolValidator) => new AskFollowupQuestionToolHandler(),
		[ClineDefaultTool.ATTEMPT]: (_v: ToolValidator) => new AttemptCompletionHandler(),
		[ClineDefaultTool.BASH]: (v: ToolValidator) => new ExecuteCommandToolHandler(v),
		[ClineDefaultTool.FILE_EDIT]: (v: ToolValidator) =>
			new SharedToolHandler(ClineDefaultTool.FILE_EDIT, new WriteToFileToolHandler(v)),
		[ClineDefaultTool.FILE_READ]: (v: ToolValidator) => new ReadFileToolHandler(v),
		[ClineDefaultTool.FILE_NEW]: (v: ToolValidator) => new WriteToFileToolHandler(v),
		[ClineDefaultTool.SEARCH]: (v: ToolValidator) => new SearchFilesToolHandler(v),
		[ClineDefaultTool.LIST_FILES]: (v: ToolValidator) => new ListFilesToolHandler(v),
		[ClineDefaultTool.LIST_CODE_DEF]: (v: ToolValidator) => new ListCodeDefinitionNamesToolHandler(v),
		[ClineDefaultTool.BROWSER]: (_v: ToolValidator) => new BrowserToolHandler(),
		[ClineDefaultTool.MCP_USE]: (_v: ToolValidator) => new UseMcpToolHandler(),
		[ClineDefaultTool.MCP_ACCESS]: (_v: ToolValidator) => new AccessMcpResourceHandler(),
		[ClineDefaultTool.MCP_DOCS]: (_v: ToolValidator) => new LoadMcpDocumentationHandler(),
		[ClineDefaultTool.NEW_TASK]: (_v: ToolValidator) => new NewTaskHandler(),
		[ClineDefaultTool.PLAN_MODE]: (_v: ToolValidator) => new PlanModeRespondHandler(),
		[ClineDefaultTool.ACT_MODE]: (_v: ToolValidator) => new ActModeRespondHandler(),
		[ClineDefaultTool.TODO]: (_v: ToolValidator) => undefined,
		[ClineDefaultTool.WEB_FETCH]: (_v: ToolValidator) => new WebFetchToolHandler(),
		[ClineDefaultTool.WEB_SEARCH]: (_v: ToolValidator) => new WebSearchToolHandler(),
		[ClineDefaultTool.CONDENSE]: (_v: ToolValidator) => new CondenseHandler(),
		[ClineDefaultTool.SUMMARIZE_TASK]: (_v: ToolValidator) => new SummarizeTaskHandler(_v),
		[ClineDefaultTool.REPORT_BUG]: (_v: ToolValidator) => new ReportBugHandler(),
		[ClineDefaultTool.NEW_RULE]: (v: ToolValidator) =>
			new SharedToolHandler(ClineDefaultTool.NEW_RULE, new WriteToFileToolHandler(v)),
		[ClineDefaultTool.APPLY_PATCH]: (_v: ToolValidator) => new ApplyPatchHandler(_v),
		[ClineDefaultTool.GENERATE_EXPLANATION]: (_v: ToolValidator) => new GenerateExplanationToolHandler(),
		[ClineDefaultTool.USE_SKILL]: (_v: ToolValidator) => new UseSkillToolHandler(),
		[ClineDefaultTool.USE_SUBAGENTS]: (_v: ToolValidator) => new UseSubagentsToolHandler(),
	}

	/**
	 * Register a tool handler
	 */
	register(handler: IToolHandler): void {
		this.handlers.set(handler.name, handler)
	}

	registerByName(toolName: ClineDefaultTool, validator: ToolValidator): void {
		const handler = this.toolHandlersMap[toolName]?.(validator)
		if (handler) {
			this.register(handler)
		}
	}

	/**
	 * Check if a handler is registered for the given tool
	 */
	has(toolName: string): boolean {
		return this.getHandler(toolName) !== undefined
	}

	/**
	 * Get a handler for the given tool name
	 */
	getHandler(toolName: string): IToolHandler | undefined {
		// HACK: Normalize MCP tool names to the standard handler
		if (toolName.includes(CLINE_MCP_TOOL_IDENTIFIER)) {
			toolName = ClineDefaultTool.MCP_USE
		}

		const staticHandler = this.handlers.get(toolName)
		if (staticHandler) {
			return staticHandler
		}

		if (AgentConfigLoader.getInstance().isDynamicSubagentTool(toolName)) {
			const existingHandler = this.dynamicSubagentHandlers.get(toolName)
			if (existingHandler) {
				return existingHandler
			}
			const handler = new SharedToolHandler(toolName as ClineDefaultTool, new UseSubagentsToolHandler())
			this.dynamicSubagentHandlers.set(toolName, handler)
			return handler
		}

		return undefined
	}

	/**
	 * Execute a tool through its registered handler
	 */
	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const handler = this.getHandler(block.name)
		if (!handler) {
			throw new Error(`No handler registered for tool: ${block.name}`)
		}
		return handler.execute(config, block)
	}
}
