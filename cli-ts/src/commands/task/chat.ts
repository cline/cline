/**
 * Task chat command - interactive REPL mode with embedded Controller
 *
 * This command provides an interactive chat interface using Cline's
 * embedded Controller, allowing real-time AI interactions directly
 * from the terminal.
 */

import type { ApiConfiguration, ApiProvider } from "@shared/api"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import chalk from "chalk"
import { Command } from "commander"
import readline from "readline"
import { CliWebviewAdapter } from "../../core/cli-webview-adapter.js"
import { disposeEmbeddedController, getEmbeddedController } from "../../core/embedded-controller.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Get the model ID for the current provider and mode
 */
function getModelIdForProvider(
	apiConfiguration: ApiConfiguration | undefined,
	provider: ApiProvider | undefined,
	mode: Mode,
): string | undefined {
	if (!apiConfiguration || !provider) {
		return undefined
	}

	const prefix = mode === "plan" ? "planMode" : "actMode"

	// Map provider to the corresponding model ID field
	switch (provider) {
		case "openrouter":
		case "cline":
			return apiConfiguration[`${prefix}OpenRouterModelId`]
		case "anthropic":
		case "claude-code":
		case "bedrock":
		case "vertex":
		case "gemini":
		case "openai-native":
		case "deepseek":
		case "qwen":
		case "qwen-code":
		case "doubao":
		case "mistral":
		case "asksage":
		case "xai":
		case "moonshot":
		case "nebius":
		case "sambanova":
		case "cerebras":
		case "sapaicore":
		case "zai":
		case "fireworks":
		case "minimax":
			return apiConfiguration[`${prefix}ApiModelId`]
		case "openai":
			return apiConfiguration[`${prefix}OpenAiModelId`]
		case "ollama":
			return apiConfiguration[`${prefix}OllamaModelId`]
		case "lmstudio":
			return apiConfiguration[`${prefix}LmStudioModelId`]
		case "requesty":
			return apiConfiguration[`${prefix}RequestyModelId`]
		case "together":
			return apiConfiguration[`${prefix}TogetherModelId`]
		case "litellm":
			return apiConfiguration[`${prefix}LiteLlmModelId`]
		case "groq":
			return apiConfiguration[`${prefix}GroqModelId`]
		case "baseten":
			return apiConfiguration[`${prefix}BasetenModelId`]
		case "huggingface":
			return apiConfiguration[`${prefix}HuggingFaceModelId`]
		case "huawei-cloud-maas":
			return apiConfiguration[`${prefix}HuaweiCloudMaasModelId`]
		case "oca":
			return apiConfiguration[`${prefix}OcaModelId`]
		case "hicap":
			return apiConfiguration[`${prefix}HicapModelId`]
		case "aihubmix":
			return apiConfiguration[`${prefix}AihubmixModelId`]
		case "nousResearch":
			return apiConfiguration[`${prefix}NousResearchModelId`]
		case "vercel-ai-gateway":
			return apiConfiguration[`${prefix}VercelAiGatewayModelId`]
		case "vscode-lm":
		case "dify":
		default:
			return undefined
	}
}

/**
 * Build the CLI prompt string with mode, provider, and model
 * Format: [mode] provider/model >
 */
