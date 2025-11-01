import chalk from "chalk"
import execa from "execa"
import * as fs from "fs"
import * as path from "path"
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

			// Unskip all JavaScript and Java tests after cloning
			this.unskipAllJavaScriptTests(exercismDir)
			this.unskipAllJavaTests(exercismDir)
		} else {
			console.log(`Exercism repository already exists at ${exercismDir}`)

			// Pull latest changes
			console.log("Pulling latest changes...")
			await execa("git", ["pull"], { cwd: exercismDir })
			console.log("Repository updated successfully")

			// Unskip tests again after pulling
			this.unskipAllJavaScriptTests(exercismDir)
			this.unskipAllJavaTests(exercismDir)
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
						testCommands = ["npm install", "npm test -- --testNamePattern=."]
						break
					case "python":
						testCommands = ["python3 -m pytest -o markers=task *_test.py"]
						break
					case "go":
						testCommands = ["GOWORK=off go test -v"]
						break
					case "java":
						testCommands = ["./gradlew test"]
						break
					case "rust":
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
		const solutionFiles = config.files.solution || []
		const fileList = solutionFiles.join(", ")
		description += `\n\nUse the above instructions to modify the supplied files: ${fileList}. Don't change the names of existing functions or classes, as they may be referenced from other code like unit tests, etc. Only use standard libraries, don't suggest installing any packages.`
		description +=
			" You should ignore all test or test related files in this directory. The final test file has been removed and will be used to evaluate your work after your implementation is complete. Think deeply about the problem prior to working on the implementation. Consider all edge cases and test your solution prior to finalizing."

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

		return {
			...task,
			description,
			metadata: {
				...task.metadata,
				solutionFiles,
				tempDir,
				config,
			},
		}
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
				// Only move if destination doesn't exist (keeps newer test artifacts like .pytest_cache)
				if (!fs.existsSync(dest)) {
					fs.renameSync(src, dest)
				}
			})

			// Clean up temp directory
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	}

	/**
	 * Verify the result of a task execution by running tests
	 * @param task The task that was executed
	 */
	async verifyResult(task: Task): Promise<VerificationResult> {
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

		// Log the raw output
		// console.log("\n=== TEST OUTPUT START ===")
		// console.log(output)
		// console.log("=== TEST OUTPUT END ===\n")

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
				const jestMatch = output.match(/Tests:\s+(?:\d+ skipped,\s+)?(\d+) passed(?:,\s+(\d+) failed)?/)
				if (jestMatch) {
					testsPassed = parseInt(jestMatch[1])
					testsFailed = jestMatch[2] ? parseInt(jestMatch[2]) : 0
				} else {
					// Fallback to counting test suites
					testsPassed = (output.match(/PASS/g) || []).length
					testsFailed = (output.match(/FAIL/g) || []).length
				}
				break

			case "go":
				// This incorrectly counts the parent, but minor and doesn't affect final boolean metric
				testsPassed = (output.match(/--- PASS:/g) || []).length
				testsFailed = (output.match(/--- FAIL:/g) || []).length
				break

			case "rust":
				// Rust runs multiple test suites (unit, integration, doc tests)
				// Sum results across all test result lines
				const resultLines = output.match(/test result:.*?(\d+) passed; (\d+) failed/g)
				if (resultLines) {
					testsPassed = 0
					testsFailed = 0
					for (const line of resultLines) {
						const match = line.match(/(\d+) passed; (\d+) failed/)
						if (match) {
							testsPassed += parseInt(match[1])
							testsFailed += parseInt(match[2])
						}
					}
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
					testsFailed = cppFailedMatch ? parseInt(cppFailedMatch[1]) : totalTests - testsPassed
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
			rawOutput: output,
			metrics: {
				testsPassed,
				testsFailed,
				testsTotal,
				functionalCorrectness: testsTotal > 0 ? testsPassed / testsTotal : 0,
			},
		}
	}

	/**
	 * Hide test files by moving them to temp directory
	 * @param task The task to hide test files for
	 */
	private hideTestFiles(task: Task): void {
		const tempDir = task.metadata.tempDir
		const config = task.metadata.config

		if (config?.files?.test) {
			config.files.test.forEach((testFile: string) => {
				const src = path.join(task.workspacePath, testFile)
				if (fs.existsSync(src)) {
					const dest = path.join(tempDir, testFile)
					fs.mkdirSync(path.dirname(dest), { recursive: true })
					fs.renameSync(src, dest)
				}
			})
		}

		// Hide dot directories again (except .git)
		const items = fs.readdirSync(task.workspacePath)
		items.forEach((item) => {
			if (item.startsWith(".") && item !== ".git") {
				const src = path.join(task.workspacePath, item)
				if (fs.existsSync(src)) {
					const stat = fs.statSync(src)
					if (stat.isDirectory()) {
						const dest = path.join(tempDir, item)
						if (!fs.existsSync(dest)) {
							fs.renameSync(src, dest)
						}
					}
				}
			}
		})
	}

	/**
	 * Restore test files by moving them from temp directory
	 * @param task The task to restore test files for
	 */
	private restoreTestFiles(task: Task): void {
		const tempDir = task.metadata.tempDir
		const config = task.metadata.config

		if (config?.files?.test) {
			config.files.test.forEach((testFile: string) => {
				const src = path.join(tempDir, testFile)
				if (fs.existsSync(src)) {
					const dest = path.join(task.workspacePath, testFile)
					fs.mkdirSync(path.dirname(dest), { recursive: true })
					fs.renameSync(src, dest)
				}
			})
		}

		// Restore dot directories (except .git)
		if (fs.existsSync(tempDir)) {
			const items = fs.readdirSync(tempDir)
			items.forEach((item) => {
				if (item.startsWith(".") && item !== ".git") {
					const src = path.join(tempDir, item)
					const dest = path.join(task.workspacePath, item)
					if (fs.existsSync(src) && !fs.existsSync(dest)) {
						fs.renameSync(src, dest)
					}
				}
			})
		}
	}

	/**
	 * Builds retry message with test errors and fix instructions
	 * @param testOutput The raw test output showing errors
	 * @param solutionFiles List of solution files to fix
	 * @returns Formatted retry message
	 */
	private buildRetryMessage(testOutput: string, solutionFiles: string[]): string {
		const fileList = solutionFiles.join(", ")
		return `${testOutput}\n\nSee the testing errors above. The tests are correct, don't try and change them. Fix the code in ${fileList} to resolve the errors.`
	}

	/**
	 * Unskip all JavaScript tests in the repository by replacing xtest with test
	 * @param repoPath Path to the exercism repository
	 */
	private unskipAllJavaScriptTests(repoPath: string): void {
		const jsDir = path.join(repoPath, "javascript", "exercises", "practice")

		if (!fs.existsSync(jsDir)) {
			console.log("JavaScript exercises directory not found, skipping test unskipping")
			return
		}

		// Walk through all exercise directories
		const exercises = fs.readdirSync(jsDir).filter((dir) => {
			const fullPath = path.join(jsDir, dir)
			return fs.statSync(fullPath).isDirectory()
		})

		let filesModified = 0
		for (const exercise of exercises) {
			const exerciseDir = path.join(jsDir, exercise)

			// Find all .spec.js files
			const files = fs.readdirSync(exerciseDir).filter((file) => file.endsWith(".spec.js"))

			for (const file of files) {
				const filePath = path.join(exerciseDir, file)
				let content = fs.readFileSync(filePath, "utf-8")
				const originalContent = content

				// Replace xtest with test to unskip tests
				content = content.replace(/xtest\(/g, "test(")

				if (content !== originalContent) {
					fs.writeFileSync(filePath, content)
					filesModified++
				}
			}
		}

		console.log(`Unskipped tests in ${filesModified} JavaScript test files`)
	}

	/**
	 * Unskip all Java tests in the repository by removing @Disabled annotations
	 * @param repoPath Path to the exercism repository
	 */
	private unskipAllJavaTests(repoPath: string): void {
		const javaDir = path.join(repoPath, "java", "exercises", "practice")

		if (!fs.existsSync(javaDir)) {
			console.log("Java exercises directory not found, skipping test unskipping")
			return
		}

		// Walk through all exercise directories
		const exercises = fs.readdirSync(javaDir).filter((dir) => {
			const fullPath = path.join(javaDir, dir)
			return fs.statSync(fullPath).isDirectory()
		})

		let filesModified = 0
		for (const exercise of exercises) {
			const testDir = path.join(javaDir, exercise, "src", "test", "java")

			if (!fs.existsSync(testDir)) {
				continue
			}

			// Find all .java test files
			const files = fs.readdirSync(testDir).filter((file) => file.endsWith(".java"))

			for (const file of files) {
				const filePath = path.join(testDir, file)
				let content = fs.readFileSync(filePath, "utf-8")
				const originalContent = content

				// Remove @Disabled("Remove to run test") annotations
				content = content.replace(/@Disabled\("Remove to run test"\)\s*\n/g, "")

				if (content !== originalContent) {
					fs.writeFileSync(filePath, content)
					filesModified++
				}
			}
		}

		console.log(`Unskipped tests in ${filesModified} Java test files`)
	}

	/**
	 * Runs a Cline task with automatic retry on test failure
	 * Creates a new Cline instance, runs the task, verifies with tests,
	 * and retries once if tests fail
	 * @param task The task to execute
	 * @returns The final verification result, or null
	 */
	async runTask(task: Task): Promise<VerificationResult | null> {
		const startTime = Date.now()
		let instanceAddress: string | null = null
		let attempts = 0
		let finalVerification: VerificationResult | null = null

		try {
			// Step 1: Start a new Cline instance in the working directory
			const instanceResult = await execa("cline", ["instance", "new"], {
				cwd: task.workspacePath,
				stdin: "ignore",
			})

			// Step 2: Parse the instance address from output
			const addressMatch = instanceResult.stdout.match(/Address:\s*([\d.]+:\d+)/)
			if (!addressMatch) {
				throw new Error("Failed to parse instance address from output")
			}
			instanceAddress = addressMatch[1]

			// Step 3: Create the initial task on this specific instance
			await execa("cline", ["task", "new", "--yolo", "--address", instanceAddress, task.description], {
				cwd: task.workspacePath,
				stdin: "ignore",
			})

			// Step 4: Wait for initial implementation to complete
			console.log(chalk.blue(`Waiting for first attempt to complete...`))
			await execa("cline", ["task", "view", "--follow-complete", "--address", instanceAddress], {
				cwd: task.workspacePath,
				stdin: "ignore",
			})

			// Step 5: Run first test attempt
			console.log(chalk.blue(`Running tests (attempt 1)...`))
			this.restoreTestFiles(task)
			attempts = 1
			const firstVerification = await this.verifyResult(task)
			finalVerification = firstVerification

			// Step 6: Retry if tests failed
			if (!firstVerification.success) {
				console.log(chalk.blue(`Tests failed on first attempt. Retrying...`))

				// Hide test files again for retry
				this.hideTestFiles(task)

				attempts = 2
				const solutionFiles = task.metadata.solutionFiles || []
				const retryMessage = this.buildRetryMessage(firstVerification.rawOutput || "", solutionFiles)

				// Send retry task message
				await execa("cline", ["task", "send", "--yolo", "--address", instanceAddress], {
					cwd: task.workspacePath,
					input: retryMessage,
				})

				// Follow retry until complete
				await execa("cline", ["task", "view", "--follow-complete", "--address", instanceAddress], {
					cwd: task.workspacePath,
					stdin: "ignore",
				})

				// Run second test attempt (final)
				console.log(chalk.blue(`Running tests (attempt 2)...`))
				this.restoreTestFiles(task)
				const secondVerification = await this.verifyResult(task)
				finalVerification = secondVerification
			}

			const duration = Date.now() - startTime
			console.log(
				chalk.green(
					`Task completed in ${(duration / 1000).toFixed(1)}s after ${attempts} attempt${attempts > 1 ? "s" : ""}`,
				),
			)

			return finalVerification
		} catch (error: any) {
			const duration = Date.now() - startTime
			console.error(chalk.red(`Task failed after ${(duration / 1000).toFixed(1)}s: ${error.message}`))

			return finalVerification
		} finally {
			// Step 7: Always clean up the instance, even if task failed
			if (instanceAddress) {
				try {
					await execa("cline", ["instance", "kill", instanceAddress], {
						stdin: "ignore",
					})
				} catch (cleanupError: any) {
					console.error(chalk.yellow(`Warning: Failed to kill instance ${instanceAddress}: ${cleanupError.message}`))
				}
			}
		}
	}
}
