/**
 * Status command handler
 */

import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Handle /status, /s commands
 */
export const handleStatus: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	const state = await ctx.controller.getStateToPostToWebview()
	ctx.fmt.raw("")
	ctx.fmt.info(`Task ID: ${ctx.session.taskId || "none"}`)
	ctx.fmt.info(`Mode: ${state.mode || "unknown"}`)
	ctx.fmt.info(`Messages: ${state.clineMessages?.length || 0}`)
	if (ctx.session.awaitingApproval) {
		ctx.fmt.warn("Awaiting approval (use /approve or /deny)")
	}
	if (ctx.session.awaitingInput) {
		ctx.fmt.warn("Awaiting user input")
	}
	ctx.fmt.raw("")
	return true
}
