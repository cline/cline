/**
 * Quit command handler
 */

import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Handle /quit, /q, /exit commands
 */
export const handleQuit: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	ctx.session.isRunning = false
	return true
}
