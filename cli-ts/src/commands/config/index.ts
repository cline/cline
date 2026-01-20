/**
 * Config command group - manage persistent CLI configuration
 *
 * This command uses Cline's StateManager to read/write settings directly,
 * ensuring CLI config changes are reflected in the extension and vice versa.
 */

import { Command } from "commander"
import { disposeEmbeddedController, getEmbeddedController } from "../../core/embedded-controller.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Parse a string value into the appropriate type based on the key
 */
export function parseValue(key: string, value: string): unknown {
	// Handle boolean values
	const lowerValue = value.toLowerCase()
	if (lowerValue === "true" || lowerValue === "1" || lowerValue === "yes") {
		return true
	}
	if (lowerValue === "false" || lowerValue === "0" || lowerValue === "no") {
		return false
	}

	// Try to parse as JSON (for arrays and objects)
	const trimmed = value.trim()
	if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
		try {
			return JSON.parse(value)
		} catch {
			// If JSON parsing fails, fall through to other parsing
		}
	}

	// Handle numeric values - try to parse as number
	const numValue = Number(value)
	if (!Number.isNaN(numValue) && value.trim() !== "") {
		return numValue
	}

	// Default: return as string
	return value
}

/**
 * Get a nested value from an object using dot notation
 * e.g., getNestedValue(obj, "browserSettings.viewport.width")
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".")
	let current: unknown = obj

	for (const part of parts) {
		if (current === null || current === undefined || typeof current !== "object") {
			return undefined
		}
		current = (current as Record<string, unknown>)[part]
	}

	return current
}

/**
 * Set a nested value in an object using dot notation
 * e.g., setNestedValue(obj, "browserSettings.viewport.width", 1200)
 * Returns the modified root object for the top-level key
 */
export function setNestedValue(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): { rootKey: string; rootValue: unknown } {
	const parts = path.split(".")
	const rootKey = parts[0]

	if (parts.length === 1) {
		// Simple case: top-level key
		return { rootKey, rootValue: value }
	}

	// Clone the root object to avoid mutating the original
	const rootValue = JSON.parse(JSON.stringify(obj[rootKey] ?? {}))

	// Navigate to the parent of the target, creating objects as needed
	let current = rootValue as Record<string, unknown>
	for (let i = 1; i < parts.length - 1; i++) {
		const part = parts[i]
		if (current[part] === undefined || current[part] === null || typeof current[part] !== "object") {
			current[part] = {}
		}
		current = current[part] as Record<string, unknown>
	}

	// Set the final value
	current[parts[parts.length - 1]] = value
	return { rootKey, rootValue }
}

/**
 * Create the config set command
 */
function createConfigSetCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	return new Command("set")
		.description("Set a configuration value (supports dot notation for nested values, e.g., browserSettings.viewport.width)")
		.argument("<key>", "Configuration key to set")
		.argument("<value>", "Value to set")
		.action(async (key: string, value: string) => {
			logger.debug(`Setting config: ${key} = ${value}`)

			try {
				// Initialize embedded controller to access StateManager
				formatter.info("Initializing Cline...")
				const controller = await getEmbeddedController(logger, config.configDir)

				// Parse value to appropriate type
				const parsedValue = parseValue(key, value)

				// Check if this is a nested path
				if (key.includes(".")) {
					// For nested paths, get the current root object, modify it, and save the whole thing
					const rootKey = key.split(".")[0]
					let rootValue = controller.stateManager.getGlobalSettingsKey(rootKey as any)
					if (rootValue === undefined) {
						rootValue = controller.stateManager.getGlobalStateKey(rootKey as any)
					}

					// Build the updated root object
					const currentRoot = rootValue !== undefined && typeof rootValue === "object" ? rootValue : {}
					const { rootValue: newRootValue } = setNestedValue({ [rootKey]: currentRoot }, key, parsedValue)

					// Save the updated root object
					controller.stateManager.setGlobalState(rootKey as any, newRootValue as any)
				} else {
					// Simple top-level key
					controller.stateManager.setGlobalState(key as any, parsedValue as any)
				}

				// Flush pending state to ensure changes are persisted before exit
				await controller.stateManager.flushPendingState()

				formatter.success(`Set ${key} = ${String(parsedValue)}`)

				// Cleanup and exit
				await disposeEmbeddedController(logger)
				process.exit(0)
			} catch (err) {
				formatter.error(err as Error)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})
}

