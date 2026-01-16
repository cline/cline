/**
 * Task list command - list task history
 *
 * This command uses Cline's EmbeddedController to read task history directly,
 * ensuring CLI task list matches what the extension shows.
 */

import { Command } from "commander"
import { disposeEmbeddedController, getEmbeddedController } from "../../core/embedded-controller.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

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
	const weeks = Math.floor(days / 7)
	const months = Math.floor(days / 30)

	if (months > 0) {
		return months === 1 ? "1 month ago" : `${months} months ago`
	}
	if (weeks > 0) {
		return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`
	}
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
 * Format cost as a currency string
 */
function formatCost(cost: number): string {
	if (cost === 0) {
		return "$0.00"
	}
	if (cost < 0.01) {
		return `$${cost.toFixed(4)}`
	}
	return `$${cost.toFixed(2)}`
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
		.action(async (options) => {
			logger.debug("Task list command called", { options })

			try {
				// Initialize embedded controller to access task history
				formatter.info("Initializing Cline...")
				const controller = await getEmbeddedController(logger, config.configDir)

				// Get task history from the state
				const state = await controller.getStateToPostToWebview()
				let tasks = state.taskHistory || []

				// Parse limit
				const limit = options.all ? undefined : parseInt(options.limit, 10)
				if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
					formatter.error("Invalid limit value")
					await disposeEmbeddedController(logger)
					process.exit(1)
				}

				// Apply limit if specified
				if (limit !== undefined) {
					tasks = tasks.slice(0, limit)
				}

				logger.debug(`Found ${tasks.length} tasks`)

				// Handle empty list
				if (tasks.length === 0) {
					formatter.info("No tasks found")
					if (config.outputFormat === "json") {
						formatter.raw("[]")
					}
					await disposeEmbeddedController(logger)
					process.exit(0)
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
					const timeWidth = 16
					const costWidth = 10
					const modelWidth = 20

					// Header
					const header =
						"ID".padEnd(idWidth) +
						"Time".padEnd(timeWidth) +
						"Cost".padEnd(costWidth) +
						"Model".padEnd(modelWidth) +
						"Prompt"
					formatter.raw(header)
					formatter.raw("-".repeat(header.length + 20))

					// Rows
					for (const task of tasks) {
						const row =
							task.id.slice(0, 8).padEnd(idWidth) +
							getTimeAgo(task.ts).padEnd(timeWidth) +
							formatCost(task.totalCost).padEnd(costWidth) +
							truncate(task.modelId || "unknown", modelWidth - 2).padEnd(modelWidth) +
							truncate(task.task.replace(/\n/g, " "), 50)
						formatter.raw(row)
					}

					formatter.raw("")
					formatter.info('Use "cline task open <id>" to resume a task')
				}

				// Cleanup and exit
				await disposeEmbeddedController(logger)
				process.exit(0)
			} catch (error) {
				formatter.error((error as Error).message)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})

	return listCommand
}
