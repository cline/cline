/**
 * Task list command - list task history
 */

import { Command } from "commander"
import type { OutputFormatter } from "../../core/output/types.js"
import { createTaskStorage } from "../../core/task-client.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Format status with visual indicator
 */
function formatStatus(status: string): string {
	switch (status) {
		case "active":
			return "● active"
		case "paused":
			return "◐ paused"
		case "completed":
			return "✓ completed"
		default:
			return status
	}
}

/**
 * Create the task list command
 */
export function createTaskListCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const listCommand = new Command("list")
		.alias("l")
		.alias("ls")
		.description("List task history")
		.option("-n, --limit <number>", "Maximum number of tasks to show", "20")
		.option("-a, --all", "Show all tasks (no limit)", false)
		.option("--status <status>", "Filter by status (active, paused, completed)")
		.action(async (options) => {
			logger.debug("Task list command called", { options })

			try {
				// Create task storage
				const taskStorage = createTaskStorage(config.configDir)

				// Parse limit
				const limit = options.all ? undefined : parseInt(options.limit, 10)
				if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
					formatter.error("Invalid limit value")
					process.exit(1)
				}

				// Get tasks
				let tasks = taskStorage.listForDisplay(limit)

				// Filter by status if specified
				if (options.status) {
					const validStatuses = ["active", "paused", "completed"]
					if (!validStatuses.includes(options.status)) {
						formatter.error(`Invalid status: "${options.status}". Valid options are: ${validStatuses.join(", ")}`)
						process.exit(1)
					}
					tasks = tasks.filter((t) => t.status === options.status)
				}

				logger.debug(`Found ${tasks.length} tasks`)

				// Handle empty list
				if (tasks.length === 0) {
					formatter.info("No tasks found")
					if (config.outputFormat === "json") {
						formatter.raw("[]")
					}
					return
				}

				// Output based on format
				if (config.outputFormat === "json") {
					// JSON output: full task info
					formatter.raw(JSON.stringify(tasks, null, 2))
				} else {
					// Rich/plain output: formatted table
					formatter.info(`Task History (${tasks.length} task${tasks.length === 1 ? "" : "s"}):\n`)

					// Calculate column widths for alignment
					const idWidth = 10
					const statusWidth = 14
					const modeWidth = 6
					const timeWidth = 16

					// Header
					const header =
						"ID".padEnd(idWidth) +
						"Status".padEnd(statusWidth) +
						"Mode".padEnd(modeWidth) +
						"Time".padEnd(timeWidth) +
						"Prompt"
					formatter.raw(header)
					formatter.raw("-".repeat(header.length + 20))

					// Rows
					for (const task of tasks) {
						const row =
							task.id.padEnd(idWidth) +
							formatStatus(task.status).padEnd(statusWidth) +
							task.mode.padEnd(modeWidth) +
							task.timeAgo.padEnd(timeWidth) +
							task.promptSnippet
						formatter.raw(row)
					}

					formatter.raw("")
					formatter.info('Use "cline task open <id>" to resume a task')
				}
			} catch (error) {
				formatter.error((error as Error).message)
				process.exit(1)
			}
		})

	return listCommand
}
