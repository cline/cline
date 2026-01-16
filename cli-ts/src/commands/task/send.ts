/**
 * Task send command - send a message to the current task
 */

import { Command } from "commander"
import fs from "fs"
import type { OutputFormatter } from "../../core/output/types.js"
import { createTaskStorage } from "../../core/task-client.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"
import type { TaskMode } from "../../types/task.js"

/**
 * Validate mode option
 */
function validateMode(mode: string | undefined): TaskMode | undefined {
	if (!mode) {
		return undefined
	}
	if (mode !== "act" && mode !== "plan") {
		throw new Error(`Invalid mode: "${mode}". Valid options are: act, plan`)
	}
	return mode
}

/**
 * Read input from stdin if available
 */
async function readStdin(): Promise<string | null> {
	// Check if stdin is a TTY (interactive terminal)
	if (process.stdin.isTTY) {
		return null
	}

	return new Promise((resolve) => {
		let data = ""
		process.stdin.setEncoding("utf-8")

		process.stdin.on("readable", () => {
			let chunk: string | null
			while ((chunk = process.stdin.read() as string | null) !== null) {
				data += chunk
			}
		})

		process.stdin.on("end", () => {
			resolve(data.trim() || null)
		})

		// Timeout after 100ms if no data
		setTimeout(() => {
			if (!data) {
				resolve(null)
			}
		}, 100)
	})
}

/**
 * Get the most recent active task ID
 */
function getMostRecentTaskId(configDir: string | undefined): string | null {
	const taskStorage = createTaskStorage(configDir)
	const tasks = taskStorage.list(1)
	if (tasks.length > 0 && tasks[0].status === "active") {
		return tasks[0].id
	}
	return null
}

/**
 * Create the task send command
 */
export function createTaskSendCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const sendCommand = new Command("send")
		.alias("s")
		.description("Send a message to the current task")
		.argument("[message]", "Message to send (reads from stdin if not provided)")
		.option("-t, --task <id>", "Target task ID (defaults to most recent active task)")
		.option("-a, --approve", "Approve a proposed action", false)
		.option("-d, --deny", "Deny a proposed action", false)
		.option("-f, --file <path>", "Attach file to message")
		.option("-y, --yolo", "Enable autonomous mode (no confirmations)", false)
		.option("--no-interactive", "Same as --yolo")
		.option("-m, --mode <mode>", "Switch to mode: act or plan")
		.action(async (messageArg: string | undefined, options) => {
			logger.debug("Task send command called", { messageArg, options })

			try {
				// Validate mutual exclusivity of approve/deny
				if (options.approve && options.deny) {
					throw new Error("Cannot use both --approve and --deny options")
				}

				// Validate mode if provided
				const mode = validateMode(options.mode)

				// Validate file if provided
				let attachments: string[] | undefined
				if (options.file) {
					if (!fs.existsSync(options.file)) {
						throw new Error(`File not found: ${options.file}`)
					}
					attachments = [options.file]
				}

				// Create task storage
				const taskStorage = createTaskStorage(config.configDir)

				// Determine task ID
				let taskId = options.task
				if (!taskId) {
					taskId = getMostRecentTaskId(config.configDir)
					if (!taskId) {
						throw new Error("No active task found. Create a task with 'cline task new' or specify --task <id>")
					}
				}

				// Get the task
				const task = taskStorage.get(taskId)
				if (!task) {
					throw new Error(`Task not found: ${taskId}`)
				}

				// Handle mode switch
				if (mode) {
					taskStorage.updateMode(task.id, mode)
					formatter.info(`Switched to ${mode} mode`)
				}

				// Determine message content
				let message = messageArg

				// Handle approve/deny as special message types
				if (options.approve) {
					const pendingApproval = taskStorage.hasPendingApproval(task.id)
					if (!pendingApproval) {
						throw new Error("No pending approval request to approve")
					}
					taskStorage.addMessage(task.id, "user", "approval_response", "approved", undefined, {
						approved: true,
						requestId: pendingApproval.id,
					})
					formatter.success("Action approved")
					return
				}

				if (options.deny) {
					const pendingApproval = taskStorage.hasPendingApproval(task.id)
					if (!pendingApproval) {
						throw new Error("No pending approval request to deny")
					}
					taskStorage.addMessage(task.id, "user", "approval_response", "denied", undefined, {
						approved: false,
						requestId: pendingApproval.id,
					})
					formatter.success("Action denied")
					return
				}

				// Try to read from stdin if no message argument
				if (!message) {
					const stdinMessage = await readStdin()
					if (stdinMessage) {
						message = stdinMessage
					}
				}

				if (!message) {
					throw new Error("No message provided. Use argument or pipe via stdin")
				}

				// Add the message
				const savedMessage = taskStorage.addMessage(task.id, "user", "text", message, attachments)
				if (!savedMessage) {
					throw new Error("Failed to save message")
				}

				logger.debug("Message sent", savedMessage)

				// Output success
				formatter.success(`Message sent to task ${task.id.slice(0, 8)}`)

				if (attachments && attachments.length > 0) {
					formatter.info(`Attached: ${attachments.join(", ")}`)
				}

				// JSON output
				if (config.outputFormat === "json") {
					formatter.raw(JSON.stringify(savedMessage, null, 2))
				}
			} catch (error) {
				formatter.error((error as Error).message)
				process.exit(1)
			}
		})

	return sendCommand
}
