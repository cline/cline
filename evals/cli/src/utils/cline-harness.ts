import execa from "execa"
import chalk from "chalk"
import { VerificationResult } from "../adapters/types"

export interface ClineInstanceResult {
	exitCode: number
	duration: number
	attempts: number
	finalVerification: VerificationResult | null
}

export interface ClineTaskOptions {
	workingDirectory: string
	initialTask: string
	solutionFiles: string[]
	testFileManager: {
		hide: () => void
		restore: () => void
	}
	verifyFn: () => Promise<VerificationResult>
}

/**
 * Builds retry message with test errors and fix instructions
 * @param testOutput The raw test output showing errors
 * @param solutionFiles List of solution files to fix
 * @returns Formatted retry message
 */
function buildRetryMessage(testOutput: string, solutionFiles: string[]): string {
	const fileList = solutionFiles.join(", ")
	return `${testOutput}\n\nSee the testing errors above. The tests are correct, don't try and change them. Fix the code in ${fileList} to resolve the errors.`
}

/**
 * Runs a Cline task with automatic retry on test failure
 * Creates a new Cline instance in the working directory, runs the task, verifies with tests,
 * and optionally retries once if tests fail
 * @param options Task options including verify function and test file management
 * @returns Exit code, duration, attempts, and final verification result
 */
export async function runClineTask(options: ClineTaskOptions): Promise<ClineInstanceResult> {
	const startTime = Date.now()
	let instanceAddress: string | null = null
	let attempts = 0
	let finalVerification: VerificationResult | null = null

	try {
		// Step 1: Start a new Cline instance in the working directory
		console.log(chalk.blue(`Starting new Cline instance in ${options.workingDirectory}`))
		const instanceResult = await execa("cline", ["instance", "new"], {
			cwd: options.workingDirectory,
			stdin: "ignore",
		})

		// Step 2: Parse the instance address from output
		// Output format: "Address: 127.0.0.1:50430"
		const addressMatch = instanceResult.stdout.match(/Address:\s*([\d.]+:\d+)/)
		if (!addressMatch) {
			throw new Error("Failed to parse instance address from output")
		}
		instanceAddress = addressMatch[1]
		console.log(chalk.blue(`Instance started: ${instanceAddress}`))

		// Step 3: Create the initial task on this specific instance
		console.log(chalk.blue(`Creating task using instance ${instanceAddress}`))
		await execa("cline", ["task", "new", "--yolo", "--address", instanceAddress, options.initialTask], {
			cwd: options.workingDirectory,
			stdin: "ignore",
		})

		// Step 4: Wait for initial implementation to complete
		console.log(chalk.blue(`Waiting for initial implementation to complete...`))
		await execa("cline", ["task", "view", "--follow-complete", "--address", instanceAddress], {
			cwd: options.workingDirectory,
			stdin: "ignore",
		})

		// Step 5: Run first test attempt
		console.log(chalk.blue(`Running tests (attempt 1)...`))
		options.testFileManager.restore()
		attempts = 1
		const firstVerification = await options.verifyFn()
		finalVerification = firstVerification

		// Step 6: Retry if tests failed
		if (!firstVerification.success && attempts < 2) {
			console.log(chalk.yellow(`Tests failed on first attempt. Preparing retry...`))

			// Hide test files again for retry
			options.testFileManager.hide()

			attempts = 2
			const retryMessage = buildRetryMessage(firstVerification.rawOutput || "", options.solutionFiles)

			// Send retry task
			console.log(chalk.blue(`Sending retry task to instance ${instanceAddress}...`))
			await execa("cline", ["task", "send", "--yolo", "--address", instanceAddress, retryMessage], {
				cwd: options.workingDirectory,
				stdin: "ignore",
			})

			// Follow retry until complete
			console.log(chalk.blue(`Waiting for retry implementation to complete...`))
			await execa("cline", ["task", "view", "--follow-complete", "--address", instanceAddress], {
				cwd: options.workingDirectory,
				stdin: "ignore",
			})

			// Run second test attempt (FINAL)
			console.log(chalk.blue(`Running tests (attempt 2)...`))
			options.testFileManager.restore()
			const secondVerification = await options.verifyFn()
			finalVerification = secondVerification
		}

		const duration = Date.now() - startTime
		console.log(
			chalk.green(
				`Task completed in ${(duration / 1000).toFixed(1)}s after ${attempts} attempt${attempts > 1 ? "s" : ""}`,
			),
		)

		return {
			exitCode: 0,
			duration,
			attempts,
			finalVerification,
		}
	} catch (error: any) {
		const duration = Date.now() - startTime
		console.error(chalk.red(`Task failed after ${(duration / 1000).toFixed(1)}s: ${error.message}`))

		return {
			exitCode: error.exitCode || 1,
			duration,
			attempts: attempts || 0,
			finalVerification,
		}
	} finally {
		// Step 7: Always clean up the instance, even if task failed
		if (instanceAddress) {
			try {
				console.log(chalk.blue(`Cleaning up instance ${instanceAddress}...`))
				await execa("cline", ["instance", "kill", instanceAddress], {
					stdin: "ignore",
				})
				console.log(chalk.blue(`Instance ${instanceAddress} cleaned up`))
			} catch (cleanupError: any) {
				console.error(chalk.yellow(`Warning: Failed to kill instance ${instanceAddress}: ${cleanupError.message}`))
			}
		}
	}
}