function buildPromptString(mode: Mode, provider: ApiProvider | undefined, modelId: string | undefined): string {
	const modeStr = mode === "plan" ? chalk.magenta("[plan]") : chalk.cyan("[act]")
	const providerStr = provider || "unknown"

	// Shorten very long model IDs for display (keep last part after last /)
	let modelStr = modelId || "unknown"
	if (modelStr.length > 40) {
		const lastSlash = modelStr.lastIndexOf("/")
		if (lastSlash > 0 && lastSlash < modelStr.length - 1) {
			modelStr = "..." + modelStr.substring(lastSlash)
		} else {
			modelStr = modelStr.substring(0, 37) + "..."
		}
	}

	const providerModelStr = chalk.dim(`${providerStr}/${modelStr}`)

	return `${modeStr} ${providerModelStr} ${chalk.white(">")} `
}

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
async function processChatCommand(input: string, session: ChatSession, fmt: OutputFormatter, logger: Logger): Promise<boolean> {
	const parts = input.slice(1).split(/\s+/)
	const cmd = parts[0].toLowerCase()
	const args = parts.slice(1)

	const controller = await getEmbeddedController(logger)

	switch (cmd) {
		case "help":
		case "h":
		case "?":
			fmt.raw("")
			fmt.info("Chat commands:")
			fmt.raw("  /help, /h, /?      - Show this help")
			fmt.raw("  /plan              - Switch to plan mode")
			fmt.raw("  /act               - Switch to act mode")
			fmt.raw("  /mode <plan|act>   - Switch mode")
			fmt.raw("  /status            - Show task status")
			fmt.raw("  /cancel            - Cancel current task")
			fmt.raw("  /approve, /a, /y   - Approve pending action")
			fmt.raw("  /deny, /d, /n      - Deny pending action")
			fmt.raw("  /quit, /q, /exit   - Exit chat mode")
			fmt.raw("")
			return true

		case "plan":
			await controller.togglePlanActMode("plan")
			fmt.success("Switched to plan mode")
			return true

		case "act":
			await controller.togglePlanActMode("act")
			fmt.success("Switched to act mode")
			return true

		case "mode":
		case "m":
			if (args.length === 0) {
				const state = await controller.getStateToPostToWebview()
				fmt.info(`Current mode: ${state.mode || "unknown"}`)
			} else {
				const newMode = args[0].toLowerCase()
				if (newMode !== "plan" && newMode !== "act") {
					fmt.error("Invalid mode. Use 'plan' or 'act'")
				} else {
					await controller.togglePlanActMode(newMode as "plan" | "act")
					fmt.success(`Switched to ${newMode} mode`)
				}
			}
			return true

		case "status":
		case "s": {
			const state = await controller.getStateToPostToWebview()
			fmt.raw("")
			fmt.info(`Task ID: ${session.taskId || "none"}`)
			fmt.info(`Mode: ${state.mode || "unknown"}`)
			fmt.info(`Messages: ${state.clineMessages?.length || 0}`)
			if (session.awaitingApproval) {
				fmt.warn("Awaiting approval (use /approve or /deny)")
			}
			if (session.awaitingInput) {
				fmt.warn("Awaiting user input")
			}
			fmt.raw("")
			return true
		}

		case "cancel": {
			if (controller.task) {
				await controller.cancelTask()
				fmt.success("Task cancelled")
			} else {
				fmt.warn("No active task to cancel")
			}
			return true
		}

		case "approve":
		case "a":
		case "y": {
			if (!session.awaitingApproval) {
				fmt.warn("No pending approval request")
			} else if (controller.task) {
				await controller.task.handleWebviewAskResponse("yesButtonClicked")
				session.awaitingApproval = false
				fmt.success("Action approved")
			}
			return true
		}

		case "deny":
		case "d":
		case "n": {
			if (!session.awaitingApproval) {
				fmt.warn("No pending approval request")
			} else if (controller.task) {
				await controller.task.handleWebviewAskResponse("noButtonClicked")
				session.awaitingApproval = false
				fmt.success("Action denied")
			}
			return true
		}

		case "quit":
		case "q":
		case "exit":
			session.isRunning = false
			return true

		default:
			fmt.warn(`Unknown command: /${cmd}. Type /help for available commands.`)
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
				session.adapter = new CliWebviewAdapter(controller, formatter)

				// Track if we started with a prompt (AI will be processing)
				let startedWithPrompt = false

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
					startedWithPrompt = true
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

				// Create readline interface
				const rl = readline.createInterface({
					input: process.stdin,
					output: process.stdout,
					prompt: "> ", // Default prompt, will be updated dynamically
				})

				// Track if we're currently processing (AI is working)
				let isProcessing = startedWithPrompt
				// Track previous awaiting states to detect transitions
				let wasAwaitingInput = false

				// Helper to update the prompt string (but not necessarily show it)
				async function updatePromptString(): Promise<void> {
					const currentState = await controller.getStateToPostToWebview()
					const mode = (currentState.mode || "act") as Mode
					const provider = (
						mode === "plan"
							? currentState.apiConfiguration?.planModeApiProvider
							: currentState.apiConfiguration?.actModeApiProvider
					) as ApiProvider | undefined
					const modelId = getModelIdForProvider(currentState.apiConfiguration, provider, mode)
					const promptStr = buildPromptString(mode, provider, modelId)
					rl.setPrompt(promptStr)
				}

				// Helper to show the prompt (call after updating)
				function showPrompt(): void {
					rl.prompt()
				}

				// Start listening for state updates
				session.adapter.startListening((messages) => {
					const pendingState = checkForPendingInput(messages)
					session.awaitingApproval = pendingState.awaitingApproval
					session.awaitingInput = pendingState.awaitingInput

					// Detect transition from processing to awaiting input
					const nowAwaitingInput = pendingState.awaitingApproval || pendingState.awaitingInput
					if (isProcessing && nowAwaitingInput && !wasAwaitingInput) {
						// AI just finished and is now waiting for input - show prompt
						isProcessing = false
						updatePromptString().then(() => showPrompt())
					}
					wasAwaitingInput = nowAwaitingInput
				})

				// Handle line input
				rl.on("line", async (line: string) => {
					const input = line.trim()

					if (!input) {
						// Empty input - just show prompt again
						await updatePromptString()
						showPrompt()
						return
					}

					// Check for chat commands
					if (input.startsWith("/")) {
						await processChatCommand(input, session, formatter, logger)
						if (!session.isRunning) {
							rl.close()
							return
						}
						// Commands complete immediately, show prompt
						await updatePromptString()
						showPrompt()
						return
					}

					// Handle approval shortcuts
					if (session.awaitingApproval) {
						const lowerInput = input.toLowerCase()
						if (lowerInput === "y" || lowerInput === "yes" || lowerInput === "approve") {
							if (controller.task) {
								isProcessing = true // AI will start processing
								wasAwaitingInput = false
								await controller.task.handleWebviewAskResponse("yesButtonClicked")
								session.awaitingApproval = false
							}
							// Don't show prompt - wait for AI to finish
							return
						}
						if (lowerInput === "n" || lowerInput === "no" || lowerInput === "deny") {
							if (controller.task) {
								isProcessing = true // AI will start processing
								wasAwaitingInput = false
								await controller.task.handleWebviewAskResponse("noButtonClicked")
								session.awaitingApproval = false
							}
							// Don't show prompt - wait for AI to finish
							return
						}
					}

					// If no active task, start a new one
					if (!session.taskId) {
						isProcessing = true // AI will start processing
						wasAwaitingInput = false
						session.taskId = await controller.initTask(input)
						formatter.info(`Started task: ${session.taskId}`)
						session.adapter?.resetMessageCounter()
						// Don't show prompt - wait for AI to finish
					} else if (controller.task) {
						// Check if input is a numbered option selection
						let messageToSend = input
						if (session.awaitingInput && session.adapter) {
							const options = session.adapter.currentOptions
							const num = parseInt(input, 10)
							if (!Number.isNaN(num) && num >= 1 && num <= options.length) {
								messageToSend = options[num - 1]
							}
						}

						isProcessing = true // AI will start processing
						wasAwaitingInput = false
						// Send message to existing task
						await controller.task.handleWebviewAskResponse("messageResponse", messageToSend)
						// Don't show prompt - wait for AI to finish
					}
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

				// Start prompt with current state (only if not already processing)
				await updatePromptString()
				if (!isProcessing) {
					showPrompt()
				}
			} catch (error) {
				formatter.error((error as Error).message)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})

	return chatCommand
}
