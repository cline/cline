#!/usr/bin/env node
// Suppress Node.js deprecation warnings (e.g., punycode) before any imports
process.noDeprecation = true

import { Command } from "commander"
import { createAuthCommand } from "./commands/auth/index.js"
import { createConfigCommand } from "./commands/config/index.js"
import { createTaskChatCommand } from "./commands/task/chat/index.js"
import { createTaskCommand } from "./commands/task/index.js"
import { createTaskSendCommand } from "./commands/task/send.js"
import { createVersionCommand, getVersion } from "./commands/version.js"
import { createConfig } from "./core/config.js"
import { applyConsoleFilter } from "./core/console-filter.js"
import { createLogger } from "./core/logger.js"
import { createFormatter, parseOutputFormat } from "./core/output/index.js"
import type { OutputFormat, OutputFormatter } from "./core/output/types.js"
import type { CliConfig } from "./types/config.js"
import type { Logger } from "./types/logger.js"

/**
 * Read input from stdin if available (non-blocking check)
 */
async function readStdin(): Promise<string | null> {
	// Check if stdin is a TTY (interactive terminal)
	if (process.stdin.isTTY) {
		return null
	}

	return new Promise((resolve) => {
		let data = ""
		process.stdin.setEncoding("utf-8")

		process.stdin.on("readable", () => {
			let chunk: string | null
			while ((chunk = process.stdin.read() as string | null) !== null) {
				data += chunk
			}
		})

		process.stdin.on("end", () => {
			resolve(data.trim() || null)
		})

		// Timeout after 100ms if no data
		setTimeout(() => {
			if (!data) {
				resolve(null)
			}
		}, 100)
	})
}

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
		.option("-y, --yolo", "Enable autonomous mode (no confirmations)", false)

	return program
}

/**
 * Check if an argument looks like a subcommand
 */
function isKnownSubcommand(arg: string): boolean {
	const subcommands = ["version", "config", "auth", "task", "t", "c", "help", "-h", "--help", "-v", "--version"]
	return subcommands.includes(arg)
}

/**
 * Run the default command (chat or send based on context)
 */
async function runDefaultCommand(
	prompt: string,
	yoloMode: boolean,
	hasPipedInput: boolean,
	config: CliConfig,
	logger: Logger,
	formatter: OutputFormatter,
): Promise<void> {
	// Decision matrix:
	// - Piped input + yolo = send command (non-interactive, exit on completion)
	// - Piped input + no yolo = chat command (REPL stays open for interaction)
	// - Direct arg + yolo = chat command with yolo (REPL with auto-approve)
	// - Direct arg + no yolo = chat command (normal REPL)
	if (hasPipedInput && yoloMode) {
		// Create and run send command with --yolo flag (implies --wait behavior)
		const sendCommand = createTaskSendCommand(config, logger, formatter)
		// Using { from: "user" } means args are treated as user-provided (no stripping of argv[0,1])
		await sendCommand.parseAsync([prompt, "--yolo"], { from: "user" })
	} else {
		// Create and run chat command
		const chatCommand = createTaskChatCommand(config, logger, formatter)
		// Using { from: "user" } means args are treated as user-provided (no stripping of argv[0,1])
		const args = [prompt]
		if (yoloMode) {
			args.push("--yolo")
		}
		await chatCommand.parseAsync(args, { from: "user" })
	}
}

/**
 * Main entry point for the CLI
 */
export async function main(): Promise<void> {
	const program = createProgram()

	// Use parseOptions to extract global options without consuming subcommand args
	// This allows us to get --verbose, --config-dir, etc. before registering subcommands
	const { operands, unknown } = program.parseOptions(process.argv.slice(2))

	const opts = program.opts()

	// Apply console filtering early to suppress noisy operational output
	// This must happen before any other code runs that might output to console
	applyConsoleFilter(opts.verbose)

	// Parse and validate output format
	let outputFormat: OutputFormat
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
	const formatter: OutputFormatter = createFormatter(outputFormat)

	logger.debug("CLI started with config:", config)

	// Check for stdin input (piped data)
	const stdinInput = await readStdin()
	const hasPipedInput = stdinInput !== null

	// Determine if we should handle as default command
	// This happens when:
	// 1. There's piped stdin input, OR
	// 2. There's a positional argument that's not a known subcommand
	const firstOperand = operands[0]
	const hasPromptArg = firstOperand && !isKnownSubcommand(firstOperand)
	const prompt = stdinInput || (hasPromptArg ? firstOperand : null)

	if (prompt) {
		// Handle as default command (route to chat or send)
		// Key logic: piped input + yolo = non-interactive send (exit on completion)
		// All other cases = chat (REPL, stays open)
		logger.debug("Running default command with prompt", { prompt, yolo: opts.yolo, hasPipedInput })
		await runDefaultCommand(prompt, opts.yolo, hasPipedInput, config, logger, formatter)
		return
	}

	// Add subcommands BEFORE parsing
	program.addCommand(createVersionCommand(config, logger))
	program.addCommand(createConfigCommand(config, logger, formatter))
	program.addCommand(createAuthCommand(config, logger, formatter))
	program.addCommand(createTaskCommand(config, logger, formatter))

	// Now parse the full command line with all subcommands registered
	program.parse(process.argv)

	// If no subcommand provided, show help
	if (process.argv.length === 2 || (operands.length === 0 && unknown.length === 0)) {
		program.help()
	}
}

// Run main function
main().catch((error) => {
	console.error("Fatal error:", error)
	process.exit(1)
})
