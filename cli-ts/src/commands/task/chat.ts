/**
 * Task chat command - interactive REPL mode
 */

import { Command } from "commander"
import readline from "readline"
import type { OutputFormatter } from "../../core/output/types.js"
import { createTaskStorage } from "../../core/task-client.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"
import type { TaskMessage, TaskMode } from "../../types/task.js"

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
	if (tasks.length > 0 && tasks[0].status === "active") {
		return tasks[0].id
	}
	return null
}

/**
 * Chat session state
 */
interface ChatSession {
	taskId: string
	isRunning: boolean
	lastMessageTimestamp: number
}

/**
 * Process chat commands (lines starting with /)
 */
function processChatCommand(
	input: string,
	session: ChatSession,
	configDir: string | undefined,
	formatter: OutputFormatter,
): boolean {
	const taskStorage = createTaskStorage(configDir)
	const parts = input.slice(1).split(/\s+/)
	const cmd = parts[0].toLowerCase()
	const args = parts.slice(1)

	switch (cmd) {
		case "help":
		case "h":
		case "?":
			formatter.raw("")
			formatter.info("Chat commands:")
			formatter.raw("  /help, /h, /?      - Show this help")
			formatter.raw("  /mode <plan|act>   - Switch mode")
			formatter.raw("  /status            - Show task status")
			formatter.raw("  /history [n]       - Show last n messages (default: 10)")
			formatter.raw("  /approve, /a, /y   - Approve pending action")
			formatter.raw("  /deny, /d, /n      - Deny pending action")
			formatter.raw("  /quit, /q, /exit   - Exit chat mode")
			formatter.raw("")
			return true

		case "mode":
		case "m":
			if (args.length === 0) {
				const task = taskStorage.get(session.taskId)
				formatter.info(`Current mode: ${task?.mode || "unknown"}`)
			} else {
				const newMode = args[0].toLowerCase()
				if (newMode !== "plan" && newMode !== "act") {
					formatter.error("Invalid mode. Use 'plan' or 'act'")
				} else {
					taskStorage.updateMode(session.taskId, newMode as TaskMode)
					formatter.success(`Switched to ${newMode} mode`)
				}
			}
			return true

		case "status":
		case "s": {
			const task = taskStorage.get(session.taskId)
			if (task) {
				formatter.raw("")
				formatter.info(`Task: ${task.id}`)
				formatter.info(`Status: ${task.status}`)
				formatter.info(`Mode: ${task.mode}`)
				formatter.info(`Messages: ${task.messageCount}`)
				formatter.raw("")
			}
			return true
		}

		case "history": {
			const count = args.length > 0 ? parseInt(args[0], 10) : 10
			if (isNaN(count) || count < 1) {
				formatter.error("Invalid count")
				return true
			}
			const messages = taskStorage.getMessages(session.taskId)
			const recent = messages.slice(-count)
			formatter.raw("")
			if (recent.length === 0) {
				formatter.info("No messages")
			} else {
				for (const msg of recent) {
					formatter.raw(formatMessage(msg))
				}
			}
			formatter.raw("")
			return true
		}

		case "approve":
		case "a":
		case "y": {
			const pending = taskStorage.hasPendingApproval(session.taskId)
			if (!pending) {
				formatter.warn("No pending approval request")
			} else {
				taskStorage.addMessage(session.taskId, "user", "approval_response", "approved", undefined, {
					approved: true,
					requestId: pending.id,
				})
				formatter.success("Action approved")
			}
			return true
		}

		case "deny":
		case "d":
		case "n": {
			const pending = taskStorage.hasPendingApproval(session.taskId)
			if (!pending) {
				formatter.warn("No pending approval request")
			} else {
				taskStorage.addMessage(session.taskId, "user", "approval_response", "denied", undefined, {
					approved: false,
					requestId: pending.id,
				})
				formatter.success("Action denied")
			}
			return true
		}

		case "quit":
		case "q":
		case "exit":
			session.isRunning = false
			return true

		default:
			formatter.warn(`Unknown command: /${cmd}. Type /help for available commands.`)
			return true
	}
}

/**
 * Create the task chat command
 */
export function createTaskChatCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const chatCommand = new Command("chat")
		.alias("c")
		.description("Interactive chat mode with a task")
		.argument("[taskId]", "Task ID to chat with (defaults to most recent active task)")
		.option("-m, --mode <mode>", "Start in specific mode: act or plan")
		.action(async (taskIdArg: string | undefined, options) => {
			logger.debug("Task chat command called", { taskIdArg, options })

			try {
				// Create task storage
				const taskStorage = createTaskStorage(config.configDir)

				// Determine task ID
				let taskId = taskIdArg
				if (!taskId) {
					const recentTaskId = getMostRecentTaskId(config.configDir)
					if (!recentTaskId) {
						throw new Error("No active task found. Create a task with 'cline task new'")
					}
					taskId = recentTaskId
				}

				// Get the task
				const task = taskStorage.get(taskId)
				if (!task) {
					throw new Error(`Task not found: ${taskId}`)
				}

				// Handle mode option
				if (options.mode) {
					if (options.mode !== "plan" && options.mode !== "act") {
						throw new Error(`Invalid mode: "${options.mode}". Valid options are: act, plan`)
					}
					taskStorage.updateMode(task.id, options.mode as TaskMode)
				}

				// Display welcome message
				formatter.raw("")
				formatter.info("═".repeat(60))
				formatter.info("  Cline Interactive Chat Mode")
				formatter.info("═".repeat(60))
				formatter.info(`Task: ${task.id}`)
				formatter.info(`Mode: ${task.mode}`)
				formatter.info(`Prompt: ${task.prompt}`)
				formatter.raw("")
				formatter.info("Type your message and press Enter to send.")
				formatter.info("Type /help for available commands, /quit to exit.")
				formatter.raw("─".repeat(60))
				formatter.raw("")

				// Show recent messages
				const messages = taskStorage.getMessages(task.id)
				if (messages.length > 0) {
					const recentMessages = messages.slice(-5)
					formatter.info("Recent messages:")
					for (const msg of recentMessages) {
						formatter.raw(formatMessage(msg))
					}
					formatter.raw("")
				}

				// Create readline interface
				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
					prompt: "> ",
				})

				// Chat session state
				const session: ChatSession = {
					taskId: task.id,
					isRunning: true,
					lastMessageTimestamp: messages.length > 0 ? messages[messages.length - 1].timestamp : Date.now(),
				}

				// Handle line input
				rl.on("line", (line: string) => {
					const input = line.trim()

					if (!input) {
						rl.prompt()
						return
					}

					// Check for chat commands
					if (input.startsWith("/")) {
						processChatCommand(input, session, config.configDir, formatter)
						if (!session.isRunning) {
							rl.close()
							return
						}
						rl.prompt()
						return
					}

					// Send message
					const savedMessage = taskStorage.addMessage(task.id, "user", "text", input)
					if (savedMessage) {
						formatter.info(`Message sent`)
						session.lastMessageTimestamp = savedMessage.timestamp
					} else {
						formatter.error("Failed to send message")
					}

					rl.prompt()
				})

				// Handle close
				rl.on("close", () => {
					formatter.raw("")
					formatter.info("Chat session ended")
					process.exit(0)
				})

				// Handle Ctrl+C
				rl.on("SIGINT", () => {
					formatter.raw("")
					formatter.info("Chat session ended")
					rl.close()
				})

				// Start prompt
				rl.prompt()
			} catch (error) {
				formatter.error((error as Error).message)
				process.exit(1)
			}
		})

	return chatCommand
}
