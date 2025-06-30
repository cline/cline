#!/usr/bin/env node
import { Command } from "commander"
import chalk from "chalk"
import { setupHandler } from "./commands/setup"
import { runHandler } from "./commands/run"
import { reportHandler } from "./commands/report"
import { evalsEnvHandler } from "./commands/evals-env"
import { runDiffEvalHandler } from "./commands/runDiffEval"

// Create the CLI program
const program = new Command()

// Set up CLI metadata
program.name("cline-eval").description("CLI tool for orchestrating Cline evaluations across multiple benchmarks").version("0.1.0")

// Setup command
program
	.command("setup")
	.description("Clone and set up benchmark repositories")
	.option(
		"-b, --benchmarks <benchmarks>",
		"Comma-separated list of benchmarks to set up",
		"exercism,swe-bench,swelancer,multi-swe",
	)
	.action(async (options) => {
		try {
			await setupHandler(options)
		} catch (error) {
			console.error(chalk.red(`Error during setup: ${error instanceof Error ? error.message : String(error)}`))
			process.exit(1)
		}
	})

// Run command
program
	.command("run")
	.description("Run evaluations")
	.option("-b, --benchmark <benchmark>", "Specific benchmark to run")
	.option("-m, --model <model>", "Model to evaluate", "claude-3-opus-20240229")
	.option("-c, --count <count>", "Number of tasks to run", parseInt)
	.option("-k, --api-key <apiKey>", "Cline API key to use for evaluations")
	.action(async (options) => {
		try {
			await runHandler(options)
		} catch (error) {
			console.error(chalk.red(`Error during run: ${error instanceof Error ? error.message : String(error)}`))
			process.exit(1)
		}
	})

// Report command
program
	.command("report")
	.description("Generate reports")
	.option("-f, --format <format>", "Report format (json, markdown)", "markdown")
	.option("-o, --output <path>", "Output path for the report")
	.action(async (options) => {
		try {
			await reportHandler(options)
		} catch (error) {
			console.error(chalk.red(`Error generating report: ${error instanceof Error ? error.message : String(error)}`))
			process.exit(1)
		}
	})

// Evals-env command
program
	.command("evals-env")
	.description("Manage evals.env files for test mode activation")
	.argument("<action>", "Action to perform: create, remove, or check")
	.option("-d, --directory <directory>", "Directory to create/remove/check evals.env file in (defaults to current directory)")
	.action(async (action, options) => {
		try {
			await evalsEnvHandler({ action, ...options })
		} catch (error) {
			console.error(chalk.red(`Error managing evals.env file: ${error instanceof Error ? error.message : String(error)}`))
			process.exit(1)
		}
	})

// Run-diff-eval command
program
	.command("run-diff-eval")
	.description("Run the diff editing evaluation suite")
	.option("--test-path <path>", "Path to the directory containing test case JSON files")
	.option("--output-path <path>", "Path to the directory to save the test output JSON files")
	.option("--model-ids <model_ids>", "Comma-separated list of model IDs to test")
	.option("--system-prompt-name <name>", "The name of the system prompt to use", "basicSystemPrompt")
	.option("-n, --valid-attempts-per-case <number>", "Number of valid attempts per test case per model (will retry until this many valid attempts are collected)", "1")
	.option("--max-cases <number>", "Maximum number of test cases to run (limits total cases loaded)")
	.option("--parsing-function <name>", "The parsing function to use", "parseAssistantMessageV2")
	.option("--diff-edit-function <name>", "The diff editing function to use", "constructNewFileContentV2")
	.option("--thinking-budget <tokens>", "Set the thinking tokens budget", "0")
	.option("--parallel", "Run tests in parallel", false)
	.option("--replay", "Run evaluation from a pre-recorded LLM output, skipping the API call", false)
	.option("--replay-run-id <run_id>", "The ID of the run to replay from the database")
	.option("--diff-apply-file <filename>", "The name of the diff apply file to use for the replay")
	.option("--save-locally", "Save results to local JSON files in addition to database", false)
	.option("-v, --verbose", "Enable verbose logging", false)
	.action(async (options) => {
		try {
			const fullOptions = {
				...options,
				validAttemptsPerCase: parseInt(options.validAttemptsPerCase, 10),
				thinkingBudget: parseInt(options.thinkingBudget, 10),
				maxCases: options.maxCases ? parseInt(options.maxCases, 10) : undefined,
			}
			await runDiffEvalHandler(fullOptions)
		} catch (error) {
			console.error(chalk.red(`Error during diff eval run: ${error instanceof Error ? error.message : String(error)}`))
			process.exit(1)
		}
	})

// Parse command line arguments
program.parse(process.argv)

// If no arguments provided, show help
if (process.argv.length === 2) {
	program.help()
}
