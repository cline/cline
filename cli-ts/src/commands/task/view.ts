/**
 * Task view command - view conversation history using embedded Controller
 *
 * This command displays task conversation history from the embedded
 * Controller, with options for real-time streaming and following.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { Command } from "commander"
import { CliWebviewAdapter } from "../../core/cli-webview-adapter.js"
import { disposeEmbeddedController, getEmbeddedController } from "../../core/embedded-controller.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Format a ClineMessage for display
 */
function formatMessageSummary(msg: ClineMessage): string {
	const timestamp = new Date(msg.ts).toLocaleTimeString()
	const type = msg.type.toUpperCase()

	let subtype = ""
	if (msg.say) {
		subtype = ` [${msg.say}]`
	} else if (msg.ask) {
		subtype = ` [${msg.ask}]`
	}

	// Truncate long messages
	let content = msg.text || ""
	if (content.length > 100) {
		content = content.slice(0, 97) + "..."
	}

	// Handle special message types
	if (msg.say === "api_req_started" || msg.say === "api_req_finished") {
		try {
			const info = JSON.parse(msg.text || "{}")
			if (info.tokensIn || info.tokensOut) {
				content = `tokens: ${info.tokensIn || 0} in / ${info.tokensOut || 0} out`
			}
		} catch {
			// Keep original content
		}
	}

	return `[${timestamp}] ${type}${subtype}: ${content.replace(/\n/g, " ")}`
}

/**
 * Check if task is complete or awaiting input
 */
function isTaskComplete(messages: ClineMessage[]): boolean {
	if (messages.length === 0) {
		return false
	}

	const lastMessage = messages[messages.length - 1]

	// Task is complete if last message is completion_result
	if (lastMessage.ask === "completion_result" || lastMessage.say === "completion_result") {
		return true
	}

	return false
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
		.description("View task conversation history using embedded Controller")
		.argument("[taskId]", "Task ID to view (defaults to current or most recent task)")
		.option("-f, --follow", "Stream updates in real-time", false)
		.option("-c, --follow-complete", "Follow until task completion", false)
		.option("-n, --last <count>", "Show only last N messages")
		.option("--since <timestamp>", "Show messages since timestamp (Unix ms)")
		.option("-r, --raw", "Show raw message data (useful for debugging)", false)
		.action(async (taskIdArg: string | undefined, options) => {
			logger.debug("Task view command called", { taskIdArg, options })

			try {
				// Initialize embedded controller
				const controller = await getEmbeddedController(logger, config.configDir)

				// Get task history to find the task
				const state = await controller.getStateToPostToWebview()
				const taskHistory = state.taskHistory || []

				// Determine which task to view
				let taskId = taskIdArg
				let historyItem = null

				if (taskId) {
					// Find task by ID (support partial ID match)
					historyItem = taskHistory.find((t) => t.id === taskId || t.id.startsWith(taskId || ""))
					if (!historyItem) {
						throw new Error(`Task not found: ${taskId}`)
					}
					taskId = historyItem.id
				} else {
					// Use current task or most recent
					if (controller.task) {
						taskId = controller.task.taskId
						historyItem = taskHistory.find((t) => t.id === taskId)
					} else if (taskHistory.length > 0) {
						historyItem = taskHistory[0] // Most recent
						taskId = historyItem.id
					} else {
						throw new Error("No tasks found. Create a task with 'cline task new'")
					}
				}

				// Initialize task if not already active
				if (!controller.task || controller.task.taskId !== taskId) {
					if (historyItem) {
						const taskData = await controller.getTaskWithId(taskId)
						await controller.initTask(undefined, undefined, undefined, taskData.historyItem)
					}
				}

				// Display task info header
				formatter.info(`\nTask: ${taskId}`)
				if (historyItem) {
					formatter.info(`Status: ${historyItem.size ? "has content" : "empty"}`)
					if (historyItem.task) {
						const promptPreview = historyItem.task.slice(0, 60) + (historyItem.task.length > 60 ? "..." : "")
						formatter.info(`Prompt: ${promptPreview}`)
					}
				}
				formatter.raw("─".repeat(60))

				// Get messages
				let messages = controller.task?.messageStateHandler.getClineMessages() || []

				// Filter by timestamp if provided
				if (options.since) {
					const sinceTs = parseInt(options.since, 10)
					if (isNaN(sinceTs)) {
						throw new Error(`Invalid timestamp: ${options.since}`)
					}
					messages = messages.filter((m) => m.ts > sinceTs)
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
					if (options.raw) {
						// Raw JSON output
						for (const msg of messages) {
							formatter.raw(JSON.stringify(msg, null, 2))
							formatter.raw("")
						}
					} else {
						// Formatted output using the adapter
						const adapter = new CliWebviewAdapter(controller, formatter)
						for (const msg of messages) {
							adapter.outputMessage(msg)
						}
					}
				}

				// JSON output for non-follow mode
				if (config.outputFormat === "json" && !options.follow && !options.followComplete) {
					formatter.raw(
						JSON.stringify(
							{
								taskId,
								prompt: historyItem?.task,
								messageCount: messages.length,
								messages: options.raw ? messages : messages.map(formatMessageSummary),
							},
							null,
							2,
						),
					)
					await disposeEmbeddedController(logger)
					return
				}

				// Handle follow mode
				if (options.follow || options.followComplete) {
					formatter.raw("")
					formatter.info("Watching for new messages... (Ctrl+C to stop)")
					formatter.raw("─".repeat(60))

					let isRunning = true
					let lastMessageCount = messages.length

					// Create adapter for streaming output
					const adapter = new CliWebviewAdapter(controller, formatter)

					// Handle Ctrl+C gracefully
					const cleanup = async () => {
						isRunning = false
						formatter.raw("")
						formatter.info("Stopped watching")
						adapter.stopListening()
						await disposeEmbeddedController(logger)
						process.exit(0)
					}

					process.on("SIGINT", cleanup)
					process.on("SIGTERM", cleanup)

					// Poll for new messages
					const pollInterval = 100 // ms

					while (isRunning) {
						await sleep(pollInterval)

						// Get current messages
						const currentMessages = controller.task?.messageStateHandler.getClineMessages() || []

						// Output new messages
						if (currentMessages.length > lastMessageCount) {
							const newMessages = currentMessages.slice(lastMessageCount)
							for (const msg of newMessages) {
								adapter.outputMessage(msg)
							}
							lastMessageCount = currentMessages.length
						}

						// Check if task completed (for --follow-complete)
						if (options.followComplete && isTaskComplete(currentMessages)) {
							formatter.raw("")
							formatter.info("Task completed")
							break
						}

						// Check if task was cleared
						if (!controller.task) {
							formatter.warn("Task was cleared")
							break
						}
					}

					// Remove listeners
					process.removeListener("SIGINT", cleanup)
					process.removeListener("SIGTERM", cleanup)
				}

				await disposeEmbeddedController(logger)
			} catch (error) {
				formatter.error((error as Error).message)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})

	return viewCommand
}
