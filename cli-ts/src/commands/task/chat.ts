/**
 * Task chat command - interactive REPL mode with embedded Controller
 *
 * This command provides an interactive chat interface using Cline's
 * embedded Controller, allowing real-time AI interactions directly
 * from the terminal.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { Command } from "commander"
import readline from "readline"
import { CliWebviewAdapter, createCliWebviewAdapter } from "../../core/cli-webview-adapter.js"
import { disposeEmbeddedController, getEmbeddedController } from "../../core/embedded-controller.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Chat session state
 */
interface ChatSession {
	taskId: string | null
	isRunning: boolean
	awaitingApproval: boolean
	awaitingInput: boolean
	adapter: CliWebviewAdapter | null
}

/**
 * Check if the last message requires user input
 */
function checkForPendingInput(messages: ClineMessage[]): { awaitingApproval: boolean; awaitingInput: boolean } {
	if (messages.length === 0) {
		return { awaitingApproval: false, awaitingInput: false }
	}

	const lastMessage = messages[messages.length - 1]

	// Skip partial messages
	if (lastMessage.partial) {
		return { awaitingApproval: false, awaitingInput: false }
	}

	// Check if this is an "ask" type message
	if (lastMessage.type === "ask") {
		const ask = lastMessage.ask

		// These require approval (yes/no response)
		const approvalAsks = ["command", "tool", "browser_action_launch", "use_mcp_server"]

		// These require free-form input
		const inputAsks = ["followup", "plan_mode_respond", "act_mode_respond"]

		if (approvalAsks.includes(ask || "")) {
			return { awaitingApproval: true, awaitingInput: false }
		}

		if (inputAsks.includes(ask || "")) {
			return { awaitingApproval: false, awaitingInput: true }
		}

		// Special cases
		if (ask === "api_req_failed") {
			return { awaitingApproval: true, awaitingInput: false }
		}

		if (ask === "completion_result" || ask === "resume_task" || ask === "resume_completed_task") {
			return { awaitingApproval: false, awaitingInput: true }
		}
	}

	return { awaitingApproval: false, awaitingInput: false }
}

/**
 * Process chat commands (lines starting with /)
 */
