/**
 * Task send command - send a message to the current task using embedded Controller
 *
 * This command sends a single message to an active task using Cline's
 * embedded Controller, allowing non-interactive AI interactions.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { Command } from "commander"
import fs from "fs"
import { createCliWebviewAdapter } from "../../core/cli-webview-adapter.js"
import { disposeEmbeddedController, getEmbeddedController } from "../../core/embedded-controller.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Validate mode option
 */
function validateMode(mode: string | undefined): "act" | "plan" | undefined {
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
 * Check if the last message requires user input
 */
function isAwaitingResponse(messages: ClineMessage[]): boolean {
	if (messages.length === 0) {
		return false
	}

	const lastMessage = messages[messages.length - 1]

	// Skip partial messages
	if (lastMessage.partial) {
		return false
	}

	// Check if this is an "ask" type message
	return lastMessage.type === "ask"
}

/**
 * Wait for task to reach a stopping point (either completion or awaiting input)
 */
async function waitForTaskResponse(
	controller: Awaited<ReturnType<typeof getEmbeddedController>>,
	formatter: OutputFormatter,
	timeoutMs = 300000, // 5 minutes default timeout
): Promise<void> {
	const adapter = createCliWebviewAdapter(controller, formatter)
	adapter.startListening()

	return new Promise((resolve, reject) => {
		const startTime = Date.now()

		const checkInterval = setInterval(() => {
			const messages = adapter.getMessages()

			// Check if task completed or awaiting response
			if (isAwaitingResponse(messages)) {
				clearInterval(checkInterval)
				adapter.stopListening()
				resolve()
				return
			}

			// Check for task completion (no task or task finished)
			if (!controller.task) {
				clearInterval(checkInterval)
				adapter.stopListening()
				resolve()
				return
			}

			// Check timeout
			if (Date.now() - startTime > timeoutMs) {
				clearInterval(checkInterval)
				adapter.stopListening()
				reject(new Error("Task timed out waiting for response"))
			}
		}, 100)
	})
}

/**
 * Create the task send command
 */
export function createTaskSendCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const sendCommand = new Command("send")
		.alias("s")
		.description("Send a message to the current task using embedded Controller")
		.argument("[message]", "Message to send (reads from stdin if not provided)")
		.option("-t, --task <id>", "Target task ID (starts new task if not specified)")
		.option("-a, --approve", "Approve a proposed action", false)
		.option("-d, --deny", "Deny a proposed action", false)
		.option("-f, --file <path>", "Attach file to message")
		.option("-y, --yolo", "Enable autonomous mode (no confirmations)", false)
		.option("--no-interactive", "Same as --yolo")
		.option("-m, --mode <mode>", "Switch to mode: act or plan")
		.option("-w, --wait", "Wait for task to complete or await input", false)
		.option("--timeout <ms>", "Timeout in milliseconds when using --wait (default: 300000)")
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
				let _attachments: string[] | undefined
				if (options.file) {
					if (!fs.existsSync(options.file)) {
						throw new Error(`File not found: ${options.file}`)
					}
					_attachments = [options.file]
				}

				// Initialize embedded controller
				formatter.info("Initializing Cline...")
				const controller = await getEmbeddedController(logger, config.configDir)

				// Handle mode switch
				if (mode) {
					await controller.togglePlanActMode(mode)
					formatter.info(`Switched to ${mode} mode`)
				}

				// Handle approve/deny for existing task
				if (options.approve || options.deny) {
					if (!controller.task) {
						throw new Error("No active task to approve/deny")
					}

					const response = options.approve ? "yesButtonClicked" : "noButtonClicked"
					await controller.task.handleWebviewAskResponse(response)
					formatter.success(options.approve ? "Action approved" : "Action denied")

					if (options.wait) {
						await waitForTaskResponse(controller, formatter, parseInt(options.timeout) || 300000)
					}

					// Output result in JSON format if requested
					if (config.outputFormat === "json") {
						const state = await controller.getStateToPostToWebview()
						formatter.raw(
							JSON.stringify(
								{
									taskId: controller.task?.taskId,
									action: options.approve ? "approved" : "denied",
									messageCount: state.clineMessages?.length || 0,
								},
								null,
								2,
							),
						)
					}

					await disposeEmbeddedController(logger)
					return
				}

				// Determine message content
				let message = messageArg

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

				// Start or continue task
				let taskId: string | undefined

				if (options.task) {
					// Resume existing task
					const history = await controller.getTaskWithId(options.task)
					if (!history) {
						throw new Error(`Task not found: ${options.task}`)
					}
					taskId = await controller.initTask(undefined, undefined, undefined, history.historyItem)
					formatter.info(`Resumed task: ${taskId}`)

					// Send the message
					if (controller.task) {
						await controller.task.handleWebviewAskResponse("messageResponse", message)
					}
				} else if (controller.task) {
					// Send to existing active task
					taskId = controller.task.taskId
					await controller.task.handleWebviewAskResponse("messageResponse", message)
					formatter.info(`Message sent to task ${taskId.slice(0, 8)}`)
				} else {
					// Start new task with the message as prompt
					taskId = await controller.initTask(message)
					formatter.info(`Started new task: ${taskId}`)
				}

				// Wait for response if requested
				if (options.wait) {
					formatter.info("Waiting for task response...")
					await waitForTaskResponse(controller, formatter, parseInt(options.timeout) || 300000)
				}

				// Output result in JSON format if requested
				if (config.outputFormat === "json") {
					const state = await controller.getStateToPostToWebview()
					formatter.raw(
						JSON.stringify(
							{
								taskId,
								message,
								messageCount: state.clineMessages?.length || 0,
								mode: state.mode,
							},
							null,
							2,
						),
					)
				}

				await disposeEmbeddedController(logger)
			} catch (error) {
				formatter.error((error as Error).message)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})

	return sendCommand
}
