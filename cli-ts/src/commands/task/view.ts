/**
 * Task view command - view conversation history
 */

import { Command } from "commander"
import type { OutputFormatter } from "../../core/output/types.js"
import { createTaskStorage } from "../../core/task-client.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"
import type { TaskMessage } from "../../types/task.js"

/**
 * Format a message for display
 */
function formatMessage(msg: TaskMessage): string {
	const timestamp = new Date(msg.timestamp).toLocaleTimeString()
	const role = msg.role.toUpperCase().padEnd(9)
	const type = msg.type !== "text" ? ` [${msg.type}]` : ""

	let content = msg.content
	if (msg.attachments && msg.attachments.length > 0) {
		content += `\n  📎 ${msg.attachments.join(", ")}`
	}

	return `[${timestamp}] ${role}${type}: ${content}`
}

/**
 * Get the most recent active task ID
 */
function getMostRecentTaskId(configDir: string | undefined): string | null {
	const taskStorage = createTaskStorage(configDir)
	const tasks = taskStorage.list(1)
	if (tasks.length > 0) {
		return tasks[0].id
	}
	return null
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Create the task view command
 */
export function createTaskViewCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const viewCommand = new Command("view")
		.alias("v")
		.description("View task conversation history")
		.argument("[taskId]", "Task ID to view (defaults to most recent task)")
		.option("-f, --follow", "Stream updates in real-time", false)
		.option("-c, --follow-complete", "Follow until task completion", false)
		.option("-n, --last <count>", "Show only last N messages")
		.option("--since <timestamp>", "Show messages since timestamp (Unix ms)")
		.action(async (taskIdArg: string | undefined, options) => {
			logger.debug("Task view command called", { taskIdArg, options })

			try {
				// Create task storage
				const taskStorage = createTaskStorage(config.configDir)

				// Determine task ID
				let taskId = taskIdArg
				if (!taskId) {
					const recentTaskId = getMostRecentTaskId(config.configDir)
					if (!recentTaskId) {
						throw new Error("No tasks found. Create a task with 'cline task new'")
					}
					taskId = recentTaskId
				}

				// Get the task
				const task = taskStorage.get(taskId)
				if (!task) {
					throw new Error(`Task not found: ${taskId}`)
				}

				// Display task info header
				formatter.info(`Task: ${task.id}`)
				formatter.info(`Status: ${task.status} | Mode: ${task.mode}`)
				formatter.info(`Prompt: ${task.prompt}`)
				formatter.raw("─".repeat(60))

				// Get messages
				let messages = taskStorage.getMessages(task.id)

				// Filter by timestamp if provided
				if (options.since) {
					const sinceTs = parseInt(options.since, 10)
					if (isNaN(sinceTs)) {
						throw new Error(`Invalid timestamp: ${options.since}`)
					}
					messages = messages.filter((m) => m.timestamp > sinceTs)
				}

				// Limit to last N messages if specified
				if (options.last) {
					const count = parseInt(options.last, 10)
					if (isNaN(count) || count < 1) {
						throw new Error(`Invalid count: ${options.last}`)
					}
					messages = messages.slice(-count)
				}

				// Display messages
				if (messages.length === 0) {
					formatter.info("No messages yet")
				} else {
					for (const msg of messages) {
						formatter.raw(formatMessage(msg))
					}
				}

				// JSON output for non-follow mode
				if (config.outputFormat === "json" && !options.follow && !options.followComplete) {
					formatter.raw(
						JSON.stringify(
							{
								task: {
									id: task.id,
									status: task.status,
									mode: task.mode,
									prompt: task.prompt,
								},
								messages,
							},
							null,
							2,
						),
					)
					return
				}

				// Handle follow mode
				if (options.follow || options.followComplete) {
					formatter.raw("")
					formatter.info("Watching for new messages... (Ctrl+C to stop)")
					formatter.raw("─".repeat(60))

					let lastTimestamp = messages.length > 0 ? messages[messages.length - 1].timestamp : Date.now()
					let isRunning = true

					// Handle Ctrl+C gracefully
					const cleanup = () => {
						isRunning = false
						formatter.raw("")
						formatter.info("Stopped watching")
						process.exit(0)
					}

					process.on("SIGINT", cleanup)
					process.on("SIGTERM", cleanup)

					// Poll for new messages
					const pollInterval = 500 // ms

					while (isRunning) {
						await sleep(pollInterval)

						// Check task status
						const updatedTask = taskStorage.get(task.id)
						if (!updatedTask) {
							formatter.warn("Task was deleted")
							break
						}

						// Check if task completed (for --follow-complete)
						if (options.followComplete && updatedTask.status === "completed") {
							formatter.info("Task completed")
							break
						}

						// Get new messages
						const newMessages = taskStorage.getMessagesSince(task.id, lastTimestamp)
						if (newMessages.length > 0) {
							for (const msg of newMessages) {
								formatter.raw(formatMessage(msg))
							}
							lastTimestamp = newMessages[newMessages.length - 1].timestamp
						}
					}

					// Remove listeners
					process.removeListener("SIGINT", cleanup)
					process.removeListener("SIGTERM", cleanup)
				}
			} catch (error) {
				formatter.error((error as Error).message)
				process.exit(1)
			}
		})

	return viewCommand
}
