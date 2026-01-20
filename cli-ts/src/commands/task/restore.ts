/**
 * Task restore command - restore a task to a specific checkpoint
 *
 * This command restores a task to a previous checkpoint, optionally
 * restoring both the conversation state and workspace files.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { Command } from "commander"
import { disposeEmbeddedController, getEmbeddedController } from "../../core/embedded-controller.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

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
 * Truncate a string to a maximum length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) {
		return str
	}
	return str.slice(0, maxLength - 3) + "..."
}

/**
 * Find checkpoints in a list of messages
 */
export function findCheckpoints(messages: ClineMessage[]): ClineMessage[] {
	return messages.filter((m) => m.say === "checkpoint_created")
}

/**
 * Validate that a checkpoint ID exists in the messages
 */
export function validateCheckpoint(messages: ClineMessage[], checkpointId: number): ClineMessage | null {
	return messages.find((m) => m.ts === checkpointId && m.say === "checkpoint_created") || null
}

/**
 * Get context for a checkpoint (the preceding user message)
 */
function getCheckpointContext(messages: ClineMessage[], checkpointIndex: number): string {
	// Look backwards for the most recent user message
	for (let i = checkpointIndex - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.type === "say" && msg.say === "text" && msg.text) {
			return truncate(msg.text.replace(/\n/g, " "), 50)
		}
		if (msg.type === "ask" && msg.text) {
			return truncate(msg.text.replace(/\n/g, " "), 50)
		}
	}
	return "(no context)"
}

/**
 * Format checkpoints for display
 */
export function formatCheckpointList(messages: ClineMessage[]): Array<{
	id: number
	timeAgo: string
	context: string
	hasWorkspaceRestore: boolean
}> {
	const checkpoints = findCheckpoints(messages)
	return checkpoints.map((cp) => {
		const index = messages.indexOf(cp)
		return {
			id: cp.ts,
			timeAgo: getTimeAgo(cp.ts),
			context: getCheckpointContext(messages, index),
			hasWorkspaceRestore: !!cp.lastCheckpointHash,
		}
	})
}

/**
 * Create the task restore command
 */
export function createTaskRestoreCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const restoreCommand = new Command("restore")
		.alias("r")
		.description("Restore task to a specific checkpoint")
		.argument("<checkpoint-id>", "Checkpoint ID (timestamp) to restore to")
		.option(
			"-t, --type <type>",
			"Restore type: task (conversation only), workspace (files only), taskAndWorkspace (both)",
			"task",
		)
		.option("-l, --list", "List available checkpoints instead of restoring", false)
		.action(async (checkpointIdArg: string, options) => {
			logger.debug("Task restore command called", { checkpointIdArg, options })

			try {
				// Initialize embedded controller
				formatter.info("Initializing Cline...")
				const controller = await getEmbeddedController(logger, config.configDir)

				// Check if there's an active task
				if (!controller.task) {
					// Try to get the most recent task
					const state = await controller.getStateToPostToWebview()
					const taskHistory = state.taskHistory || []

					if (taskHistory.length === 0) {
						throw new Error("No tasks found. Create a task first.")
					}

					// Initialize the most recent task
					const historyItem = taskHistory[0]
					const taskData = await controller.getTaskWithId(historyItem.id)
					await controller.initTask(undefined, undefined, undefined, taskData.historyItem)
				}

				// Get messages from the task
				const messages = controller.task?.messageStateHandler.getClineMessages() || []

				if (messages.length === 0) {
					throw new Error("No messages in current task")
				}

				// Handle --list option
				if (options.list) {
					const checkpoints = formatCheckpointList(messages)

					if (checkpoints.length === 0) {
						formatter.info("No checkpoints found in current task")
						await disposeEmbeddedController(logger)
						return
					}

					if (config.outputFormat === "json") {
						formatter.raw(JSON.stringify(checkpoints, null, 2))
					} else {
						formatter.info(`Checkpoints (${checkpoints.length}):\n`)

						const idWidth = 16
						const timeWidth = 16
						const wsWidth = 12

						const header = "ID".padEnd(idWidth) + "Time".padEnd(timeWidth) + "Workspace".padEnd(wsWidth) + "Context"
						formatter.raw(header)
						formatter.raw("-".repeat(header.length + 30))

						for (const cp of checkpoints) {
							const row =
								String(cp.id).padEnd(idWidth) +
								cp.timeAgo.padEnd(timeWidth) +
								(cp.hasWorkspaceRestore ? "Yes" : "No").padEnd(wsWidth) +
								cp.context
							formatter.raw(row)
						}

						formatter.raw("")
						formatter.info('Use "cline task restore <checkpoint-id>" to restore')
					}

					await disposeEmbeddedController(logger)
					return
				}

				// Parse and validate checkpoint ID
				const checkpointId = parseInt(checkpointIdArg, 10)
				if (isNaN(checkpointId)) {
					throw new Error(`Invalid checkpoint ID: "${checkpointIdArg}". Must be a number (timestamp).`)
				}

				// Validate restore type
				const restoreType = options.type as RestoreType
				if (!VALID_RESTORE_TYPES.includes(restoreType)) {
					throw new Error(`Invalid restore type: "${restoreType}". Valid options: ${VALID_RESTORE_TYPES.join(", ")}`)
				}

				// Validate checkpoint exists
				const checkpoint = validateCheckpoint(messages, checkpointId)
				if (!checkpoint) {
					// Check if the timestamp exists but is not a checkpoint
					const anyMessage = messages.find((m) => m.ts === checkpointId)
					if (anyMessage) {
						throw new Error(
							`Timestamp ${checkpointId} exists but is not a checkpoint (type: ${anyMessage.say || anyMessage.ask})`,
						)
					}
					throw new Error(`Checkpoint ${checkpointId} not found in task history`)
				}

				// Check if workspace restore is possible
				if ((restoreType === "workspace" || restoreType === "taskAndWorkspace") && !checkpoint.lastCheckpointHash) {
					formatter.warn("Warning: This checkpoint does not have workspace restore data.")
					if (restoreType === "workspace") {
						throw new Error("Cannot restore workspace: no checkpoint hash available")
					}
					formatter.info("Falling back to task-only restore.")
				}

				// Perform the restore
				formatter.info(`Restoring to checkpoint ${checkpointId} (${getTimeAgo(checkpointId)})...`)
				formatter.info(`Restore type: ${restoreType}`)

				// Cancel any active task first (required before restore)
				await controller.cancelTask()

				// Call restoreCheckpoint on the checkpoint manager
				const checkpointManager = controller.task?.checkpointManager
				if (!checkpointManager) {
					throw new Error("Checkpoint manager not available")
				}

				await checkpointManager.restoreCheckpoint(checkpointId, restoreType)

				formatter.success("Checkpoint restored successfully")

				// Show post-restore state
				const newMessages = controller.task?.messageStateHandler.getClineMessages() || []
				formatter.info(`Task now has ${newMessages.length} messages`)

				await disposeEmbeddedController(logger)
			} catch (error) {
				formatter.error((error as Error).message)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})

	return restoreCommand
}
