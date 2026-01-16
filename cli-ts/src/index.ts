#!/usr/bin/env node
// Suppress Node.js deprecation warnings (e.g., punycode) before any imports
process.noDeprecation = true

import { Command } from "commander"
import { createAuthCommand } from "./commands/auth/index.js"
import { createConfigCommand } from "./commands/config/index.js"
import { createTaskCommand } from "./commands/task/index.js"
import { createVersionCommand, getVersion } from "./commands/version.js"
import { createConfig } from "./core/config.js"
import { applyConsoleFilter } from "./core/console-filter.js"
import { createLogger } from "./core/logger.js"
import { createFormatterFromOption, parseOutputFormat } from "./core/output/index.js"
import type { OutputFormatter } from "./core/output/types.js"
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
		.option("-F, --output-format <format>", "Output format: rich, json, or plain (default: rich for TTY, plain otherwise)")

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

	// Apply console filtering early to suppress noisy operational output
	// This must happen before any other code runs that might output to console
	applyConsoleFilter(opts.verbose)

	// Parse and validate output format
	let outputFormat
	try {
		outputFormat = parseOutputFormat(opts.outputFormat)
	} catch (err) {
		console.error((err as Error).message)
		process.exit(1)
	}

	// Create config from command line options
	const config: CliConfig = createConfig({
		verbose: opts.verbose,
		configDir: opts.configDir,
		outputFormat,
	})

	// Create logger based on config
	const logger = createLogger(config.verbose)

	// Create output formatter
	const formatter: OutputFormatter = createFormatterFromOption(opts.outputFormat)

	logger.debug("CLI started with config:", config)

	// Add subcommands
	program.addCommand(createVersionCommand(config, logger))
	program.addCommand(createConfigCommand(config, logger, formatter))
	program.addCommand(createAuthCommand(config, logger, formatter))
	program.addCommand(createTaskCommand(config, logger, formatter))

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
