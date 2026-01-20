/**
 * Mode command handlers
 */

import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Handle /plan command
 */
export const handlePlan: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	await ctx.controller.togglePlanActMode("plan")
	ctx.fmt.success("Switched to plan mode")
	return true
}

/**
 * Handle /act command
 */
export const handleAct: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	await ctx.controller.togglePlanActMode("act")
	ctx.fmt.success("Switched to act mode")
	return true
}

/**
 * Handle /mode command
 */
export const handleMode: CommandHandler = async (args: string[], ctx: CommandContext): Promise<boolean> => {
	if (args.length === 0) {
		const state = await ctx.controller.getStateToPostToWebview()
		ctx.fmt.info(`Current mode: ${state.mode || "unknown"}`)
	} else {
		const newMode = args[0].toLowerCase()
		if (newMode !== "plan" && newMode !== "act") {
			ctx.fmt.error("Invalid mode. Use 'plan' or 'act'")
		} else {
			await ctx.controller.togglePlanActMode(newMode as "plan" | "act")
			ctx.fmt.success(`Switched to ${newMode} mode`)
		}
	}
	return true
}
