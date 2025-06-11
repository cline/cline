import { runSingleEvaluation, TestInput, TestResult } from "./ClineWrapper"
import { basicSystemPrompt } from "./prompts/basicSystemPrompt-06-06-25"
import { claude4SystemPrompt } from "./prompts/claude4SystemPrompt-06-06-25"
import { formatResponse } from "./helpers"
import { Anthropic } from "@anthropic-ai/sdk"
import * as fs from "fs"
import * as path from "path"
import { Command } from "commander"
import { InputMessage, ProcessedTestCase, TestCase, TestConfig, SystemPromptDetails, ConstructSystemPromptFn } from "./types"
import {
	getDatabase,
	upsertSystemPrompt,
	upsertProcessingFunctions,
	upsertFile,
	createBenchmarkRun,
	createCase,
	insertResult,
	DatabaseClient,
	CreateResultInput,
} from "./database"

// Load environment variables from .env file
import * as dotenv from "dotenv"
dotenv.config({ path: path.join(__dirname, "../.env") })

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
	private currentRunId: string | null = null
	private systemPromptHash: string | null = null
	private processingFunctionsHash: string | null = null
	private caseIdMap: Map<string, string> = new Map() // test_id -> case_id mapping

	constructor(isReplay: boolean) {
		if (!isReplay) {
			this.apiKey = process.env.OPENROUTER_API_KEY
			if (!this.apiKey) {
				throw new Error("OPENROUTER_API_KEY environment variable not set for a non-replay run.")
			}
		}
	}

	/**
	 * Initialize database run and store system prompt and processing functions
	 */
	async initializeDatabaseRun(testConfig: TestConfig, testCases: ProcessedTestCase[], isVerbose: boolean): Promise<string> {
		try {
			// Generate a sample system prompt to hash (using first test case)
			const sampleSystemPrompt = testCases.length > 0 
				? this.constructSystemPrompt(testCases[0].system_prompt_details, testConfig.system_prompt_name)
				: "default-system-prompt";

			// Store system prompt
			this.systemPromptHash = await upsertSystemPrompt({
				name: testConfig.system_prompt_name,
				content: sampleSystemPrompt
			});

			// Store processing functions
			this.processingFunctionsHash = await upsertProcessingFunctions({
				name: `${testConfig.parsing_function}-${testConfig.diff_edit_function}`,
				parsing_function: testConfig.parsing_function,
				diff_edit_function: testConfig.diff_edit_function
			});

			// Create benchmark run
			const runDescription = `Model: ${testConfig.model_id}, Cases: ${testCases.length}, Runs per case: ${testConfig.number_of_runs}`;
			this.currentRunId = await createBenchmarkRun({
				description: runDescription,
				system_prompt_hash: this.systemPromptHash
			});

			log(isVerbose, `✓ Database run initialized: ${this.currentRunId}`);
			
			// Create case records
			await this.createDatabaseCases(testCases, isVerbose);

			return this.currentRunId;
		} catch (error) {
			console.error("Failed to initialize database run:", error);
			throw error;
		}
	}

	/**
	 * Initialize multi-model database run (one run for all models)
	 */
	async initializeMultiModelRun(testCases: ProcessedTestCase[], systemPromptName: string, parsingFunction: string, diffEditFunction: string, runDescription: string, isVerbose: boolean): Promise<string> {
		try {
			// Generate a sample system prompt to hash (using first test case)
			const sampleSystemPrompt = testCases.length > 0 
				? this.constructSystemPrompt(testCases[0].system_prompt_details, systemPromptName)
				: "default-system-prompt";

			// Store system prompt
			this.systemPromptHash = await upsertSystemPrompt({
				name: systemPromptName,
				content: sampleSystemPrompt
			});

			// Store processing functions
			this.processingFunctionsHash = await upsertProcessingFunctions({
				name: `${parsingFunction}-${diffEditFunction}`,
				parsing_function: parsingFunction,
				diff_edit_function: diffEditFunction
			});

			// Create benchmark run
			this.currentRunId = await createBenchmarkRun({
				description: runDescription,
				system_prompt_hash: this.systemPromptHash
			});

			log(isVerbose, `✓ Multi-model database run initialized: ${this.currentRunId}`);
			
			// Create case records
			await this.createDatabaseCases(testCases, isVerbose);

			return this.currentRunId;
		} catch (error) {
			console.error("Failed to initialize multi-model database run:", error);
			throw error;
		}
	}

	/**
	 * Create database case records for all test cases
	 */
	async createDatabaseCases(testCases: ProcessedTestCase[], isVerbose: boolean): Promise<void> {
		if (!this.currentRunId || !this.systemPromptHash) {
			throw new Error("Database run not initialized");
		}

		for (const testCase of testCases) {
			try {
				// Store file content if available
				let fileHash: string | undefined;
				if (testCase.file_contents && testCase.file_path) {
					fileHash = await upsertFile({
						filepath: testCase.file_path,
						content: testCase.file_contents
					});
				}

				// Calculate tokens in context (approximate)
				const tokensInContext = this.estimateTokens(testCase.messages);

				// Create case record
				const caseId = await createCase({
					run_id: this.currentRunId,
					description: testCase.test_id,
					system_prompt_hash: this.systemPromptHash,
					task_id: testCase.test_id,
					tokens_in_context: tokensInContext,
					file_hash: fileHash
				});

				this.caseIdMap.set(testCase.test_id, caseId);
			} catch (error) {
				console.error(`Failed to create database case for ${testCase.test_id}:`, error);
				// Continue with other cases
			}
		}

		log(isVerbose, `✓ Created ${this.caseIdMap.size} database case records`);
	}

	/**
	 * Store test result in database
	 */
	async storeResultInDatabase(result: TestResult, testId: string, modelId: string): Promise<void> {
		if (!this.currentRunId || !this.processingFunctionsHash) {
			return; // Skip if database not initialized
		}

		const caseId = this.caseIdMap.get(testId);
		if (!caseId) {
			return; // Skip if case not found
		}

		try {
			// Map error string to error enum (simple mapping)
			const errorEnum = this.mapErrorToEnum(result.error);

			// Store diff edit content if available
			let fileEditedHash: string | undefined;
			if (result.diffEdit) {
				fileEditedHash = await upsertFile({
					filepath: `diff-edit-${testId}`,
					content: result.diffEdit
				});
			}

			// Calculate basic metrics from diff edit if available
			let numEdits = 0;
			let numLinesAdded = 0;
			let numLinesDeleted = 0;
			
			if (result.diffEdit) {
				// Simple parsing to count edits - count SEARCH/REPLACE blocks
				const searchBlocks = (result.diffEdit.match(/------- SEARCH/g) || []).length;
				numEdits = searchBlocks;
				
				// Count added/deleted lines (rough approximation)
				const lines = result.diffEdit.split('\n');
				for (const line of lines) {
					if (line.startsWith('+') && !line.startsWith('+++')) {
						numLinesAdded++;
					} else if (line.startsWith('-') && !line.startsWith('---')) {
						numLinesDeleted++;
					}
				}
			}

			const resultInput: CreateResultInput = {
				run_id: this.currentRunId,
				case_id: caseId,
				model_id: modelId,
				processing_functions_hash: this.processingFunctionsHash,
				succeeded: result.success && (result.diffEditSuccess ?? false),
				error_enum: errorEnum,
				num_edits: numEdits || undefined,
				num_lines_deleted: numLinesDeleted || undefined,
				num_lines_added: numLinesAdded || undefined,
				time_to_first_token_ms: result.streamResult?.timing?.timeToFirstTokenMs,
				time_to_first_edit_ms: result.streamResult?.timing?.timeToFirstEditMs,
				time_round_trip_ms: result.streamResult?.timing?.totalRoundTripMs,
				cost_usd: result.streamResult?.usage?.totalCost,
				completion_tokens: result.streamResult?.usage?.outputTokens,
				raw_model_output: result.streamResult?.assistantMessage,
				file_edited_hash: fileEditedHash,
				parsed_tool_call_json: result.toolCalls ? JSON.stringify(result.toolCalls) : undefined
			};

			await insertResult(resultInput);
		} catch (error) {
			console.error(`Failed to store result in database for ${testId}:`, error);
			// Continue execution - don't fail the test run
		}
	}

	/**
	 * Estimate token count for messages (rough approximation)
	 */
	private estimateTokens(messages: Anthropic.Messages.MessageParam[]): number {
		let totalChars = 0;
		for (const message of messages) {
			if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === 'text') {
						totalChars += block.text.length;
					}
				}
			} else if (typeof message.content === 'string') {
				totalChars += message.content.length;
			}
		}
		// Rough approximation: 4 characters per token
		return Math.ceil(totalChars / 4);
	}

	/**
	 * Map error string to error enum
	 */
	private mapErrorToEnum(error?: string): number | undefined {
		if (!error) return undefined;
		
		const errorMap: Record<string, number> = {
			'no_tool_calls': 1,
			'parsing_error': 2,
			'diff_edit_error': 3,
			'missing_original_diff_edit_tool_call_message': 4,
			'api_error': 5,
			'wrong_tool_call': 6,
			'wrong_file_edited': 7,
			'multi_tool_calls': 8,
			'tool_call_params_undefined': 9,
			'other_error': 99
		};

		return errorMap[error] || 99; // 99 for unknown errors
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

		// Initialize database run
		try {
			await this.initializeDatabaseRun(testConfig, testCases, isVerbose);
		} catch (error) {
			log(isVerbose, `Warning: Failed to initialize database: ${error}`);
		}

		for (const testCase of testCases) {
			results[testCase.test_id] = []

			log(isVerbose, `-Running test: ${testCase.test_id}`)
			for (let i = 0; i < testConfig.number_of_runs; i++) {
				const result = await this.runSingleTest(testCase, testConfig)
				results[testCase.test_id].push(result)
				
				// Store result in database
				try {
					await this.storeResultInDatabase(result, testCase.test_id, testConfig.model_id);
				} catch (error) {
					log(isVerbose, `Warning: Failed to store result in database: ${error}`);
				}
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

		// Initialize database run
		try {
			await this.initializeDatabaseRun(testConfig, testCases, isVerbose);
		} catch (error) {
			log(isVerbose, `Warning: Failed to initialize database: ${error}`);
		}

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

			// Populate the results dictionary and store in database
			for (const result of batchResults) {
				if (result.test_id) {
					results[result.test_id].push(result)
					
					// Store result in database
					try {
						await this.storeResultInDatabase(result, result.test_id, testConfig.model_id);
					} catch (error) {
						log(isVerbose, `Warning: Failed to store result in database: ${error}`);
					}
				}
			}

			const batchNumber = i / maxConcurrency + 1
			const totalBatches = Math.ceil(allRuns.length / maxConcurrency)
			log(isVerbose, `-Completed batch ${batchNumber} of ${totalBatches}... (Batch Cost: $${batchCost.toFixed(6)})`)
		}

		return results
	}

	/**
	 * Check if a test result is a valid attempt (no error_enum 1, 6, or 7)
	 */
	isValidAttempt(result: TestResult): boolean {
		// Invalid if error is one of: no_tool_calls, wrong_tool_call, wrong_file_edited
		const invalidErrors = ['no_tool_calls', 'wrong_tool_call', 'wrong_file_edited'];
		return !invalidErrors.includes(result.error || '');
	}

	/**
	 * Runs all tests for a specific model (assumes database run already initialized)
	 * Keeps retrying until we get the requested number of valid attempts per case
	 */
	async runAllTestsForModel(testCases: ProcessedTestCase[], testConfig: TestConfig, isVerbose: boolean): Promise<TestResultSet> {
		const results: TestResultSet = {}

		for (const testCase of testCases) {
			results[testCase.test_id] = []
			let validAttempts = 0;
			let totalAttempts = 0;

			log(isVerbose, `-Running test: ${testCase.test_id}`)
			
			// Keep trying until we get the requested number of valid attempts
			while (validAttempts < testConfig.number_of_runs) {
				totalAttempts++;
				const result = await this.runSingleTest(testCase, testConfig)
				results[testCase.test_id].push(result)
				
				// Check if this was a valid attempt
				if (this.isValidAttempt(result)) {
					validAttempts++;
					if (isVerbose && validAttempts === testConfig.number_of_runs) {
						log(isVerbose, `  ✓ Completed ${validAttempts}/${testConfig.number_of_runs} valid attempts (${totalAttempts} total attempts)`);
					}
				}
				
				// Store result in database
				try {
					await this.storeResultInDatabase(result, testCase.test_id, testConfig.model_id);
				} catch (error) {
					log(isVerbose, `Warning: Failed to store result in database: ${error}`);
				}
				
				// Safety check to prevent infinite loops - limit to 10 attempts per valid attempt requested
				if (totalAttempts >= testConfig.number_of_runs * 10) {
					log(isVerbose, `  ⚠️ Reached maximum attempts (${totalAttempts}) for test case ${testCase.test_id}. Only got ${validAttempts}/${testConfig.number_of_runs} valid attempts.`);
					break;
				}
			}
		}
		return results
	}

	/**
	 * Runs all tests for a specific model in parallel (assumes database run already initialized)
	 * Keeps retrying until we get the requested number of valid attempts per case
	 */
	async runAllTestsParallelForModel(
		testCases: ProcessedTestCase[],
		testConfig: TestConfig,
		isVerbose: boolean,
		maxConcurrency: number = 20,
	): Promise<TestResultSet> {
		const results: TestResultSet = {}
		const validAttemptsCount: Record<string, number> = {}
		const totalAttemptsCount: Record<string, number> = {}
		
		// Initialize results and counters
		testCases.forEach((tc) => {
			results[tc.test_id] = []
			validAttemptsCount[tc.test_id] = 0
			totalAttemptsCount[tc.test_id] = 0
		})

		// Keep track of which test cases still need more valid attempts
		let remainingTestCases = [...testCases]
		
		// Keep trying until all test cases have enough valid attempts
		while (remainingTestCases.length > 0) {
			// Create a batch of runs for test cases that still need more valid attempts
			const batchRuns = remainingTestCases.map(testCase => ({
				testCase,
				testId: testCase.test_id
			}))
			
			// Limit batch size to maxConcurrency
			const currentBatch = batchRuns.slice(0, maxConcurrency)
			
			// Run the batch in parallel
			const batchPromises = currentBatch.map(({ testCase, testId }) => {
				totalAttemptsCount[testId]++;
				return this.runSingleTest(testCase, testConfig).then((result) => ({
					...result,
					test_id: testId,
				}))
			})
			
			const batchResults = await Promise.all(batchPromises)
			
			// Calculate the total cost for this batch
			const batchCost = batchResults.reduce((total, result) => {
				return total + (result.streamResult?.usage?.totalCost || 0)
			}, 0)
			
			// Process results and update counters
			for (const result of batchResults) {
				if (result.test_id) {
					const testId = result.test_id
					results[testId].push(result)
					
					// Check if this was a valid attempt
					if (this.isValidAttempt(result)) {
						validAttemptsCount[testId]++;
					}
					
					// Store result in database
					try {
						await this.storeResultInDatabase(result, testId, testConfig.model_id);
					} catch (error) {
						log(isVerbose, `Warning: Failed to store result in database: ${error}`);
					}
				}
			}
			
			// Update the list of remaining test cases
			remainingTestCases = remainingTestCases.filter(testCase => {
				const testId = testCase.test_id
				
				// Safety check to prevent infinite loops - limit to 10 attempts per valid attempt requested
				if (totalAttemptsCount[testId] >= testConfig.number_of_runs * 10) {
					log(isVerbose, `  ⚠️ Reached maximum attempts (${totalAttemptsCount[testId]}) for test case ${testId}. Only got ${validAttemptsCount[testId]}/${testConfig.number_of_runs} valid attempts.`);
					return false; // Remove from remaining test cases
				}
				
				return validAttemptsCount[testId] < testConfig.number_of_runs;
			})
			
			log(isVerbose, `-Completed batch... (Batch Cost: $${batchCost.toFixed(6)}, Remaining test cases: ${remainingTestCases.length})`)
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

	const defaultTestPath = path.join(__dirname, "cases")
	const defaultOutputPath = path.join(__dirname, "results")

	program
		.name("TestRunner")
		.description("Run evaluation tests for diff editing")
		.version("1.0.0")
		.option("--test-path <path>", "Path to the directory containing test case JSON files", defaultTestPath)
		.option("--output-path <path>", "Path to the directory to save the test output JSON files", defaultOutputPath)
		.option("--model-ids <model_ids>", "Comma-separated list of model IDs to test")
		.option("--system-prompt-name <name>", "The name of the system prompt to use", "basicSystemPrompt")
		.option("-n, --valid-attempts-per-case <number>", "Number of valid attempts per test case per model (will retry until this many valid attempts are collected)", "1")
		.option("--max-cases <number>", "Maximum number of test cases to run (limits total cases loaded)")
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

	// Parse model IDs from comma-separated string
	const modelIds = options.modelIds ? options.modelIds.split(',').map(id => id.trim()) : [];
	if (modelIds.length === 0) {
		console.error("Error: --model-ids is required and must contain at least one model ID");
		process.exit(1);
	}

	const validAttemptsPerCase = parseInt(options.validAttemptsPerCase, 10);
	
	try {
		const startTime = Date.now()

		const runner = new NodeTestRunner(options.replay)
		let testCases = runner.loadTestCases(testPath)

		// Apply max-cases limit if specified
		if (options.maxCases && options.maxCases > 0) {
			const originalCount = testCases.length
			testCases = testCases.slice(0, options.maxCases)
			log(isVerbose, `-Limited to ${options.maxCases} test cases (out of ${originalCount} available)`)
		}

		const processedTestCases: ProcessedTestCase[] = testCases.map((tc) => ({
			...tc,
			messages: runner.transformMessages(tc.messages),
		}))

		log(isVerbose, `-Loaded ${testCases.length} test cases.`)
		log(isVerbose, `-Testing ${modelIds.length} model(s): ${modelIds.join(', ')}`)
		log(isVerbose, `-Target: ${validAttemptsPerCase} valid attempts per test case per model (will retry until this many valid attempts are collected)`)
		if (options.replay) {
			log(isVerbose, `-Running in REPLAY mode. No API calls will be made.`)
		}
		log(isVerbose, "Starting tests...\n")

		// Initialize ONE database run for ALL models
		const runDescription = `Models: ${modelIds.join(', ')}, Cases: ${testCases.length}, Valid attempts per case: ${validAttemptsPerCase}`;
		await runner.initializeMultiModelRun(processedTestCases, options.systemPromptName, options.parsingFunction, options.diffEditFunction, runDescription, isVerbose);

		// For now, run models sequentially to avoid complexity
		// TODO: Implement parallel model execution later
		for (const modelId of modelIds) {
			log(isVerbose, `\n=== Running Model: ${modelId} ===`)
			
			const testConfig: TestConfig = {
				model_id: modelId,
				system_prompt_name: options.systemPromptName,
				number_of_runs: validAttemptsPerCase, // This will be used for retry logic later
				parsing_function: options.parsingFunction,
				diff_edit_function: options.diffEditFunction,
				thinking_tokens_budget: parseInt(options.thinkingBudget, 10),
				replay: options.replay,
			}

			const results = options.parallel
				? await runner.runAllTestsParallelForModel(processedTestCases, testConfig, isVerbose)
				: await runner.runAllTestsForModel(processedTestCases, testConfig, isVerbose)

			runner.printSummary(results, isVerbose)
		}

		const endTime = Date.now()
		const durationSeconds = ((endTime - startTime) / 1000).toFixed(2)
		log(isVerbose, `\n-Total execution time: ${durationSeconds} seconds`)

		// Note: Individual results are already saved to database during execution
		log(isVerbose, `\n✓ All results stored in database. Use the dashboard to view results.`)
	} catch (error) {
		console.error("\nError running tests:", error)
		process.exit(1)
	}
}

if (require.main === module) {
	main()
}