/**
 * Create the config get command
 */
function createConfigGetCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	return new Command("get")
		.description("Get a configuration value (supports dot notation for nested values, e.g., browserSettings.viewport.width)")
		.argument("<key>", "Configuration key to get")
		.action(async (key: string) => {
			logger.debug(`Getting config: ${key}`)

			try {
				// Initialize embedded controller to access StateManager
				formatter.info("Initializing Cline...")
				const controller = await getEmbeddedController(logger, config.configDir)

				let value: unknown

				// Check if this is a nested path
				if (key.includes(".")) {
					// For nested paths, get the root object first
					const rootKey = key.split(".")[0]
					let rootValue = controller.stateManager.getGlobalSettingsKey(rootKey as any)
					if (rootValue === undefined) {
						rootValue = controller.stateManager.getGlobalStateKey(rootKey as any)
					}

					if (rootValue !== undefined && typeof rootValue === "object") {
						// Get the nested value
						value = getNestedValue({ [rootKey]: rootValue }, key)
					}
				} else {
					// Simple top-level key
					value = controller.stateManager.getGlobalSettingsKey(key as any)
					if (value === undefined) {
						value = controller.stateManager.getGlobalStateKey(key as any)
					}
				}

				if (value === undefined) {
					formatter.info(`${key} is not set`)
				} else {
					// Format objects/arrays as JSON for display
					const displayValue = typeof value === "object" ? JSON.stringify(value, null, 2) : value
					formatter.keyValue({ [key]: displayValue })
				}

				// Cleanup and exit
				await disposeEmbeddedController(logger)
				process.exit(0)
			} catch (err) {
				formatter.error(err as Error)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})
}

/**
 * Create the config list command
 */
function createConfigListCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	return new Command("list").description("List all configuration values").action(async () => {
		logger.debug("Listing all config")

		try {
			// Initialize embedded controller to access StateManager
			formatter.info("Initializing Cline...")

			// Read the globalState.json file directly to get all settings
			const fs = await import("fs")
			const path = await import("path")
			const globalStatePath = path.join(config.configDir || `${process.env.HOME}/.cline`, "data", "globalState.json")

			let allSettings: Record<string, unknown> = {}
			if (fs.existsSync(globalStatePath)) {
				const content = fs.readFileSync(globalStatePath, "utf-8")
				allSettings = JSON.parse(content)
			}

			formatter.raw("")
			formatter.raw(JSON.stringify(allSettings, null, 2))
			formatter.raw("")

			// Cleanup and exit
			process.exit(0)
		} catch (err) {
			formatter.error(err as Error)
			process.exit(1)
		}
	})
}

/**
 * Create the config delete command
 */
function createConfigDeleteCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	return new Command("delete")
		.alias("rm")
		.description("Delete a configuration value (reset to default)")
		.argument("<key>", "Configuration key to delete")
		.action(async (key: string) => {
			logger.debug(`Deleting config: ${key}`)

			try {
				// Initialize embedded controller to access StateManager
				formatter.info("Initializing Cline...")
				const controller = await getEmbeddedController(logger, config.configDir)

				// Set the value to undefined to reset to default
				// Using type assertion since key is dynamic
				controller.stateManager.setGlobalState(key as any, undefined)

				// Flush pending state to ensure changes are persisted before exit
				await controller.stateManager.flushPendingState()

				formatter.success(`Reset ${key} to default`)

				// Cleanup and exit
				await disposeEmbeddedController(logger)
				process.exit(0)
			} catch (err) {
				formatter.error(err as Error)
				await disposeEmbeddedController(logger)
				process.exit(1)
			}
		})
}

/**
 * Create the config command group
 */
export function createConfigCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	const configCommand = new Command("config").alias("c").description("Manage CLI configuration")

	configCommand.addCommand(createConfigSetCommand(config, logger, formatter))
	configCommand.addCommand(createConfigGetCommand(config, logger, formatter))
	configCommand.addCommand(createConfigListCommand(config, logger, formatter))
	configCommand.addCommand(createConfigDeleteCommand(config, logger, formatter))

	return configCommand
}
