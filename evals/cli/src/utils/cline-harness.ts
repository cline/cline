import execa from "execa"
import chalk from "chalk"

export interface ClineInstanceResult {
	exitCode: number
	duration: number
}

/**
 * Runs a Cline task and waits for completion
 * Creates a new Cline instance in the working directory, runs the task, and cleans up
 * @param workingDirectory The directory to run the task in (becomes the instance workspace)
 * @param task The task description
 * @returns Exit code and duration
 */
export async function runClineTask(
	workingDirectory: string,
	task: string,
): Promise<ClineInstanceResult> {
	const startTime = Date.now()
	let instanceAddress: string | null = null

	try {
		// Step 1: Start a new Cline instance in the working directory
		console.log(chalk.blue(`Starting new Cline instance in ${workingDirectory}...`))
		const instanceResult = await execa("cline", ["instance", "new"], {
			cwd: workingDirectory,
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

		// Step 3: Create the task on this specific instance
		console.log(chalk.blue(`Creating task on instance ${instanceAddress}...`))
		await execa("cline", ["task", "new", "--yolo", "--address", instanceAddress, task], {
			cwd: workingDirectory,
			stdin: "ignore",
		})

		// Step 4: Wait for completion on this specific instance
		console.log(chalk.blue(`Waiting for task completion...`))
		await execa("cline", ["task", "view", "--follow-complete", "--address", instanceAddress], {
			cwd: workingDirectory,
			stdin: "ignore",
		})

		const duration = Date.now() - startTime
		console.log(chalk.green(`Task completed successfully in ${(duration / 1000).toFixed(1)}s`))

		return {
			exitCode: 0,
			duration,
		}
	} catch (error: any) {
		const duration = Date.now() - startTime
		console.error(chalk.red(`Task failed after ${(duration / 1000).toFixed(1)}s: ${error.message}`))

		return {
			exitCode: error.exitCode || 1,
			duration,
		}
	} finally {
		// Step 5: Always clean up the instance, even if task failed
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
