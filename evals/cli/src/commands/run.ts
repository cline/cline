import * as path from "path"
import { v4 as uuidv4 } from "uuid"
import chalk from "chalk"
import ora from "ora"
import { getAdapter } from "../adapters"
import { ResultsDatabase } from "../db"
import { spawnVSCode, cleanupVSCode } from "../utils/vscode"
import { sendTaskToServer } from "../utils/task"
import { storeTaskResult } from "../utils/results"

interface RunOptions {
	benchmark?: string
	model: string
	count?: number
	apiKey?: string
}

/**
 * Handler for the run command
 * @param options Command options
 */
export async function runHandler(options: RunOptions): Promise<void> {
	// Determine which benchmarks to run
	const benchmarks = options.benchmark ? [options.benchmark] : ["exercism"] // Default to exercism for now
	const model = options.model
	const count = options.count || Infinity

	console.log(chalk.blue(`Running evaluations for model: ${model}`))
	console.log(chalk.blue(`Benchmarks: ${benchmarks.join(", ")}`))

	// Create a run for each benchmark
	for (const benchmark of benchmarks) {
		const runId = uuidv4()
		const db = new ResultsDatabase()

		console.log(chalk.green(`\nStarting run for benchmark: ${benchmark}`))

		// Create run in database
		db.createRun(runId, model, benchmark)

		// Get adapter for this benchmark
		try {
			const adapter = getAdapter(benchmark)

			// List tasks
			const spinner = ora("Listing tasks...").start()
			const tasks = await adapter.listTasks()
			spinner.succeed(`Found ${tasks.length} tasks for ${benchmark}`)

			// Limit number of tasks if specified
			const tasksToRun = tasks.slice(0, count)

			console.log(chalk.blue(`Running ${tasksToRun.length} tasks...`))

			// Run each task
			for (let i = 0; i < tasksToRun.length; i++) {
				const task = tasksToRun[i]

				console.log(chalk.cyan(`\nTask ${i + 1}/${tasksToRun.length}: ${task.name}`))

				// Prepare task
				const prepareSpinner = ora("Preparing task...").start()
				const preparedTask = await adapter.prepareTask(task.id)
				prepareSpinner.succeed("Task prepared")

				// Spawn VSCode
				console.log("Spawning VSCode...")
				await spawnVSCode(preparedTask.workspacePath)

				// Send task to server
				const sendSpinner = ora("Sending task to server...").start()
				try {
					const result = await sendTaskToServer(preparedTask.description, options.apiKey)
					sendSpinner.succeed("Task completed")

					// Verify result
					const verifySpinner = ora("Verifying result...").start()
					const verification = await adapter.verifyResult(preparedTask, result)

					if (verification.success) {
						verifySpinner.succeed(
							`Verification successful: ${verification.metrics.testsPassed}/${verification.metrics.testsTotal} tests passed`,
						)
					} else {
						verifySpinner.fail(
							`Verification failed: ${verification.metrics.testsPassed}/${verification.metrics.testsTotal} tests passed`,
						)
					}

					// Store result
					const storeSpinner = ora("Storing result...").start()
					await storeTaskResult(runId, preparedTask, result, verification)
					storeSpinner.succeed("Result stored")

					console.log(chalk.green(`Task completed. Success: ${verification.success}`))

					// Clean up VS Code and temporary files
					const cleanupSpinner = ora("Cleaning up...").start()
					try {
						await cleanupVSCode(preparedTask.workspacePath)
						cleanupSpinner.succeed("Cleanup completed")
					} catch (cleanupError: any) {
						cleanupSpinner.fail(`Cleanup failed: ${cleanupError.message}`)
						console.error(chalk.yellow(cleanupError.stack))
					}
				} catch (error: any) {
					sendSpinner.fail(`Task failed: ${error.message}`)
					console.error(chalk.red(error.stack))

					// Clean up VS Code and temporary files even if the task failed
					const cleanupSpinner = ora("Cleaning up...").start()
					try {
						await cleanupVSCode(preparedTask.workspacePath)
						cleanupSpinner.succeed("Cleanup completed")
					} catch (cleanupError: any) {
						cleanupSpinner.fail(`Cleanup failed: ${cleanupError.message}`)
						console.error(chalk.yellow(cleanupError.stack))
					}
				}
			}

			// Mark run as complete
			db.completeRun(runId)

			console.log(chalk.green(`\nRun complete for benchmark: ${benchmark}`))
		} catch (error: any) {
			console.error(chalk.red(`Error running benchmark ${benchmark}: ${error.message}`))
			console.error(error.stack)
		}
	}

	console.log(chalk.green("\nAll evaluations complete"))
}