async function processChatCommand(
	input: string,
	session: ChatSession,
	formatter: OutputFormatter,
	logger: Logger,
): Promise<boolean> {
	const parts = input.slice(1).split(/\s+/)
	const cmd = parts[0].toLowerCase()
	const args = parts.slice(1)

	const controller = await getEmbeddedController(logger)

	switch (cmd) {
		case "help":
		case "h":
		case "?":
			formatter.raw("")
			formatter.info("Chat commands:")
			formatter.raw("  /help, /h, /?      - Show this help")
			formatter.raw("  /mode <plan|act>   - Switch mode")
			formatter.raw("  /status            - Show task status")
			formatter.raw("  /cancel            - Cancel current task")
			formatter.raw("  /approve, /a, /y   - Approve pending action")
			formatter.raw("  /deny, /d, /n      - Deny pending action")
			formatter.raw("  /quit, /q, /exit   - Exit chat mode")
			formatter.raw("")
			return true

		case "mode":
		case "m":
			if (args.length === 0) {
				const state = await controller.getStateToPostToWebview()
				formatter.info(`Current mode: ${state.mode || "unknown"}`)
			} else {
				const newMode = args[0].toLowerCase()
				if (newMode !== "plan" && newMode !== "act") {
					formatter.error("Invalid mode. Use 'plan' or 'act'")
				} else {
					await controller.togglePlanActMode(newMode as "plan" | "act")
					formatter.success(`Switched to ${newMode} mode`)
				}
			}
			return true

		case "status":
		case "s": {
			const state = await controller.getStateToPostToWebview()
			formatter.raw("")
			formatter.info(`Task ID: ${session.taskId || "none"}`)
			formatter.info(`Mode: ${state.mode || "unknown"}`)
			formatter.info(`Messages: ${state.clineMessages?.length || 0}`)
			if (session.awaitingApproval) {
				formatter.warn("Awaiting approval (use /approve or /deny)")
			}
			if (session.awaitingInput) {
				formatter.warn("Awaiting user input")
			}
			formatter.raw("")
			return true
		}

		case "cancel": {
			if (controller.task) {
				await controller.cancelTask()
				formatter.success("Task cancelled")
			} else {
				formatter.warn("No active task to cancel")
			}
			return true
		}

		case "approve":
		case "a":
		case "y": {
			if (!session.awaitingApproval) {
				formatter.warn("No pending approval request")
			} else if (controller.task) {
				await controller.task.handleWebviewAskResponse("yesButtonClicked")
				session.awaitingApproval = false
				formatter.success("Action approved")
			}
			return true
		}

		case "deny":
		case "d":
		case "n": {
			if (!session.awaitingApproval) {
				formatter.warn("No pending approval request")
			} else if (controller.task) {
				await controller.task.handleWebviewAskResponse("noButtonClicked")
				session.awaitingApproval = false
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
		.description("Interactive chat mode with embedded Cline Controller")
		.argument("[prompt]", "Initial prompt to start a new task (optional)")
		.option("-m, --mode <mode>", "Start in specific mode: act or plan")
		.option("-t, --task <id>", "Resume an existing task by ID")
		.option("-y, --yolo", "Enable autonomous mode (no confirmations)", false)
		.action(async (promptArg: string | undefined, options) => {
			logger.debug("Task chat command called", { promptArg, options })

			try {
				// Initialize embedded controller
				formatter.info("Initializing Cline...")
				const controller = await getEmbeddedController(logger, config.configDir)

				// Set up mode if specified
				if (options.mode) {
					if (options.mode !== "plan" && options.mode !== "act") {
						throw new Error(`Invalid mode: "${options.mode}". Valid options are: act, plan`)
					}
					await controller.togglePlanActMode(options.mode as "plan" | "act")
				}

				// Chat session state
				const session: ChatSession = {
					taskId: null,
					isRunning: true,
					awaitingApproval: false,
					awaitingInput: false,
					adapter: null,
				}

				// Create webview adapter for output
				session.adapter = createCliWebviewAdapter(controller, formatter)

				// Start or resume task
				if (options.task) {
					// Resume existing task
					const history = await controller.getTaskWithId(options.task)
					if (!history) {
						throw new Error(`Task not found: ${options.task}`)
					}
					session.taskId = await controller.initTask(undefined, undefined, undefined, history.historyItem)
					formatter.info(`Resumed task: ${session.taskId}`)
				} else if (promptArg) {
					// Start new task with prompt
					session.taskId = await controller.initTask(promptArg)
					formatter.info(`Started task: ${session.taskId}`)
				}

				// Display welcome message
				formatter.raw("")
				formatter.info("═".repeat(60))
				formatter.info("  Cline Interactive Chat Mode")
				formatter.info("═".repeat(60))
				if (session.taskId) {
					formatter.info(`Task: ${session.taskId}`)
				}
				const state = await controller.getStateToPostToWebview()
				formatter.info(`Mode: ${state.mode || "act"}`)
				formatter.raw("")
				formatter.info("Type your message and press Enter to send.")
				formatter.info("Type /help for available commands, /quit to exit.")
				formatter.raw("─".repeat(60))
				formatter.raw("")

				// Output existing messages if resuming
				if (session.taskId && session.adapter) {
					session.adapter.outputAllMessages()
				}

				// Start listening for state updates
				session.adapter.startListening((messages) => {
					const pendingState = checkForPendingInput(messages)
					session.awaitingApproval = pendingState.awaitingApproval
					session.awaitingInput = pendingState.awaitingInput
				})

				// Create readline interface
				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
					prompt: "> ",
				})

				// Handle line input
				rl.on("line", async (line: string) => {
					const input = line.trim()

					if (!input) {
						rl.prompt()
						return
					}

					// Check for chat commands
					if (input.startsWith("/")) {
						await processChatCommand(input, session, formatter, logger)
						if (!session.isRunning) {
							rl.close()
							return
						}
						rl.prompt()
						return
					}

					// Handle approval shortcuts
					if (session.awaitingApproval) {
						const lowerInput = input.toLowerCase()
						if (lowerInput === "y" || lowerInput === "yes" || lowerInput === "approve") {
							if (controller.task) {
								await controller.task.handleWebviewAskResponse("yesButtonClicked")
								session.awaitingApproval = false
							}
							rl.prompt()
							return
						}
						if (lowerInput === "n" || lowerInput === "no" || lowerInput === "deny") {
							if (controller.task) {
								await controller.task.handleWebviewAskResponse("noButtonClicked")
								session.awaitingApproval = false
							}
							rl.prompt()
							return
						}
					}

					// If no active task, start a new one
					if (!session.taskId) {
						session.taskId = await controller.initTask(input)
						formatter.info(`Started task: ${session.taskId}`)
						session.adapter?.resetMessageCounter()
					} else if (controller.task) {
						// Send message to existing task
						await controller.task.handleWebviewAskResponse("messageResponse", input)
					}

					rl.prompt()
				})

				// Handle close
				rl.on("close", async () => {
					formatter.raw("")
					formatter.info("Chat session ended")

					// Stop listening and cleanup
					session.adapter?.stopListening()
					await disposeEmbeddedController(logger)

					process.exit(0)
				})

				// Handle Ctrl+C
				rl.on("SIGINT", () => {
					formatter.raw("")
					formatter.info("Chat session ended (interrupted)")
					rl.close()
				})

				// Start prompt
				rl.prompt()
			} catch (error) {
				formatter.error((error as Error).message)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})

	return chatCommand
}
