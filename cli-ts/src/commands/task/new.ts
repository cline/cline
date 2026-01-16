/**
 * Task new command - create a new task
 */

import { Command } from "commander"
import type { OutputFormatter } from "../../core/output/types.js"
import { createTaskStorage } from "../../core/task-client.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"
import type { TaskMode } from "../../types/task.js"

/**
 * Parse settings from command line options
 * Supports: -s key=value or --setting key=value (can be repeated)
 */
function parseSettings(settingsArray: string[] | undefined): Record<string, string> | undefined {
	if (!settingsArray || settingsArray.length === 0) {
		return undefined
	}

	const settings: Record<string, string> = {}
	for (const setting of settingsArray) {
		const eqIndex = setting.indexOf("=")
		if (eqIndex === -1) {
			throw new Error(`Invalid setting format: "${setting}". Expected key=value`)
		}
		const key = setting.slice(0, eqIndex)
		const value = setting.slice(eqIndex + 1)
		settings[key] = value
	}
	return settings
}

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
 * Create the task new command
 */
export function createTaskNewCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const newCommand = new Command("new")
		.alias("n")
		.description("Create a new task")
		.argument("<prompt>", "Task prompt/description")
		.option(
			"-s, --setting <key=value>",
			"Override setting (can be repeated)",
			(value, prev: string[]) => {
				prev.push(value)
				return prev
			},
			[],
		)
		.option("-y, --yolo", "Enable autonomous mode (no confirmations)", false)
		.option("--no-interactive", "Same as --yolo")
		.option("-m, --mode <mode>", "Starting mode: act or plan (default: act)")
		.option("-w, --workspace <path>", "Working directory for the task")
		.action(async (prompt: string, options) => {
			logger.debug("Task new command called", { prompt, options })

			try {
				// Validate and parse options
				const mode = validateMode(options.mode)
				const settings = parseSettings(options.setting)
				const workingDirectory = options.workspace || process.cwd()

				// Create task storage
				const taskStorage = createTaskStorage(config.configDir)

				// Create the task
				const task = taskStorage.create({
					prompt,
					mode,
					noInteractive: options.yolo || !options.interactive,
					settings,
					workingDirectory,
				})

				logger.debug("Task created", task)

				// Output success message
				formatter.success(`Task created: ${task.id}`)
				formatter.info(`Prompt: ${prompt}`)
				formatter.info(`Mode: ${task.mode}`)
				formatter.info(`Working directory: ${task.workingDirectory}`)

				if (task.settings && Object.keys(task.settings).length > 0) {
					formatter.info(`Settings: ${JSON.stringify(task.settings)}`)
				}

				// JSON output includes full task info
				if (config.outputFormat === "json") {
					formatter.raw(JSON.stringify(task, null, 2))
				}
			} catch (error) {
				formatter.error((error as Error).message)
				process.exit(1)
			}
		})

	return newCommand
}
