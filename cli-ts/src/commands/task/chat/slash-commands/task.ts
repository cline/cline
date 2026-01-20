/**
 * Task-related command handlers (cancel, approve, deny)
 */

import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Handle /cancel command
 */
export const handleCancel: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	if (ctx.controller.task) {
		await ctx.controller.cancelTask()
		ctx.fmt.success("Task cancelled")
	} else {
		ctx.fmt.warn("No active task to cancel")
	}
	return true
}

/**
 * Handle /approve, /a, /y commands
 */
export const handleApprove: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	if (!ctx.session.awaitingApproval) {
		ctx.fmt.warn("No pending approval request")
	} else if (ctx.controller.task) {
		await ctx.controller.task.handleWebviewAskResponse("yesButtonClicked")
		ctx.session.awaitingApproval = false
		ctx.fmt.success("Action approved")
	}
	return true
}

/**
 * Handle /deny, /d, /n commands
 */
export const handleDeny: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	if (!ctx.session.awaitingApproval) {
		ctx.fmt.warn("No pending approval request")
	} else if (ctx.controller.task) {
		await ctx.controller.task.handleWebviewAskResponse("noButtonClicked")
		ctx.session.awaitingApproval = false
		ctx.fmt.success("Action denied")
	}
	return true
}
