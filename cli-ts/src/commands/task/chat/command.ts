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
import { parseAtPaths, processExplicitFiles, processExplicitImages } from "../../../core/path-parser.js"
import type { CliConfig } from "../../../types/config.js"
import type { Logger } from "../../../types/logger.js"
import { startRepl } from "./repl.js"
import { createSession } from "./session.js"

/**
 * Collect multiple option values into an array
 * Used for -f and -i options that can be specified multiple times
 */
function collectOption(value: string, previous: string[]): string[] {
	return previous.concat([value])
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
		.option("-f, --file <path>", "Attach file to initial prompt (can be repeated)", collectOption, [])
		.option("-i, --image <path>", "Attach image to initial prompt (can be repeated)", collectOption, [])
		.option("-y, --yolo", "Enable autonomous mode (no confirmations)", false)
		.action(async (promptArg: string | undefined, options) => {
			logger.debug("Task chat command called", { promptArg, options })

			try {
				// Process explicit file and image attachments from CLI options
				const cwd = process.cwd()
				let initialFiles: string[] = []
				let initialImages: string[] = []

				// Process -f/--file options (can be files or images, auto-detected)
				if (options.file && options.file.length > 0) {
					const processed = processExplicitFiles(options.file, cwd)
					initialFiles = processed.files
					initialImages = processed.images
				}

				// Process -i/--image options (must be images)
				if (options.image && options.image.length > 0) {
					const images = processExplicitImages(options.image, cwd)
					initialImages = initialImages.concat(images)
				}

				// Parse @path references from the initial prompt if provided
				let processedPrompt = promptArg
				if (promptArg) {
					const parsed = parseAtPaths(promptArg, cwd)

					// Show warnings for any files that couldn't be processed
					for (const warning of parsed.warnings) {
						formatter.warn(warning)
					}

					processedPrompt = parsed.cleanedMessage
					initialFiles = initialFiles.concat(parsed.files)
					initialImages = initialImages.concat(parsed.images)
				}

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
					initialPrompt: processedPrompt,
					initialImages: initialImages.length > 0 ? initialImages : undefined,
					initialFiles: initialFiles.length > 0 ? initialFiles : undefined,
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
