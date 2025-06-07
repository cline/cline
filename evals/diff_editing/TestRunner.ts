import { runSingleEvaluation, TestInput, TestResult } from "./ClineWrapper"
import { basicSystemPrompt } from "./prompts/basicSystemPrompt"
import { formatResponse } from "./helpers"
import { Anthropic } from "@anthropic-ai/sdk"
import * as fs from "fs"
import * as path from "path"
import { InputMessage, ProcessedTestCase, TestCase, TestConfig, SystemPromptDetails, ConstructSystemPromptFn } from "./types"

const systemPromptGeneratorLookup: Record<string, ConstructSystemPromptFn> = {
	basicSystemPrompt: basicSystemPrompt,
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
	 * convert our messages array into a properly formatted Anthropic messages array
	 */
	transformMessages(messages: InputMessage[]): Anthropic.Messages.MessageParam[] {
		return messages.map((msg) => {
			// Use TextBlockParam here for constructing the input message
			const content: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = []

			if (msg.text) {
				// This object now correctly matches the TextBlockParam type
				content.push({ type: "text", text: msg.text })
			}

			if (msg.images && Array.isArray(msg.images)) {
				const imageBlocks = formatResponse.imageBlocks(msg.images)
				content.push(...imageBlocks)
			}

			return {
				role: msg.role,
				content: content,
			}
		})
	}

	/**
	 * Generate the system prompt on the fly
	 */
	constructSystemPrompt(systemPromptDetails: SystemPromptDetails, systemPromptName: string) {
		const systemPromptGenerator = systemPromptGeneratorLookup[systemPromptName]

		const { cwd_value, browser_use, width, height, os_value, shell_value, home_value, mcp_string, user_custom_instructions } =
			systemPromptDetails

		const systemPrompt = systemPromptGenerator(
			cwd_value,
			browser_use,
			width,
			height,
			os_value,
			shell_value,
			home_value,
			mcp_string,
			user_custom_instructions,
		)

		return systemPrompt
	}

	/**
	 * Loads our test cases, json files which contain messages, file path & contents for what we expect to be edited
	 */
	async loadTestCases(testFilePath: string): Promise<TestCase[]> {
		const fileContent = fs.readFileSync(testFilePath, "utf8")
		const testCasesDict: { [test_id: string]: TestCase } = JSON.parse(fileContent)
		const testCasesArray: TestCase[] = Object.values(testCasesDict)

		return testCasesArray
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
	async runSingleTest(testCase: ProcessedTestCase, testConfig: TestConfig): Promise<TestResult> {
		const customSystemPrompt = this.constructSystemPrompt(testCase.system_prompt_details, testConfig.system_prompt_name)

		// messages don't include system prompt and are everything up to the first replace_in_file tool call which results in a diff edit error
		const input: TestInput = {
			apiKey: this.apiKey,
			systemPrompt: customSystemPrompt,
			messages: testCase.messages,
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
	async runAllTests(testCases: ProcessedTestCase[], testConfig: TestConfig): Promise<TestResultSet> {
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
		testCases: ProcessedTestCase[],
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

async function main() {
	const args = process.argv.slice(2)
	const paths = args.filter((arg) => !arg.startsWith("--"))
	const runParallel = args.includes("--parallel")

	if (paths.length < 3) {
		console.log("Usage: npx tsx TestRunner.ts [test_path] [config_path] [output_path] [--parallel]")
		process.exit(1)
	}

	const [testPath, configPath, outputPath] = paths

	try {
		const runner = new NodeTestRunner()
		const testCases = await runner.loadTestCases(testPath)
		const testConfig = await runner.loadTestConfig(configPath)

		const processedTestCases: ProcessedTestCase[] = testCases.map((tc) => ({
			...tc,
			messages: runner.transformMessages(tc.messages),
		}))

		console.log(`-Loaded ${testCases.length} test cases.`)
		console.log(`-Executing ${testConfig.number_of_runs} run(s) per test case.`)
		console.log("Starting tests...\n")

		const results = runParallel
			? await runner.runAllTestsParallel(processedTestCases, testConfig)
			: await runner.runAllTests(processedTestCases, testConfig)

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
