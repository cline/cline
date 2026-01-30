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

	private buildToolMessageWithHistory(
		prompt: string,
		statusHistory: import("@/shared/cline/subagent").SubagentStatusEntry[],
	): string {
		const sharedProps: ClineSayTool = {
			tool: "subagent",
			path: undefined,
			content: JSON.stringify(statusHistory),
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

	async handlePartialBlock(block: ToolUse, _uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		if (!block.params.prompt) {
			return
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const prompt: string | undefined = block.params.prompt

		// Validate required parameter
		if (!prompt || !block.call_id) {
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
		return await this.performTask(config, prompt, block.call_id ?? "")
	}

	private async performTask(config: TaskConfig, prompt: string, callId: string): Promise<ToolResponse> {
		try {
			// Create AbortController for this task execution
			this.abortController = new AbortController()

			// Create agent with max 50 iterations for complex tasks
			const agent = new Subagent(callId, prompt, config, 30, undefined, config.api, this.abortController?.signal)

			const taskResults = await agent.execute(prompt)
			// Check if aborted
			if (this.abortController?.signal?.aborted) {
				const abortMessage = "[Subagent] Task was cancelled."
				const abortToolMessage = this.buildToolMessage(prompt, abortMessage)
				await config.callbacks.replaceMessageContentByUid(callId, abortToolMessage, false)
				return abortMessage
			}

			// Use the agent's status history for the final message to preserve the timeline UI
			const completeMessage = this.buildToolMessageWithHistory(prompt, agent.getStatusHistory())
			await config.callbacks.replaceMessageContentByUid(callId, completeMessage, false)

			return taskResults
		} catch (error) {
			const errorMessage = `[Subagent] Task Failed ${error instanceof Error ? error.message : String(error)}`
			Logger.error(errorMessage)
			const errorToolMessage = this.buildToolMessage(prompt, errorMessage)
			await config.callbacks.replaceMessageContentByUid(callId, errorToolMessage, false)
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
