import * as path from "path"
import * as fs from "fs"
import execa from "execa"
import chalk from "chalk"
import ora from "ora"
import { getAllAdapters } from "../adapters/index"
import { BenchmarkAdapter } from "../adapters/types"

interface SetupOptions {
	benchmarks: string
}

/**
 * Handler for the setup command
 * @param options Command options
 */
export async function setupHandler(options: SetupOptions): Promise<void> {
	const benchmarks = options.benchmarks.split(",")

	console.log(chalk.blue(`Setting up benchmarks: ${benchmarks.join(", ")}`))

	// Create directories
	const evalsDir = path.resolve(__dirname, "../../../")
	const reposDir = path.join(evalsDir, "repositories")
	const resultsDir = path.join(evalsDir, "results")

	const spinner = ora("Creating directory structure").start()

	try {
		fs.mkdirSync(reposDir, { recursive: true })
		fs.mkdirSync(resultsDir, { recursive: true })
		fs.mkdirSync(path.join(resultsDir, "runs"), { recursive: true })
		fs.mkdirSync(path.join(resultsDir, "reports"), { recursive: true })
		spinner.succeed("Directory structure created")
	} catch (error) {
		spinner.fail(`Failed to create directory structure: ${(error as Error).message}`)
		throw error
	}

	// Set up each benchmark
	try {
		const adapters = getAllAdapters().filter((adapter: BenchmarkAdapter) => benchmarks.includes(adapter.name))

		if (adapters.length === 0) {
			console.warn(chalk.yellow("No valid benchmarks specified. Available benchmarks:"))
			console.warn(
				chalk.yellow(
					getAllAdapters()
						.map((a: BenchmarkAdapter) => a.name)
						.join(", "),
				),
			)
			return
		}

		for (const adapter of adapters) {
			const setupSpinner = ora(`Setting up ${adapter.name}...`).start()
			try {
				await adapter.setup()
				setupSpinner.succeed(`${adapter.name} setup complete`)
			} catch (error) {
				setupSpinner.fail(`Failed to set up ${adapter.name}: ${(error as Error).message}`)
				throw error
			}
		}

		console.log(chalk.green("Setup complete"))
	} catch (error) {
		console.error(chalk.red(`Setup failed: ${(error as Error).message}`))
		throw error
	}
}
