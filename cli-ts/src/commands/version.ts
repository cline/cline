import { Command } from "commander"
import { createRequire } from "module"
import type { CliConfig } from "../types/config.js"
import type { Logger } from "../types/logger.js"

// Use createRequire to import JSON (ESM compatible)
const require = createRequire(import.meta.url)
const rootPackageJson = require("../../../package.json")

/**
 * Get the Cline version from the root package.json
 */
export function getVersion(): string {
	return rootPackageJson.version
}

/**
 * Execute the version command - displays the Cline version
 */
export function runVersionCommand(config: CliConfig, logger: Logger): void {
	const version = getVersion()
	logger.debug(`Displaying version: ${version}`)
	console.log(`cline ${version}`)
}

/**
 * Create the version subcommand
 */
export function createVersionCommand(config: CliConfig, logger: Logger): Command {
	return new Command("version").description("Display the Cline version").action(() => {
		runVersionCommand(config, logger)
	})
}
