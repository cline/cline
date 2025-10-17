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
			await execa("git", ["clone", "https://github.com/Aider-AI/polyglot-benchmark.git", exercismDir])
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
			.filter((dir) => dir === "python")

		for (const language of languages) {
			const languageDir = path.join(exercisesDir, language, "exercises", "practice")

			// Read exercise directories
			const exercises = fs.readdirSync(languageDir).filter((dir) => fs.statSync(path.join(languageDir, dir)).isDirectory())

			for (const exercise of exercises) {
				const exerciseDir = path.join(languageDir, exercise)

				// Read instructions
				let description = ""
				const instructionsPath = path.join(exerciseDir, ".docs", "instructions.md")
				if (fs.existsSync(instructionsPath)) {
					description = fs.readFileSync(instructionsPath, "utf-8")
				}

				// Determine test commands based on language
				let testCommands: string[] = []
				switch (language) {
					case "cpp":
						testCommands = ["cmake -DEXERCISM_RUN_ALL_TESTS=1 .", "make"]
						break
					case "javascript":
						// Run all tests including those marked with xtest (skipped)
						testCommands = ["npm install", "npm test -- --testNamePattern=."]
						break
				case "python":
					testCommands = ["python3 -m pytest -o markers=task *_test.py"]
					break
					case "go":
						// Go runs all tests by default, use -v for verbose output with subtest details
						testCommands = ["go test -v"]
						break
					case "java":
						// Remove @Disabled annotations is not possible via command, tests run as-is
						testCommands = ["./gradlew test"]
						break
					case "rust":
						// Run all tests including ignored ones
						testCommands = ["cargo test -- --include-ignored"]
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

		// Create temp directory outside workspace for hiding files
		const tempDir = path.join(EVALS_DIR, "temp-files", task.id)
		fs.mkdirSync(tempDir, { recursive: true })

		// Read config.json to get solution and test files
		const configPath = path.join(task.workspacePath, ".meta", "config.json")
		let config: any = { files: { solution: [], test: [] } }
		
		if (fs.existsSync(configPath)) {
			config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
		}

		// Build enhanced description with instructions
		let description = ""
		const instructionsPath = path.join(task.workspacePath, ".docs", "instructions.md")
		const appendPath = path.join(task.workspacePath, ".docs", "instructions.append.md")

		if (fs.existsSync(instructionsPath)) {
			description = fs.readFileSync(instructionsPath, "utf-8")
		}

		if (fs.existsSync(appendPath)) {
			description += "\n\n" + fs.readFileSync(appendPath, "utf-8")
		}

		// Add solution files constraint to description
		if (config.files.solution && config.files.solution.length > 0) {
			description += "\n\n## Files to Implement\n"
			description += "You must implement the function stubs in the following files:\n"
			config.files.solution.forEach((file: string) => {
				description += `- ${file}\n`
			})
		}

		description += "\n\n## Additional instructions\n"
		description += "You should ignore all test or test related files in this directory. The test file itself has been removed and will be used to evaluate your work after your implementation is complete.\n"
		description += "Think deeply about the problem prior to working on the implementation. Consider all edge cases and test your solution prior to finalizing."

		// Move test files to temp directory
		if (config.files.test) {
			config.files.test.forEach((testFile: string) => {
				const src = path.join(task.workspacePath, testFile)
				if (fs.existsSync(src)) {
					const dest = path.join(tempDir, testFile)
					fs.mkdirSync(path.dirname(dest), { recursive: true })
					fs.renameSync(src, dest)
				}
			})
		}

		// Move all dot directories (except .git) to temp directory
		const items = fs.readdirSync(task.workspacePath)
		items.forEach((item) => {
			if (item.startsWith(".") && item !== ".git") {
				const src = path.join(task.workspacePath, item)
				const stat = fs.statSync(src)
				if (stat.isDirectory()) {
					const dest = path.join(tempDir, item)
					fs.renameSync(src, dest)
				}
			}
		})

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

		return { ...task, description }
	}

	/**
	 * Cleanup after task execution (restores hidden files from temp directory)
	 * @param task The task that was executed
	 */
	async cleanupTask(task: Task): Promise<void> {
		const tempDir = path.join(EVALS_DIR, "temp-files", task.id)

		if (fs.existsSync(tempDir)) {
			const items = fs.readdirSync(tempDir)
			items.forEach((item) => {
				const src = path.join(tempDir, item)
				const dest = path.join(task.workspacePath, item)
				fs.renameSync(src, dest)
			})

			// Clean up temp directory
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	}

	/**
	 * Verify the result of a task execution by running tests
	 * @param task The task that was executed
	 * @param result The result of the task execution
	 */
	async verifyResult(task: Task, result: any): Promise<VerificationResult> {
		// Run verification commands
		let success = true
		let output = ""

		for (const command of task.verificationCommands) {
			try {
				const { stdout, stderr } = await execa(command, {
					cwd: task.workspacePath,
					shell: true,
				})
				output += stdout + "\n"
				if (stderr) {
					output += stderr + "\n"
				}
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

		// Log the raw output for debugging
		console.log("\n=== TEST OUTPUT START ===")
		console.log(output)
		console.log("=== TEST OUTPUT END ===\n")

		// Parse test results based on language
		const language = task.metadata.language
		let testsPassed = 0
		let testsFailed = 0

		switch (language) {
			case "python":
				const pyPassMatch = output.match(/(\d+) passed/)
				const pyFailMatch = output.match(/(\d+) failed/)
				testsPassed = pyPassMatch ? parseInt(pyPassMatch[1]) : 0
				testsFailed = pyFailMatch ? parseInt(pyFailMatch[1]) : 0
				break

			case "javascript":
				testsPassed = (output.match(/PASS/g) || []).length
				testsFailed = (output.match(/FAIL/g) || []).length
				break

			case "go":
				testsPassed = (output.match(/--- PASS:/g) || []).length
				testsFailed = (output.match(/--- FAIL:/g) || []).length
				break

			case "rust":
				const rustMatch = output.match(/(\d+) passed; (\d+) failed/)
				if (rustMatch) {
					testsPassed = parseInt(rustMatch[1])
					testsFailed = parseInt(rustMatch[2])
				}
				break

			case "java":
				testsPassed = (output.match(/PASSED/g) || []).length
				testsFailed = (output.match(/FAILED/g) || []).length
				break

			case "cpp":
				const cppAllPassedMatch = output.match(/All tests passed \(.*?(\d+) test cases?\)/)
				const cppTestCasesMatch = output.match(/test cases?: (\d+) \| (\d+) passed/)
				const cppFailedMatch = output.match(/(\d+) failed/)
				
				if (cppAllPassedMatch) {
					// All tests passed - extract total test cases
					testsPassed = parseInt(cppAllPassedMatch[1])
					testsFailed = 0
				} else if (cppTestCasesMatch) {
					// Mixed results - extract passed count and calculate failed
					const totalTests = parseInt(cppTestCasesMatch[1])
					testsPassed = parseInt(cppTestCasesMatch[2])
					testsFailed = cppFailedMatch ? parseInt(cppFailedMatch[1]) : (totalTests - testsPassed)
				}
				break

			default:
				// Fallback to generic PASS/FAIL counting
				testsPassed = (output.match(/PASS/g) || []).length
				testsFailed = (output.match(/FAIL/g) || []).length
		}

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
