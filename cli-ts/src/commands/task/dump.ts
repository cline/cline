/**
 * Task dump command - output raw JSON of conversation messages
 *
 * This command outputs the raw JSON of a task's ClineMessages array,
 * useful for debugging or external processing.
 */

import { getSavedClineMessages, readTaskHistoryFromState } from "@core/storage/disk"
import { Command } from "commander"
import { initializeHostProviderOnly } from "../../core/embedded-controller.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Create the task dump command
 */
export function createTaskDumpCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const dumpCommand = new Command("dump")
		.alias("d")
		.description("Output raw JSON of task conversation messages")
		.argument("[taskId]", "Task ID to dump (defaults to current or most recent task)")
		.action(async (taskIdArg: string | undefined) => {
			logger.debug("Task dump command called", { taskIdArg })

			try {
				// Initialize HostProvider only (lightweight, no full controller)
				initializeHostProviderOnly(logger, config.configDir)

				// Read task history directly from disk
				const taskHistory = await readTaskHistoryFromState()

				// Determine which task to dump
				let taskId = taskIdArg

				if (taskId) {
					// Find task by ID (support partial ID match)
					const historyItem = taskHistory.find((t) => t.id === taskId || t.id.startsWith(taskId || ""))
					if (!historyItem) {
						throw new Error(`Task not found: ${taskId}`)
					}
					taskId = historyItem.id
				} else {
					// Use most recent task
					if (taskHistory.length > 0) {
						taskId = taskHistory[0].id
					} else {
						throw new Error("No tasks found. Create a task with 'cline task new'")
					}
				}

				// Read messages directly from disk storage
				const messages = await getSavedClineMessages(taskId)
				formatter.raw(JSON.stringify(messages, null, 2))
			} catch (error) {
				formatter.error((error as Error).message)
				process.exit(1)
			}
		})

	return dumpCommand
}
