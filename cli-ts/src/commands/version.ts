import { Command } from "commander"
import type { CliConfig } from "../types/config.js"
import type { Logger } from "../types/logger.js"

// Version is injected at build time via esbuild define
declare const __CLINE_VERSION__: string

/**
 * Get the Cline version from the build-time injected value
 */
export function getVersion(): string {
	return __CLINE_VERSION__
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
