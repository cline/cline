import { Task } from "../task/Task"
import { getModeBySlug } from "../../shared/modes"
import type { ContextOverflowContingency } from "@roo-code/types"

export class ContextOverflowHandler {
	private task: Task
	private lastToolUsed?: string

	constructor(task: Task) {
		this.task = task
	}

	/**
	 * Records the last tool used for context overflow tracking
	 */
	recordToolUse(toolName: string): void {
		this.lastToolUsed = toolName
	}

	/**
	 * Checks if context overflow contingency should be triggered
	 */
	async shouldTriggerContingency(contextTokens: number, contextWindow: number, maxTokens?: number): Promise<boolean> {
		const state = await this.task.providerRef.deref()?.getState()
		if (!state) return false

		const mode = getModeBySlug(state.mode, state.customModes)
		const contingency = mode?.contextOverflowContingency

		if (!contingency?.enabled) {
			return false
		}

		// Calculate if we're approaching context overflow
		const reservedTokens = maxTokens || contextWindow * 0.2
		const allowedTokens = contextWindow * 0.9 - reservedTokens // 90% threshold

		const isOverflowing = contextTokens > allowedTokens

		// If specific tools are configured, only trigger for those tools
		if (contingency.triggerTools && contingency.triggerTools.length > 0) {
			return isOverflowing && !!this.lastToolUsed && contingency.triggerTools.includes(this.lastToolUsed)
		}

		// Otherwise trigger for any overflow
		return isOverflowing
	}

	/**
	 * Triggers the context overflow contingency
	 */
	async triggerContingency(): Promise<void> {
		const state = await this.task.providerRef.deref()?.getState()
		if (!state) return

		const mode = getModeBySlug(state.mode, state.customModes)
		const contingency = mode?.contextOverflowContingency

		if (!contingency?.enabled) {
			return
		}

		// Generate the contingency message
		let message =
			contingency.message ||
			"Task failed because of a context overflow, possibly because webpage returned from the browser was too big"

		// If we have a last tool used, customize the message
		if (this.lastToolUsed) {
			if (!contingency.message) {
				message = `Task failed because of a context overflow after using ${this.lastToolUsed}, possibly because the content returned was too large`
			}
		}

		// Log the contingency trigger
		console.log(`[ContextOverflow] Triggering contingency for task ${this.task.taskId} due to context overflow`)

		// If this is a subtask, complete it with the overflow message
		if (this.task.parentTask) {
			await this.task.providerRef.deref()?.finishSubTask(message)
		} else {
			// For main tasks, show the overflow message and pause
			await this.task.say("error", message)
		}
	}

	/**
	 * Gets the contingency configuration for the current mode
	 */
	async getContingencyConfig(): Promise<ContextOverflowContingency | undefined> {
		const state = await this.task.providerRef.deref()?.getState()
		if (!state) return undefined

		const mode = getModeBySlug(state.mode, state.customModes)
		return mode?.contextOverflowContingency
	}
}
