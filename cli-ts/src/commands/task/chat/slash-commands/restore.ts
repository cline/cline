/**
 * Restore command handler - restore task to a checkpoint
 */

import { validateCheckpoint } from "../../restore.js"
import { handleCheckpoints } from "./checkpoints.js"
import type { CommandContext, CommandHandler } from "./types.js"

/** Valid restore types */
type RestoreType = "task" | "workspace" | "taskAndWorkspace"

const VALID_RESTORE_TYPES: RestoreType[] = ["task", "workspace", "taskAndWorkspace"]

/**
 * Get relative time string (e.g., "2 hours ago")
 */
function getTimeAgo(timestamp: number): string {
	const now = Date.now()
	const diff = now - timestamp
	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)

	if (days > 0) {
		return days === 1 ? "1 day ago" : `${days} days ago`
	}
	if (hours > 0) {
		return hours === 1 ? "1 hour ago" : `${hours} hours ago`
	}
	if (minutes > 0) {
		return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`
	}
	return "just now"
}

/**
 * Handle /restore command - restore task to a checkpoint
 *
 * Usage:
 *   /restore <checkpoint-id> [type]
 *   /restore list  - List available checkpoints (alias for /checkpoints)
 *
 * Types:
 *   task            - Restore conversation only (default)
 *   workspace       - Restore files only
 *   taskAndWorkspace - Restore both
 */
export const handleRestore: CommandHandler = async (args: string[], ctx: CommandContext): Promise<boolean> => {
	// Handle "list" subcommand
	if (args[0] === "list" || args[0] === "ls") {
		return handleCheckpoints(args.slice(1), ctx)
	}

	// Check for active task
	if (!ctx.controller.task) {
		ctx.fmt.warn("No active task")
		return true
	}

	// Validate arguments
	if (args.length === 0) {
		ctx.fmt.warn("Usage: /restore <checkpoint-id> [type]")
		ctx.fmt.info("  checkpoint-id: The timestamp ID of the checkpoint")
		ctx.fmt.info("  type: task (default), workspace, or taskAndWorkspace")
		ctx.fmt.info("")
		ctx.fmt.info('Use "/checkpoints" or "/restore list" to see available checkpoints')
		return true
	}

	// Parse checkpoint ID
	const checkpointIdArg = args[0]
	const checkpointId = parseInt(checkpointIdArg, 10)
	if (isNaN(checkpointId)) {
		ctx.fmt.error(`Invalid checkpoint ID: "${checkpointIdArg}". Must be a number (timestamp).`)
		return true
	}

	// Parse restore type (default: task)
	let restoreType: RestoreType = "task"
	if (args[1]) {
		const providedType = args[1].toLowerCase()
		if (!VALID_RESTORE_TYPES.includes(providedType as RestoreType)) {
			ctx.fmt.error(`Invalid restore type: "${args[1]}". Valid options: ${VALID_RESTORE_TYPES.join(", ")}`)
			return true
		}
		restoreType = providedType as RestoreType
	}

	// Get messages and validate checkpoint exists
	const messages = ctx.controller.task.messageStateHandler.getClineMessages()
	const checkpoint = validateCheckpoint(messages, checkpointId)

	if (!checkpoint) {
		// Check if the timestamp exists but is not a checkpoint
		const anyMessage = messages.find((m) => m.ts === checkpointId)
		if (anyMessage) {
			ctx.fmt.error(`Timestamp ${checkpointId} exists but is not a checkpoint (type: ${anyMessage.say || anyMessage.ask})`)
		} else {
			ctx.fmt.error(`Checkpoint ${checkpointId} not found in task history`)
		}
		ctx.fmt.info('Use "/checkpoints" to see available checkpoints')
		return true
	}

	// Check if workspace restore is possible
	if ((restoreType === "workspace" || restoreType === "taskAndWorkspace") && !checkpoint.lastCheckpointHash) {
		ctx.fmt.warn("Warning: This checkpoint does not have workspace restore data.")
		if (restoreType === "workspace") {
			ctx.fmt.error("Cannot restore workspace: no checkpoint hash available")
			return true
		}
		ctx.fmt.info("Falling back to task-only restore.")
		restoreType = "task"
	}

	// Perform the restore
	ctx.fmt.info(`Restoring to checkpoint ${checkpointId} (${getTimeAgo(checkpointId)})...`)
	ctx.fmt.info(`Restore type: ${restoreType}`)

	try {
		// Cancel any active task first (required before restore)
		await ctx.controller.cancelTask()

		// Call restoreCheckpoint on the checkpoint manager
		const checkpointManager = ctx.controller.task?.checkpointManager
		if (!checkpointManager) {
			ctx.fmt.error("Checkpoint manager not available")
			return true
		}

		await checkpointManager.restoreCheckpoint(checkpointId, restoreType)

		ctx.fmt.success("Checkpoint restored successfully")

		// Show post-restore state
		const newMessages = ctx.controller.task?.messageStateHandler.getClineMessages() || []
		ctx.fmt.info(`Task now has ${newMessages.length} messages`)
	} catch (error) {
		ctx.fmt.error(`Failed to restore checkpoint: ${(error as Error).message}`)
	}

	return true
}
