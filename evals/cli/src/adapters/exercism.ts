import * as path from "path"
import * as fs from "fs"
import execa from "execa"
import { BenchmarkAdapter, Task, VerificationResult } from "./types"

// Interface for test output parsers following the Strategy pattern
interface TestOutputParser {
	parse(output: string): TestResult
}

// Standard test result structure
interface TestResult {
	testsPassed: number
	testsFailed: number
	testsTotal: number
}


class PytestOutputParser implements TestOutputParser {
	parse(output: string): TestResult {
		let testsPassed = 0
		let testsFailed = 0
		
		// Look for pytest summary line like "1 failed, 2 passed in 0.12s" or "3 passed in 0.05s"
		const summaryMatch = output.match(/(\d+)\s+failed.*?(\d+)\s+passed|(\d+)\s+passed.*?(\d+)\s+failed|(\d+)\s+passed(?!\s+\d+\s+failed)|(\d+)\s+failed(?!\s+\d+\s+passed)/);
		
		if (summaryMatch) {
			if (summaryMatch[1] && summaryMatch[2]) {
				// "X failed, Y passed"
				testsFailed = parseInt(summaryMatch[1])
				testsPassed = parseInt(summaryMatch[2])
			} else if (summaryMatch[3] && summaryMatch[4]) {
				// "X passed, Y failed"
				testsPassed = parseInt(summaryMatch[3])
				testsFailed = parseInt(summaryMatch[4])
			} else if (summaryMatch[5]) {
				// "X passed" (no failures)
				testsPassed = parseInt(summaryMatch[5])
				testsFailed = 0
			} else if (summaryMatch[6]) {
				// "X failed" (no passes)
				testsFailed = parseInt(summaryMatch[6])
				testsPassed = 0
			}
		} else {
			// Alternative parsing: count individual test results
			// Look for lines like "test_file.py::test_function PASSED" or "test_file.py::test_function FAILED"
			const passedMatches = output.match(/::.*?\s+PASSED/g) || []
			const failedMatches = output.match(/::.*?\s+FAILED/g) || []
			testsPassed = passedMatches.length
			testsFailed = failedMatches.length
		}
		
		const testsTotal = testsPassed + testsFailed
		
		return { testsPassed, testsFailed, testsTotal }
	}
}


