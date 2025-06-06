import { runSingleEvaluation, TestInput, TestResult } from "./ClineWrapper"
import * as fs from "fs"
import * as path from "path"

interface TestCase {
	test_id: string // unique id
	messages: any[] // array of messages with 'role' & 'text'
	file_contents: string // file contents for editing
	file_path: string // file we attempted to edit
}

interface TestConfig {
	model_id: string // model to use to run the diff edit evals
	system_prompt: string // system prompt to use here
	number_of_runs: number // specifies the number of times to run each eval example
	parsing_function: string // parsing function to use
	diff_edit_function: string // diff edit function to use
}

type TestResultSet = { [test_id: string]: (TestResult & { test_id?: string })[] }

class NodeTestRunner {
	private apiKey: string

	constructor() {
		this.apiKey = process.env.OPENROUTER_API_KEY!
		if (!this.apiKey) {
			throw new Error("OPENROUTER_API_KEY environment variable not set")
		}
	}

	/**
	 * Loads our test cases, json files which contain messages, file path & contents for what we expect to be edited
	 */
	async loadTestCases(testDir: string): Promise<TestCase[]> {
		const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith(".json"))
		const testCases: TestCase[] = []

		for (const file of testFiles) {
			const filePath = path.join(testDir, file)
			const testData = JSON.parse(fs.readFileSync(filePath, "utf8"))
			testCases.push(testData)
		}

		return testCases
	}

	/**
	 * Load our test config
	 */
	async loadTestConfig(configPath: string): Promise<TestConfig> {
		const configData = JSON.parse(fs.readFileSync(configPath, "utf8"))
		return configData
	}

	/**
	 * Run a single test example
	 */
	async runSingleTest(testCase: TestCase, testConfig: TestConfig): Promise<TestResult> {
		const input: TestInput = {
			apiKey: this.apiKey,
			systemPrompt: testCase.messages[0], // testConfig.system_prompt, // @@@@@@@@@@@@@@@@@@ need to change this
			messages: testCase.messages.slice(1), // @@@@@@@@@@@@@@@ need to change this
			modelId: testConfig.model_id,
			originalFile: testCase.file_contents,
			originalFilePath: testCase.file_path,
			parsingFunction: testConfig.parsing_function,
			diffEditFunction: testConfig.diff_edit_function,
		}

		return await runSingleEvaluation(input)
	}

	/**
	 * Runs all the text examples synchonously
	 */
	async runAllTests(testCases: TestCase[], testConfig: TestConfig): Promise<TestResultSet> {
		const results: TestResultSet = {}

		for (const testCase of testCases) {
			results[testCase.test_id] = []

			console.log(`-Running test: ${testCase.test_id}`)
			for (let i = 0; i < testConfig.number_of_runs; i++) {
				const result = await this.runSingleTest(testCase, testConfig)
				results[testCase.test_id].push(result)
			}
		}
		return results
	}

	/**
	 * Runs all of the text examples asynchronously, with concurrency limit
	 */
	async runAllTestsParallel(
		testCases: TestCase[],
		testConfig: TestConfig,
		maxConcurrency: number = 10,
	): Promise<TestResultSet> {
		const results: TestResultSet = {}
		testCases.forEach((tc) => {
			results[tc.test_id] = []
		})

		// Create a flat list of all individual runs we need to execute
		const allRuns = testCases.flatMap((testCase) =>
			Array(testConfig.number_of_runs)
				.fill(null)
				.map(() => testCase),
		)

		for (let i = 0; i < allRuns.length; i += maxConcurrency) {
			const batch = allRuns.slice(i, i + maxConcurrency)

			const batchPromises = batch.map((testCase) =>
				this.runSingleTest(testCase, testConfig).then((result) => ({
					...result,
					test_id: testCase.test_id,
				})),
			)

			const batchResults = await Promise.all(batchPromises)

			// Populate the results dictionary
			for (const result of batchResults) {
				if (result.test_id) {
					results[result.test_id].push(result)
				}
			}
		}

		return results
	}

	/**
	 * Print output of the tests
	 */
	printSummary(results: TestResultSet) {
		let totalRuns = 0
		let totalPasses = 0
		const testCaseIds = Object.keys(results)

		console.log("\n=== TEST SUMMARY ===")

		for (const testId of testCaseIds) {
			const testResults = results[testId]
			const passedCount = testResults.filter((r) => r.success && r.diffEditSuccess).length
			const runCount = testResults.length

			totalRuns += runCount
			totalPasses += passedCount

			console.log(`\n--- Test Case: ${testId} ---`)
			console.log(`  Runs: ${runCount}`)
			console.log(`  Passed: ${passedCount}`)
			console.log(`  Success Rate: ${runCount > 0 ? ((passedCount / runCount) * 100).toFixed(1) : "N/A"}%`)
		}

		console.log("\n\n=== OVERALL SUMMARY ===")
		console.log(`Total Test Cases: ${testCaseIds.length}`)
		console.log(`Total Runs Executed: ${totalRuns}`)
		console.log(`Overall Passed: ${totalPasses}`)
		console.log(`Overall Failed: ${totalRuns - totalPasses}`)
		console.log(`Overall Success Rate: ${totalRuns > 0 ? ((totalPasses / totalRuns) * 100).toFixed(1) : "N/A"}%`)
	}
}

// Main execution
async function main() {
	const args = process.argv.slice(2)
	const paths = args.filter((arg) => !arg.startsWith("--"))
	const runParallel = args.includes("--parallel")

	if (paths.length < 3) {
		console.log("Usage: npx tsx test_runner.ts [test_directory] [config_path] [output_path] [--parallel]")
		process.exit(1)
	}

	const [testDir, configPath, outputPath] = paths

	try {
		const runner = new NodeTestRunner()
		const testCases = await runner.loadTestCases(testDir)
		const testConfig = await runner.loadTestConfig(configPath)

		console.log(`-Loaded ${testCases.length} test cases.`)
		console.log(`-Executing ${testConfig.number_of_runs} run(s) per test case.`)
		console.log("Starting tests...\n")

		const results = runParallel
			? await runner.runAllTestsParallel(testCases, testConfig)
			: await runner.runAllTests(testCases, testConfig)

		runner.printSummary(results)

		// Ensure output directory exists
		if (!fs.existsSync(outputPath)) {
			fs.mkdirSync(outputPath, { recursive: true })
		}

		const timestamp = new Date().toISOString().split(".")[0].replace(/:/g, "-")
		const outputFile = `results_${timestamp}.json`
		const outputFilePath = path.join(outputPath, outputFile)

		fs.writeFileSync(outputFilePath, JSON.stringify(results, null, 2))
	} catch (error) {
		console.error("\nError running tests:", error)
		process.exit(1)
	}
}

if (require.main === module) {
	main()
}
