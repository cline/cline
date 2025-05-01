import * as path from "path"
import * as fs from "fs"
import execa from "execa"
import { BenchmarkAdapter, Task, VerificationResult } from "./types"

const EVALS_DIR = path.resolve(__dirname, "../../../")

/**
 * Adapter for the modified Exercism benchmark
 */
export class ExercismAdapter implements BenchmarkAdapter {
	name = "exercism"

	/**
	 * Set up the Exercism benchmark repository
	 */
	async setup(): Promise<void> {
		// Clone repository if needed
		const exercismDir = path.join(EVALS_DIR, "repositories", "exercism")

		if (!fs.existsSync(exercismDir)) {
			console.log(`Cloning Exercism repository to ${exercismDir}...`)
			await execa("git", ["clone", "https://github.com/pashpashpash/evals.git", exercismDir])
			console.log("Exercism repository cloned successfully")
		} else {
			console.log(`Exercism repository already exists at ${exercismDir}`)

			// Pull latest changes
			console.log("Pulling latest changes...")
			await execa("git", ["pull"], { cwd: exercismDir })
			console.log("Repository updated successfully")
		}
	}

	/**
	 * List all available tasks in the Exercism benchmark
	 */
	async listTasks(): Promise<Task[]> {
		const tasks: Task[] = []
		const exercisesDir = path.join(EVALS_DIR, "repositories", "exercism")

		// Ensure the repository exists
		if (!fs.existsSync(exercisesDir)) {
			throw new Error(`Exercism repository not found at ${exercisesDir}. Run setup first.`)
		}

		// Read language directories
		const languages = fs
			.readdirSync(exercisesDir)
			.filter((dir) => fs.statSync(path.join(exercisesDir, dir)).isDirectory())
			.filter((dir) => !dir.startsWith(".") && !["node_modules", ".git"].includes(dir))

		for (const language of languages) {
			const languageDir = path.join(exercisesDir, language)

			// Read exercise directories
			const exercises = fs.readdirSync(languageDir).filter((dir) => fs.statSync(path.join(languageDir, dir)).isDirectory())

			for (const exercise of exercises) {
				const exerciseDir = path.join(languageDir, exercise)

				// Read instructions
				let description = ""
				const instructionsPath = path.join(exerciseDir, "docs", "instructions.md")
				if (fs.existsSync(instructionsPath)) {
					description = fs.readFileSync(instructionsPath, "utf-8")
				}

				// Determine test commands based on language
				let testCommands: string[] = []
				switch (language) {
					case "javascript":
						testCommands = ["npm install", "npm test"]
						break
					case "python":
						testCommands = ["python -m pytest -o markers=task *_test.py"]
						break
					case "go":
						testCommands = ["go test"]
						break
					case "java":
						testCommands = ["./gradlew test"]
						break
					case "rust":
						testCommands = ["cargo test"]
						break
					default:
						testCommands = []
				}

				tasks.push({
					id: `exercism-${language}-${exercise}`,
					name: exercise,
					description,
					workspacePath: exerciseDir,
					setupCommands: [],
					verificationCommands: testCommands,
					metadata: {
						language,
						type: "exercism",
					},
				})
			}
		}

		return tasks
	}

	/**
	 * Prepare a specific task for execution
	 * @param taskId The ID of the task to prepare
	 */
	async prepareTask(taskId: string): Promise<Task> {
		const tasks = await this.listTasks()
		const task = tasks.find((t) => t.id === taskId)

		if (!task) {
			throw new Error(`Task ${taskId} not found`)
		}

		// Check if Git repository is already initialized
		const gitDirExists = fs.existsSync(path.join(task.workspacePath, ".git"))

		try {
			// Initialize Git repository if needed
			if (!gitDirExists) {
				await execa("git", ["init"], { cwd: task.workspacePath })
			}

			// Create a dummy file to ensure there's something to commit
			const dummyFilePath = path.join(task.workspacePath, ".eval-timestamp")
			fs.writeFileSync(dummyFilePath, new Date().toISOString())

			// Add all files and commit
			await execa("git", ["add", "."], { cwd: task.workspacePath })

			try {
				await execa("git", ["commit", "-m", "Initial commit"], { cwd: task.workspacePath })
			} catch (error: any) {
				// If commit fails because there are no changes, that's okay
				if (!error.stderr?.includes("nothing to commit")) {
					throw error
				}
			}
		} catch (error: any) {
			console.warn(`Warning: Git operations failed: ${error.message}`)
			console.warn("Continuing without Git initialization")
		}

		return task
	}

	/**
	 * Verify the result of a task execution
	 * @param task The task that was executed
	 * @param result The result of the task execution
	 */
	async verifyResult(task: Task, result: any): Promise<VerificationResult> {
		// Run verification commands
		let success = true
		let output = ""

		for (const command of task.verificationCommands) {
			try {
				const [cmd, ...args] = command.split(" ")
				const { stdout } = await execa(cmd, args, { cwd: task.workspacePath })
				output += stdout + "\n"
			} catch (error: any) {
				success = false
				if (error.stdout) {
					output += error.stdout + "\n"
				}
				if (error.stderr) {
					output += error.stderr + "\n"
				}
			}
		}

		// Parse test results
		const testsPassed = (output.match(/PASS/g) || []).length
		const testsFailed = (output.match(/FAIL/g) || []).length
		const testsTotal = testsPassed + testsFailed

		return {
			success,
			metrics: {
				testsPassed,
				testsFailed,
				testsTotal,
				functionalCorrectness: testsTotal > 0 ? testsPassed / testsTotal : 0,
			},
		}
	}
}
