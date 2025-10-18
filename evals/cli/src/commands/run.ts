import { v4 as uuidv4 } from "uuid"
import chalk from "chalk"
import ora from "ora"
import { getAdapter } from "../adapters"
import { ResultsDatabase } from "../db"
import { runClineTask } from "../utils/cline-harness"
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

				let cleanedUp = false

				try {
					// Run Cline CLI task with retry mechanism
					console.log(`Running task with Cline CLI... Task ID: ${preparedTask.id}`)

					// Create test file manager callbacks
					const testFileManager = {
						hide: () => {
							if (adapter.hideTestFiles) {
								console.log(chalk.blue("Hiding test files..."))
								adapter.hideTestFiles(preparedTask)
							}
						},
						restore: () => {
							if (adapter.restoreTestFiles) {
								console.log(chalk.blue("Restoring test files..."))
								adapter.restoreTestFiles(preparedTask)
							}
						},
					}

					// Create verify function callback
					const verifyFn = async () => {
						return await adapter.verifyResult(preparedTask, {})
					}

					// Run task with new interface
					const { exitCode, duration, attempts, finalVerification } = await runClineTask({
						workingDirectory: preparedTask.workspacePath,
						initialTask: preparedTask.description,
						solutionFiles: preparedTask.metadata.solutionFiles || [],
						testFileManager,
						verifyFn,
					})

					// Create a result object
					const result = {
						exitCode,
						duration,
						attempts,
						completed: exitCode === 0,
					}

					// Cleanup task
					const cleanupSpinner = ora("Cleaning up task...").start()
					await adapter.cleanupTask(preparedTask)
					cleanedUp = true
					cleanupSpinner.succeed("Cleanup complete")

					// Use final verification from runClineTask
					const verification = finalVerification || (await adapter.verifyResult(preparedTask, result))

					if (verification.success) {
						console.log(
							chalk.green(
								`Tests passed: ${verification.metrics.testsPassed}/${verification.metrics.testsTotal} (${attempts} attempt${attempts > 1 ? "s" : ""})`,
							),
						)
					} else {
						console.log(
							chalk.red(
								`Tests failed: ${verification.metrics.testsPassed}/${verification.metrics.testsTotal} (${attempts} attempt${attempts > 1 ? "s" : ""})`,
							),
						)
					}

					// Store result
					const storeSpinner = ora("Storing result...").start()
					await storeTaskResult(runId, preparedTask, result, verification)
					storeSpinner.succeed("Result stored")

					console.log(chalk.green(`Task completed. Success: ${verification.success}`))
				} catch (error: any) {
					console.error(chalk.red(`Task failed: ${error.message}`))
					console.error(chalk.red(error.stack))
				} finally {
					// Ensure cleanup always happens
					if (!cleanedUp) {
						try {
							const finalCleanupSpinner = ora("Performing cleanup...").start()
							await adapter.cleanupTask(preparedTask)
							finalCleanupSpinner.succeed("Cleanup complete")
						} catch (cleanupError: any) {
							console.error(chalk.red(`Cleanup failed: ${cleanupError.message}`))
						}
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
