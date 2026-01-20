/**
 * Task chat command - interactive REPL mode with embedded Controller
 *
 * This command provides an interactive chat interface using Cline's
 * embedded Controller, allowing real-time AI interactions directly
 * from the terminal.
 */

import { Command } from "commander"
import { disposeEmbeddedController, getEmbeddedController } from "../../../core/embedded-controller.js"
import type { OutputFormatter } from "../../../core/output/types.js"
import type { CliConfig } from "../../../types/config.js"
import type { Logger } from "../../../types/logger.js"
import { startRepl } from "./repl.js"
import { createSession } from "./session.js"

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
				const controller = await getEmbeddedController(logger, config.configDir)

				// Set up mode if specified
				if (options.mode) {
					if (options.mode !== "plan" && options.mode !== "act") {
						throw new Error(`Invalid mode: "${options.mode}". Valid options are: act, plan`)
					}
					await controller.togglePlanActMode(options.mode as "plan" | "act")
				}

				if (options.yolo) {
					controller.stateManager.setGlobalState("yoloModeToggled", true)
					// Increase mistake limit for autonomous operation (matches Go CLI behavior)
					controller.stateManager.setGlobalState("maxConsecutiveMistakes", 6)
					// Ensure we're in Act mode for autonomous execution (unless user explicitly chose Plan mode)
					if (!options.mode) {
						await controller.togglePlanActMode("act")
					}
				}

				// Create chat session with yolo mode if specified
				const session = createSession(options.yolo)

				if (options.yolo) {
					formatter.info("[YOLO] Autonomous mode enabled - no confirmations required")
				}

				// Start the REPL
				await startRepl({
					session,
					controller,
					formatter,
					logger,
					config,
					initialPrompt: promptArg,
					resumeTaskId: options.task,
				})
			} catch (error) {
				formatter.error((error as Error).message)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})

	return chatCommand
}
