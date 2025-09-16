/**
 * Hook Response Handler
 * Processes hook responses and applies modifications
 */

import { ToolUse } from "@core/assistant-message"
import { ClineSay } from "@shared/ExtensionMessage"
import { AggregatedHookResult } from "../types/HookResponse"

export interface HookResponseHandlerContext {
	say: (type: ClineSay, text?: string) => Promise<void>
	addContext?: (context: string) => void
}

export class HookResponseHandler {
	constructor(private context: HookResponseHandlerContext) {}

	/**
	 * Handle PreToolUse hook response
	 * Returns modified tool input if hooks provide modifications
	 */
	async handlePreToolUseResponse(
		result: AggregatedHookResult | null,
		toolBlock: ToolUse,
	): Promise<{ approved: boolean; modifiedBlock?: ToolUse }> {
		if (!result) {
			// No hooks executed, approve by default
			return { approved: true }
		}

		// Display messages from hooks
		await this.displayMessages(result.messages)

		// Add additional context if provided
		if (result.additionalContext) {
			this.addAdditionalContext(result.additionalContext)
		}

		if (!result.approve) {
			// Tool execution denied
			await this.context.say("error", `Tool execution denied by hook: ${result.messages.join(", ")}`)
			return { approved: false }
		}

		// Check for input modifications
		if (result.modifiedInput) {
			// Create modified tool block
			const modifiedBlock = this.applyInputModifications(toolBlock, result.modifiedInput)
			return { approved: true, modifiedBlock }
		}

		return { approved: true }
	}

	/**
	 * Handle PostToolUse hook response
	 * Returns modified output if hooks provide modifications
	 */
	async handlePostToolUseResponse(
		result: AggregatedHookResult | null,
		toolResponse: unknown,
	): Promise<{ modifiedResponse?: unknown }> {
		if (!result) {
			// No hooks executed
			return {}
		}

		// Display messages from hooks
		await this.displayMessages(result.messages)

		// Add additional context if provided
		if (result.additionalContext) {
			this.addAdditionalContext(result.additionalContext)
		}

		// Check for output modifications
		if (result.modifiedOutput !== undefined) {
			return { modifiedResponse: result.modifiedOutput }
		}

		return {}
	}

	/**
	 * Handle UserPromptSubmit hook response
	 * Returns modified prompt if hooks provide modifications
	 */
	async handleUserPromptSubmitResponse(
		result: AggregatedHookResult | null,
		prompt: string,
	): Promise<{ approved: boolean; modifiedPrompt?: string }> {
		if (!result) {
			return { approved: true }
		}

		// Display messages from hooks
		await this.displayMessages(result.messages)

		// Add additional context if provided
		if (result.additionalContext) {
			this.addAdditionalContext(result.additionalContext)
		}

		if (!result.approve) {
			await this.context.say("error", `Prompt submission denied by hook: ${result.messages.join(", ")}`)
			return { approved: false }
		}

		// Check if prompt should be modified
		if (result.modifiedInput && typeof result.modifiedInput === "string") {
			return { approved: true, modifiedPrompt: result.modifiedInput }
		}

		return { approved: true }
	}

	/**
	 * Handle generic hook response (for Stop, SessionStart, etc.)
	 */
	async handleGenericResponse(result: AggregatedHookResult | null): Promise<void> {
		if (!result) {
			return
		}

		// Display messages from hooks
		await this.displayMessages(result.messages)

		// Add additional context if provided
		if (result.additionalContext) {
			this.addAdditionalContext(result.additionalContext)
		}
	}

	/**
	 * Apply input modifications to a tool block
	 */
	private applyInputModifications(toolBlock: ToolUse, modifications: unknown): ToolUse {
		// Create a copy of the tool block
		const modifiedBlock = { ...toolBlock }

		// Apply modifications to params
		if (typeof modifications === "object" && modifications !== null) {
			// Merge modifications into params
			modifiedBlock.params = {
				...toolBlock.params,
				...(modifications as Record<string, string>),
			}
		}

		return modifiedBlock
	}

	/**
	 * Display messages from hooks to the user
	 */
	private async displayMessages(messages: string[]): Promise<void> {
		for (const message of messages) {
			if (message && message.trim()) {
				await this.context.say("text", message)
			}
		}
	}

	/**
	 * Add additional context to the conversation
	 */
	private addAdditionalContext(context: string[]): void {
		if (this.context.addContext) {
			for (const ctx of context) {
				if (ctx && ctx.trim()) {
					this.context.addContext(ctx)
				}
			}
		}
	}

	/**
	 * Format denial message for display
	 */
	formatDenialMessage(reason: string, toolName?: string): string {
		if (toolName) {
			return `Hook denied execution of '${toolName}': ${reason}`
		}
		return `Hook denied operation: ${reason}`
	}

	/**
	 * Check if a result indicates approval
	 */
	isApproved(result: AggregatedHookResult | null): boolean {
		return !result || result.approve
	}

	/**
	 * Get consolidated message from result
	 */
	getConsolidatedMessage(result: AggregatedHookResult | null): string | null {
		if (!result || result.messages.length === 0) {
			return null
		}
		return result.messages.join("\n")
	}
}
