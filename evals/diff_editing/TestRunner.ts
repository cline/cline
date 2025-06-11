import { runSingleEvaluation, TestInput, TestResult } from "./ClineWrapper"
import { basicSystemPrompt } from "./prompts/basicSystemPrompt-06-06-25"
import { claude4SystemPrompt } from "./prompts/claude4SystemPrompt-06-06-25"
import { formatResponse } from "./helpers"
import { Anthropic } from "@anthropic-ai/sdk"
import * as fs from "fs"
import * as path from "path"
import { Command } from "commander"
import { InputMessage, ProcessedTestCase, TestCase, TestConfig, SystemPromptDetails, ConstructSystemPromptFn } from "./types"

function log(isVerbose: boolean, message: string) {
	if (isVerbose) {
		console.log(message)
	}
}

const systemPromptGeneratorLookup: Record<string, ConstructSystemPromptFn> = {
	basicSystemPrompt: basicSystemPrompt,
	claude4SystemPrompt: claude4SystemPrompt,
}

type TestResultSet = { [test_id: string]: (TestResult & { test_id?: string })[] }

class NodeTestRunner {
	private apiKey: string | undefined

	constructor(isReplay: boolean) {
		if (!isReplay) {
			this.apiKey = process.env.OPENROUTER_API_KEY
			if (!this.apiKey) {
				throw new Error("OPENROUTER_API_KEY environment variable not set for a non-replay run.")
			}
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
	 * Loads our test cases from a directory of json files
	 */
	loadTestCases(testDirectoryPath: string): TestCase[] {
		const testCasesArray: TestCase[] = []
		const dirents = fs.readdirSync(testDirectoryPath, { withFileTypes: true })

		for (const dirent of dirents) {
			if (dirent.isFile() && dirent.name.endsWith(".json")) {
				const testFilePath = path.join(testDirectoryPath, dirent.name)
				const fileContent = fs.readFileSync(testFilePath, "utf8")
				const testCase: TestCase = JSON.parse(fileContent)

				// Use the filename (without extension) as the test_id if not provided
				if (!testCase.test_id) {
					testCase.test_id = path.parse(dirent.name).name
				}
				testCasesArray.push(testCase)
			}
		}

		return testCasesArray
	}

	/**
	 * Saves the test results to the specified output directory.
	 */
	saveTestResults(results: TestResultSet, outputPath: string) {
		// Ensure output directory exists
		if (!fs.existsSync(outputPath)) {
			fs.mkdirSync(outputPath, { recursive: true })
		}

		// Write each test result to its own file
		for (const testId in results) {
			const outputFilePath = path.join(outputPath, `${testId}.json`)
			const testResult = results[testId]
			fs.writeFileSync(outputFilePath, JSON.stringify(testResult, null, 2))
		}
	}

	/**
	 * Run a single test example
	 */
	async runSingleTest(testCase: ProcessedTestCase, testConfig: TestConfig): Promise<TestResult> {
		if (testConfig.replay && !testCase.original_diff_edit_tool_call_message) {
			return {
				success: false,
				error: "missing_original_diff_edit_tool_call_message",
				errorString: `Test case ${testCase.test_id} is missing 'original_diff_edit_tool_call_message' for replay.`,
			}
		}

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
			thinkingBudgetTokens: testConfig.thinking_tokens_budget,
			originalDiffEditToolCallMessage: testConfig.replay ? testCase.original_diff_edit_tool_call_message : undefined,
		}

		return await runSingleEvaluation(input)
	}

	/**
	 * Runs all the text examples synchonously
	 */
	async runAllTests(testCases: ProcessedTestCase[], testConfig: TestConfig, isVerbose: boolean): Promise<TestResultSet> {
		const results: TestResultSet = {}

		for (const testCase of testCases) {
			results[testCase.test_id] = []

			log(isVerbose, `-Running test: ${testCase.test_id}`)
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
		isVerbose: boolean,
		maxConcurrency: number = 20,
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

			// Calculate the total cost for this batch
			const batchCost = batchResults.reduce((total, result) => {
				return total + (result.streamResult?.usage?.totalCost || 0)
			}, 0)

			// Populate the results dictionary
			for (const result of batchResults) {
				if (result.test_id) {
					results[result.test_id].push(result)
				}
			}

			const batchNumber = i / maxConcurrency + 1
			const totalBatches = Math.ceil(allRuns.length / maxConcurrency)
			log(isVerbose, `-Completed batch ${batchNumber} of ${totalBatches}... (Batch Cost: $${batchCost.toFixed(6)})`)
		}

		return results
	}

	/**
	 * Print output of the tests
	 */
	printSummary(results: TestResultSet, isVerbose: boolean) {
		let totalRuns = 0
		let totalPasses = 0
		let totalInputTokens = 0
		let totalOutputTokens = 0
		let totalCost = 0
		let runsWithUsageData = 0
		let totalDiffEditSuccesses = 0
		let totalRunsWithToolCalls = 0
		const testCaseIds = Object.keys(results)

		log(isVerbose, "\n=== TEST SUMMARY ===")

		for (const testId of testCaseIds) {
			const testResults = results[testId]
			const passedCount = testResults.filter((r) => r.success && r.diffEditSuccess).length
			const runCount = testResults.length

			totalRuns += runCount
			totalPasses += passedCount

			const runsWithToolCalls = testResults.filter((r) => r.success === true).length
			const diffEditSuccesses = passedCount
			totalRunsWithToolCalls += runsWithToolCalls
			totalDiffEditSuccesses += diffEditSuccesses

			// Accumulate token and cost data
			for (const result of testResults) {
				if (result.streamResult?.usage) {
					totalInputTokens += result.streamResult.usage.inputTokens
					totalOutputTokens += result.streamResult.usage.outputTokens
					totalCost += result.streamResult.usage.totalCost
					runsWithUsageData++
				}
			}

			log(isVerbose, `\n--- Test Case: ${testId} ---`)
			log(isVerbose, `  Runs: ${runCount}`)
			log(isVerbose, `  Passed: ${passedCount}`)
			log(isVerbose, `  Success Rate: ${runCount > 0 ? ((passedCount / runCount) * 100).toFixed(1) : "N/A"}%`)
		}

		log(isVerbose, "\n\n=== OVERALL SUMMARY ===")
		log(isVerbose, `Total Test Cases: ${testCaseIds.length}`)
		log(isVerbose, `Total Runs Executed: ${totalRuns}`)
		log(isVerbose, `Overall Passed: ${totalPasses}`)
		log(isVerbose, `Overall Failed: ${totalRuns - totalPasses}`)
		log(isVerbose, `Overall Success Rate: ${totalRuns > 0 ? ((totalPasses / totalRuns) * 100).toFixed(1) : "N/A"}%`)

		log(isVerbose, "\n\n=== OVERALL DIFF EDIT SUCCESS RATE ===")
		if (totalRunsWithToolCalls > 0) {
			const diffSuccessRate = (totalDiffEditSuccesses / totalRunsWithToolCalls) * 100
			log(isVerbose, `Total Runs with Successful Tool Calls: ${totalRunsWithToolCalls}`)
			log(isVerbose, `Total Runs with Successful Diff Edits: ${totalDiffEditSuccesses}`)
			log(isVerbose, `Diff Edit Success Rate: ${diffSuccessRate.toFixed(1)}%`)
		} else {
			log(isVerbose, "No successful tool calls to analyze for diff edit success.")
		}

		log(isVerbose, "\n\n=== TOKEN & COST ANALYSIS ===")
		if (runsWithUsageData > 0) {
			log(isVerbose, `Total Input Tokens: ${totalInputTokens.toLocaleString()}`)
			log(isVerbose, `Total Output Tokens: ${totalOutputTokens.toLocaleString()}`)
			log(isVerbose, `Total Cost: $${totalCost.toFixed(6)}`)
			log(isVerbose, "---")
			log(
				isVerbose,
				`Avg Input Tokens / Run: ${(totalInputTokens / runsWithUsageData).toLocaleString(undefined, {
					maximumFractionDigits: 0,
				})}`,
			)
			log(
				isVerbose,
				`Avg Output Tokens / Run: ${(totalOutputTokens / runsWithUsageData).toLocaleString(undefined, {
					maximumFractionDigits: 0,
				})}`,
			)
			log(isVerbose, `Avg Cost / Run: $${(totalCost / runsWithUsageData).toFixed(6)}`)
		} else {
			log(isVerbose, "No usage data available to analyze.")
		}
	}
}

async function main() {
	const program = new Command()

	const defaultTestPath = path.join(__dirname, "test_cases")
	const defaultOutputPath = path.join(__dirname, "test_outputs")

	program
		.name("TestRunner")
		.description("Run evaluation tests for diff editing")
		.version("1.0.0")
		.option("--test-path <path>", "Path to the directory containing test case JSON files", defaultTestPath)
		.option("--output-path <path>", "Path to the directory to save the test output JSON files", defaultOutputPath)
		.option("--model-id <model_id>", "The model ID to use for the test")
		.option("--system-prompt-name <name>", "The name of the system prompt to use", "basicSystemPrompt")
		.option("-n, --number-of-runs <number>", "Number of times to run each test case", "1")
		.option("--parsing-function <name>", "The parsing function to use", "parseAssistantMessageV2")
		.option("--diff-edit-function <name>", "The diff editing function to use", "constructNewFileContentV2")
		.option("--thinking-budget <tokens>", "Set the thinking tokens budget", "0")
		.option("--parallel", "Run tests in parallel", false)
		.option("--replay", "Run evaluation from a pre-recorded LLM output, skipping the API call", false)
		.option("-v, --verbose", "Enable verbose logging", false)

	program.parse(process.argv)

	const options = program.opts()
	const isVerbose = options.verbose
	const testPath = options.testPath
	const outputPath = options.outputPath

	const testConfig: TestConfig = {
		model_id: options.modelId,
		system_prompt_name: options.systemPromptName,
		number_of_runs: parseInt(options.numberOfRuns, 10),
		parsing_function: options.parsingFunction,
		diff_edit_function: options.diffEditFunction,
		thinking_tokens_budget: parseInt(options.thinkingBudget, 10),
		replay: options.replay,
	}

	try {
		const startTime = Date.now()

		const runner = new NodeTestRunner(testConfig.replay)
		const testCases = runner.loadTestCases(testPath)

		const processedTestCases: ProcessedTestCase[] = testCases.map((tc) => ({
			...tc,
			messages: runner.transformMessages(tc.messages),
		}))

		log(isVerbose, `-Loaded ${testCases.length} test cases.`)
		log(isVerbose, `-Executing ${testConfig.number_of_runs} run(s) per test case.`)
		if (testConfig.replay) {
			log(isVerbose, `-Running in REPLAY mode. No API calls will be made.`)
		}
		log(isVerbose, "Starting tests...\n")

		const results = options.parallel
			? await runner.runAllTestsParallel(processedTestCases, testConfig, isVerbose)
			: await runner.runAllTests(processedTestCases, testConfig, isVerbose)

		runner.printSummary(results, isVerbose)

		const endTime = Date.now()
		const durationSeconds = ((endTime - startTime) / 1000).toFixed(2)
		log(isVerbose, `\n-Total execution time: ${durationSeconds} seconds`)

		runner.saveTestResults(results, outputPath)
	} catch (error) {
		console.error("\nError running tests:", error)
		process.exit(1)
	}
}

if (require.main === module) {
	main()
}
