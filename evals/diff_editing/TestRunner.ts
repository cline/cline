import { runSingleEvaluation, TestInput, TestResult } from "./ClineWrapper"
import * as fs from "fs"
import * as path from "path"

interface TestCase {
	test_id: string // unique id
	messages: any[] // array of messages with 'role' & 'text'
	file: string // file contents for editing
	original_file_path: string // file we attempted to edit
}

interface TestConfig {
	model_id: string
	system_prompt: string
}

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
			originalFile: testCase.file,
			originalFilePath: testCase.original_file_path,
		}

		return await runSingleEvaluation(input)
	}

	/**
	 * Runs all the text examples synchonously
	 */
	async runAllTests(testCases: TestCase[], testConfig: TestConfig): Promise<TestResult[]> {
		// Sequential execution
		const results: TestResult[] = []
		for (const testCase of testCases) {
			const result = await this.runSingleTest(testCase, testConfig)
			results.push(result)
		}
		return results
	}

	/**
	 * Runs all of the text examples asynchronously, with concurrency limit
	 */
	async runAllTestsParallel(testCases: TestCase[], testConfig: TestConfig, maxConcurrency: number = 10): Promise<TestResult[]> {
		const results: TestResult[] = []

		for (let i = 0; i < testCases.length; i += maxConcurrency) {
			const batch = testCases.slice(i, i + maxConcurrency)
			const batchPromises = batch.map((testCase) => this.runSingleTest(testCase, testConfig))

			console.log(`-Running batch ${Math.floor(i / maxConcurrency) + 1}/${Math.ceil(testCases.length / maxConcurrency)}`)
			const batchResults = await Promise.all(batchPromises)
			results.push(...batchResults)
		}

		return results
	}

	/**
	 * Print output of the tests
	 */
	printSummary(results: TestResult[]) {
		const passed = results.filter((r) => r.success).length
		const failed = results.length - passed

		console.log("\n=== TEST SUMMARY ===")
		console.log(`Total: ${results.length}`)
		console.log(`Passed: ${passed}`)
		console.log(`Failed: ${failed}`)
		console.log(`Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`)

		// Print failed test details
		if (failed > 0) {
			console.log("\n=== FAILED TESTS ===")
			results.forEach((result, idx) => {
				if (!result.success) {
					console.log(`Test ${idx + 1}: ${result.error} - ${result.errorString || ""}`)
				}
			})
		}
	}
}

// Main execution
async function main() {
	if (process.argv.length < 4) {
		console.log("Usage: npx tsx test_runner.ts [test_directory] [config_path] [output_path] [--parallel]")
		process.exit(1)
	}

	const testDir = process.argv[2]
	const configPath = process.argv[3]
	const outputPath = process.argv[4]
	const runParallel = process.argv.includes("--parallel")

	try {
		const runner = new NodeTestRunner()
		const testCases = await runner.loadTestCases(testDir)
		const testConfig = await runner.loadTestConfig(configPath)

		console.log(`-Loaded ${testCases.length} test cases`)
		console.log("Starting tests...\n")

		const results = runParallel
			? await runner.runAllTestsParallel(testCases, testConfig)
			: await runner.runAllTests(testCases, testConfig)

		runner.printSummary(results)

		const timestamp = new Date().toISOString().split(".")[0].replace(/:/g, "-")
		const outputFile = `results_${timestamp}.json`
		const outputFilePath = outputPath + "/" + outputFile

		fs.writeFileSync(outputFilePath, JSON.stringify(results, null, 2))
	} catch (error) {
		console.error("Error running tests:", error)
		process.exit(1)
	}
}

if (require.main === module) {
	main()
}
