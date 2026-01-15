/**
 * Config command group - manage persistent CLI configuration
 */

import { Command } from "commander"
import { createConfigStorage, isValidConfigKey, parseConfigValue, VALID_CONFIG_KEYS } from "../../core/config-storage.js"
import type { OutputFormatter } from "../../core/output/types.js"
import type { CliConfig } from "../../types/config.js"
import type { Logger } from "../../types/logger.js"

/**
 * Create the config set command
 */
function createConfigSetCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	return new Command("set")
		.description("Set a configuration value")
		.argument("<key>", "Configuration key to set")
		.argument("<value>", "Value to set")
		.action((key: string, value: string) => {
			logger.debug(`Setting config: ${key} = ${value}`)

			// Validate key
			if (!isValidConfigKey(key)) {
				formatter.warn(`Unknown config key: ${key}. Known keys: ${VALID_CONFIG_KEYS.join(", ")}`)
			}

			try {
				// Parse and validate value
				const parsedValue = parseConfigValue(key, value)

				// Save to storage
				const storage = createConfigStorage(config.configDir)
				storage.set(key, parsedValue)

				formatter.success(`Set ${key} = ${String(parsedValue)}`)
			} catch (err) {
				formatter.error(err as Error)
				process.exit(1)
			}
		})
}

/**
 * Create the config get command
 */
function createConfigGetCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	return new Command("get")
		.description("Get a configuration value")
		.argument("<key>", "Configuration key to get")
		.action((key: string) => {
			logger.debug(`Getting config: ${key}`)

			const storage = createConfigStorage(config.configDir)
			const value = storage.get(key)

			if (value === undefined) {
				formatter.info(`${key} is not set`)
			} else {
				formatter.keyValue({ [key]: value })
			}
		})
}

/**
 * Create the config list command
 */
function createConfigListCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	return new Command("list").description("List all configuration values").action(() => {
		logger.debug("Listing all config")

		const storage = createConfigStorage(config.configDir)
		const allConfig = storage.list()

		if (Object.keys(allConfig).length === 0) {
			formatter.info("No configuration values set")
			formatter.info(`Config file: ${storage.getConfigPath()}`)
		} else {
			formatter.keyValue(allConfig)
			formatter.raw("")
			formatter.info(`Config file: ${storage.getConfigPath()}`)
		}
	})
}

/**
 * Create the config delete command
 */
function createConfigDeleteCommand(config: CliConfig, logger: Logger, formatter: OutputFormatter): Command {
	return new Command("delete")
		.alias("rm")
		.description("Delete a configuration value")
		.argument("<key>", "Configuration key to delete")
		.action((key: string) => {
			logger.debug(`Deleting config: ${key}`)

			const storage = createConfigStorage(config.configDir)
			const deleted = storage.delete(key)

			if (deleted) {
				formatter.success(`Deleted ${key}`)
			} else {
				formatter.info(`${key} was not set`)
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
