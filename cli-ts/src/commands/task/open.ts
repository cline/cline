/**
 * Task open command - open/resume an existing task
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
 * Format relative time
 */
function formatTimeAgo(timestamp: number): string {
	const now = Date.now()
	const diff = now - timestamp
	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)

	if (days > 0) {
		return days === 1 ? "1 day ago" : `${days} days ago`
	}
	if (hours > 0) {
		return hours === 1 ? "1 hour ago" : `${hours} hours ago`
	}
	if (minutes > 0) {
		return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`
	}
	return "just now"
}

/**
 * Create the task open command
 */
export function createTaskOpenCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const openCommand = new Command("open")
		.alias("o")
		.description("Open/resume an existing task")
		.argument("<task-id>", "Task ID (can be partial)")
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
		.option("-m, --mode <mode>", "Override mode: act or plan")
		.action(async (taskId: string, options) => {
			logger.debug("Task open command called", { taskId, options })

			try {
				// Create task storage
				const taskStorage = createTaskStorage(config.configDir)

				// Find task by ID (supports partial IDs)
				const task = taskStorage.get(taskId)

				if (!task) {
					formatter.error(`Task not found: ${taskId}`)
					formatter.info('Use "cline task list" to see available tasks')
					process.exit(1)
				}

				logger.debug("Task found", task)

				// Apply mode override if specified
				const newMode = validateMode(options.mode)
				if (newMode && newMode !== task.mode) {
					taskStorage.updateMode(task.id, newMode)
					task.mode = newMode
					logger.debug(`Mode changed to ${newMode}`)
				}

				// Apply settings override if specified
				const newSettings = parseSettings(options.setting)
				if (newSettings) {
					const mergedSettings = { ...task.settings, ...newSettings }
					taskStorage.update(task.id, { settings: mergedSettings })
					task.settings = mergedSettings
					logger.debug("Settings updated", mergedSettings)
				}

				// Update status to active if it was paused
				if (task.status === "paused") {
					taskStorage.updateStatus(task.id, "active")
					task.status = "active"
				}

				// Output task info
				formatter.success(`Opened task: ${task.id}`)
				formatter.info(`Prompt: ${task.prompt}`)
				formatter.info(`Status: ${task.status}`)
				formatter.info(`Mode: ${task.mode}`)
				formatter.info(`Created: ${formatTimeAgo(task.createdAt)}`)
				formatter.info(`Messages: ${task.messageCount}`)

				if (task.workingDirectory) {
					formatter.info(`Working directory: ${task.workingDirectory}`)
				}

				if (task.settings && Object.keys(task.settings).length > 0) {
					formatter.info(`Settings: ${JSON.stringify(task.settings)}`)
				}

				// JSON output includes full task info
				if (config.outputFormat === "json") {
					formatter.raw(JSON.stringify(task, null, 2))
				}

				// TODO Note: In Phase 4, this will transition to chat mode
				// For now, we just display the task info
				formatter.info("")
				formatter.info('Task loaded. Use "cline task chat" to continue the conversation (coming in Phase 4)')
			} catch (error) {
				formatter.error((error as Error).message)
				process.exit(1)
			}
		})

	return openCommand
}