class JestOutputParser implements TestOutputParser {
	parse(output: string): TestResult {
		let testsPassed = 0
		let testsFailed = 0
		
		// Look for Jest summary like "Tests: 1 failed, 2 passed, 3 total"
		const summaryMatch = output.match(/Tests:\s*(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/);
		
		if (summaryMatch) {
			testsFailed = summaryMatch[1] ? parseInt(summaryMatch[1]) : 0
			testsPassed = summaryMatch[2] ? parseInt(summaryMatch[2]) : 0
		} else {
			// Alternative: look for individual test results
			const passedMatches = output.match(/✓|PASS/g) || []
			const failedMatches = output.match(/✗|FAIL/g) || []
			testsPassed = passedMatches.length
			testsFailed = failedMatches.length
		}
		
		const testsTotal = testsPassed + testsFailed
		
		return { testsPassed, testsFailed, testsTotal }
	}
}


class GoTestOutputParser implements TestOutputParser {
	parse(output: string): TestResult {
		// Count PASS and FAIL lines
		const passedMatches = output.match(/PASS:/g) || []
		const failedMatches = output.match(/FAIL:/g) || []
		
		const testsPassed = passedMatches.length
		const testsFailed = failedMatches.length
		const testsTotal = testsPassed + testsFailed
		
		
		return { testsPassed, testsFailed, testsTotal }
	}
}


class RustTestOutputParser implements TestOutputParser {
	parse(output: string): TestResult {
		let totalTestsPassed = 0
		let totalTestsFailed = 0
		
		// Look for all Rust test summary lines like "test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out"
		// There can be multiple test result sections (unit tests, integration tests, doc tests)
		const summaryMatches = output.matchAll(/test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed/g);
		
		let foundSummaries = false
		for (const match of summaryMatches) {
			foundSummaries = true
			const passed = parseInt(match[1])
			const failed = parseInt(match[2])
			totalTestsPassed += passed
			totalTestsFailed += failed
		}
		
		if (!foundSummaries) {
			// Alternative: count individual test results
			const passedMatches = output.match(/test .* \.\.\. ok/g) || []
			const failedMatches = output.match(/test .* \.\.\. FAILED/g) || []
			totalTestsPassed = passedMatches.length
			totalTestsFailed = failedMatches.length
		}
		
		const testsTotal = totalTestsPassed + totalTestsFailed
		
		return { testsPassed: totalTestsPassed, testsFailed: totalTestsFailed, testsTotal }
	}
}


class JavaTestOutputParser implements TestOutputParser {
	parse(output: string): TestResult {
		// Look for Gradle test summary
		const summaryMatch = output.match(/(\d+)\s+tests?\s+completed,\s*(\d+)\s+failed/);
		
		let testsPassed = 0
		let testsFailed = 0
		let testsTotal = 0
		
		if (summaryMatch) {
			testsTotal = parseInt(summaryMatch[1])
			testsFailed = parseInt(summaryMatch[2])
			testsPassed = testsTotal - testsFailed
		} else {
			// Alternative parsing for different Gradle output formats
			const passedMatches = output.match(/PASSED/g) || []
			const failedMatches = output.match(/FAILED/g) || []
			testsPassed = passedMatches.length
			testsFailed = failedMatches.length
			testsTotal = testsPassed + testsFailed
		}
		
		
		return { testsPassed, testsFailed, testsTotal }
	}
}


class GenericTestOutputParser implements TestOutputParser {
	parse(output: string): TestResult {
		// Look for common patterns
		const passedMatches = output.match(/PASS|passed|✓|\bok\b/gi) || []
		const failedMatches = output.match(/FAIL|failed|✗|\berror\b/gi) || []
		
		const testsPassed = passedMatches.length
		const testsFailed = failedMatches.length
		const testsTotal = testsPassed + testsFailed
		
		return { testsPassed, testsFailed, testsTotal }
	}
}

// Factory for creating appropriate test output parsers
class TestOutputParserFactory {
	private static readonly parsers = new Map<string, () => TestOutputParser>([
		['python', () => new PytestOutputParser()],
		['javascript', () => new JestOutputParser()],
		['go', () => new GoTestOutputParser()],
		['rust', () => new RustTestOutputParser()],
		['java', () => new JavaTestOutputParser()],
	])

	static createParser(language: string): TestOutputParser {
		const parserFactory = this.parsers.get(language.toLowerCase())
		return parserFactory ? parserFactory() : new GenericTestOutputParser()
	}


	static registerParser(language: string, parserFactory: () => TestOutputParser): void {
		this.parsers.set(language.toLowerCase(), parserFactory)
	}
}


class VerifyOutput {
	private parser: TestOutputParser

	constructor(language: string) {
		this.parser = TestOutputParserFactory.createParser(language)
	}

	parseTestOutput(output: string): TestResult {
		return this.parser.parse(output)
	}

	calculateFunctionalCorrectness(result: TestResult): number {
		return result.testsTotal > 0 ? result.testsPassed / result.testsTotal : 0
	}
}

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

		// Use VerifyOutput class to parse test results based on language
		const language = task.metadata?.language || 'generic'
		const verifyOutput = new VerifyOutput(language)
		const testResult = verifyOutput.parseTestOutput(output)
		const functionalCorrectness = verifyOutput.calculateFunctionalCorrectness(testResult)


		return {
			success,
			metrics: {
				testsPassed: testResult.testsPassed,
				testsFailed: testResult.testsFailed,
				testsTotal: testResult.testsTotal,
				functionalCorrectness,
			},
		}
	}
}
