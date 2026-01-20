/**
 * Checkpoints command handler - list available checkpoints
 */

import { formatCheckpointList } from "../../restore.js"
import type { CommandContext, CommandHandler } from "./types.js"

/**
 * Handle /checkpoints command - list available checkpoints in current task
 */
export const handleCheckpoints: CommandHandler = async (_args: string[], ctx: CommandContext): Promise<boolean> => {
	if (!ctx.controller.task) {
		ctx.fmt.warn("No active task")
		return true
	}

	const messages = ctx.controller.task.messageStateHandler.getClineMessages()
	const checkpoints = formatCheckpointList(messages)

	if (checkpoints.length === 0) {
		ctx.fmt.info("No checkpoints found in current task")
		return true
	}

	ctx.fmt.info(`Checkpoints (${checkpoints.length}):\n`)

	const idWidth = 16
	const timeWidth = 16
	const wsWidth = 12

	const header = "ID".padEnd(idWidth) + "Time".padEnd(timeWidth) + "Workspace".padEnd(wsWidth) + "Context"
	ctx.fmt.raw(header)
	ctx.fmt.raw("-".repeat(header.length + 30))

	for (const cp of checkpoints) {
		const row =
			String(cp.id).padEnd(idWidth) +
			cp.timeAgo.padEnd(timeWidth) +
			(cp.hasWorkspaceRestore ? "Yes" : "No").padEnd(wsWidth) +
			cp.context
		ctx.fmt.raw(row)
	}

	ctx.fmt.raw("")
	ctx.fmt.info('Use "/restore <checkpoint-id>" to restore')

	return true
}
