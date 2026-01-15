#!/usr/bin/env node
import { Command } from "commander"
import { createVersionCommand, getVersion } from "./commands/version.js"
import { createConfig } from "./core/config.js"
import { createLogger } from "./core/logger.js"
import type { CliConfig } from "./types/config.js"

/**
 * Create and configure the commander program
 */
export function createProgram(): Command {
	const program = new Command()

	program
		.name("cline")
		.description("Cline CLI - AI assistant for software development")
		.version(getVersion(), "-v, --version", "Display version number")
		.option("--verbose", "Enable verbose debug output", false)
		.option("--config-dir <path>", "Directory for Cline data storage")

	return program
}

/**
 * Main entry point for the CLI
 */
export async function main(): Promise<void> {
	const program = createProgram()

	// Parse global options first to get config
	program.parse(process.argv)
	const opts = program.opts()

	// Create config from command line options
	const config: CliConfig = createConfig({
		verbose: opts.verbose,
		configDir: opts.configDir,
	})

	// Create logger based on config
	const logger = createLogger(config.verbose)

	logger.debug("CLI started with config:", config)

	// Add subcommands
	program.addCommand(createVersionCommand(config, logger))

	// Re-parse with subcommands added
	program.parse(process.argv)

	// If no subcommand provided, show help
	if (process.argv.length === 2) {
		program.help()
	}
}

// Run main function
main().catch((error) => {
	console.error("Fatal error:", error)
	process.exit(1)
})
