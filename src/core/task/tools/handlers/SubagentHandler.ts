import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { Subagent } from "@/core/agents/Subagent"
import { ClineSayTool } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IAbortableToolHandler, IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/**
 * Handler for the task_subagent tool.
 * Launches a TaskAgent to perform complex, multi-step tasks autonomously.
 * The agent has access to search and bash tools to gather information.
 */
export class SubagentHandler implements IFullyManagedTool, IAbortableToolHandler {
	readonly name = ClineDefaultTool.SUBAGENT
	private abortController?: AbortController

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	private buildToolMessage(prompt: string, content: string): string {
		const sharedProps: ClineSayTool = {
			tool: "subagent",
			path: undefined,
			content,
			regex: undefined,
			filePattern: prompt,
			operationIsLocatedInWorkspace: true,
		}

		return JSON.stringify(sharedProps)
	}

	buildPartialToolMessage(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): string {
		const prompt = uiHelpers.removeClosingTag(block, "prompt", block.params.prompt)
		const sharedProps: ClineSayTool = {
			tool: "subagent",
			path: undefined,
			content: "",
			regex: undefined,
			filePattern: prompt,
			operationIsLocatedInWorkspace: true,
		}

		return JSON.stringify(sharedProps)
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const partialMessage = this.buildPartialToolMessage(block, uiHelpers)
		const isAutoApprove = uiHelpers.getConfig().callbacks.shouldAutoApproveTool(this.name)
		if (isAutoApprove) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const prompt: string | undefined = block.params.prompt

		// Validate required parameter
		if (!prompt) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "prompt")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Run PreToolUse hook after approval but before execution
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

		// Execute the task agent
		return await this.performTask(config, prompt)
	}

	private async performTask(config: TaskConfig, prompt: string): Promise<ToolResponse> {
		try {
			// Create AbortController for this task execution
			this.abortController = new AbortController()

			// Remove previous partial message by timestamp (safe for parallel tool execution)
			const sharedProps: ClineSayTool = {
				tool: "subagent",
				path: undefined,
				content: "",
				regex: undefined,
				filePattern: prompt,
				operationIsLocatedInWorkspace: true,
			}

			const partialMessage = JSON.stringify(sharedProps)

			const lastMessageTs = (await config.callbacks.say("tool", partialMessage, undefined, undefined, true)) || Date.now()

			// Create agent with max 50 iterations for complex tasks
			const agent = new Subagent(lastMessageTs, prompt, config, 50, undefined, config.api, this.abortController?.signal)

			const taskResults = await agent.execute(prompt)
			// Check if aborted
			if (this.abortController?.signal?.aborted) {
				const abortMessage = "Task agent was cancelled."
				const abortToolMessage = this.buildToolMessage(prompt, abortMessage)
				await config.callbacks.say("tool", abortToolMessage, undefined, undefined, false)
				return abortMessage
			}

			const formattedResults =
				typeof taskResults === "string"
					? taskResults
					: Array.isArray(taskResults)
						? taskResults.map((r) => (r.type === "text" ? r.text : "")).join("\n\n")
						: String(taskResults)

			const completeMessage = this.buildToolMessage(prompt, formattedResults)
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

			return taskResults
		} catch (error) {
			Logger.error("Task agent error:", error)
			const errorMessage = `Task agent error: ${error instanceof Error ? error.message : String(error)}`
			const errorToolMessage = this.buildToolMessage(prompt, errorMessage)
			await config.callbacks.say("tool", errorToolMessage, undefined, undefined, false)
			return errorMessage
		} finally {
			this.abortController = undefined
		}
	}

	/**
	 * Aborts the currently running task agent, if any.
	 */
	public abort(): void {
		this.abortController?.abort()
	}
}
