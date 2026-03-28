import { runSingleEvaluation, TestInput, TestResult } from "./ClineWrapper"
import { parseAssistantMessageV2, AssistantMessageContent } from "./parsing/parse-assistant-message-06-06-25"
import { constructNewFileContent as constructNewFileContent_06_06_25 } from "./diff-apply/diff-06-06-25"
import { constructNewFileContent as constructNewFileContent_06_23_25 } from "./diff-apply/diff-06-23-25"
import { constructNewFileContent as constructNewFileContent_06_25_25 } from "./diff-apply/diff-06-25-25"
import { constructNewFileContent as constructNewFileContent_06_26_25 } from "./diff-apply/diff-06-26-25"
import { constructNewFileContent as constructNewFileContentV3 } from "../../src/core/assistant-message/diff"
import { basicSystemPrompt } from "./prompts/basicSystemPrompt-06-06-25"
import { claude4SystemPrompt } from "./prompts/claude4SystemPrompt-06-06-25"
import { formatResponse, log } from "./helpers"
import { Anthropic } from "@anthropic-ai/sdk"
import * as fs from "fs"
import * as path from "path"
import { Command } from "commander"
import { InputMessage, ProcessedTestCase, TestCase, TestConfig, SystemPromptDetails, ConstructSystemPromptFn } from "./types"
import { loadOpenRouterModelData, EvalOpenRouterModelInfo } from "./openRouterModelsHelper" // Added import
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
	getResultsByRun,
	getCaseById,
	getFileByHash,
	getBenchmarkRun,
} from "./database"

// Load environment variables from .env file
import * as dotenv from "dotenv"
dotenv.config({ path: path.join(__dirname, "../.env") })

// tiktoken for token counting
import { get_encoding } from "tiktoken";
const encoding = get_encoding("cl100k_base"); 

let openRouterModelDataGlobal: Record<string, EvalOpenRouterModelInfo> = {}; // Global to store fetched data

const systemPromptGeneratorLookup: Record<string, ConstructSystemPromptFn> = {
	basicSystemPrompt: basicSystemPrompt,
	claude4SystemPrompt: claude4SystemPrompt,
}

type TestResultSet = { [test_id: string]: (TestResult & { test_id?: string })[] }

class NodeTestRunner {
	private apiKey: string | undefined
	private provider: string
	private currentRunId: string | null = null
	private systemPromptHash: string | null = null
	private processingFunctionsHash: string | null = null
	private caseIdMap: Map<string, string> = new Map() // test_id -> case_id mapping

	constructor(isReplay: boolean, provider: string = "openrouter") {
		this.provider = provider
		if (!isReplay) {
			if (provider === "openai") {
				this.apiKey = process.env.OPENAI_API_KEY
				if (!this.apiKey) {
					throw new Error("OPENAI_API_KEY environment variable not set for a non-replay run with OpenAI provider.")
				}
			} else {
				this.apiKey = process.env.OPENROUTER_API_KEY
				if (!this.apiKey) {
					throw new Error("OPENROUTER_API_KEY environment variable not set for a non-replay run with OpenRouter provider.")
				}
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
	 * Store replay result in database, copying original data but with new diffing results
	 */
	async storeReplayResultInDatabase(replayResult: TestResult, originalResult: any, testId: string, newCaseId: string): Promise<void> {
		if (!this.currentRunId || !this.processingFunctionsHash) {
			return; // Skip if database not initialized
		}

		try {
			// Map error string to error enum (simple mapping)
			const errorEnum = this.mapErrorToEnum(replayResult.error);

			// Store diff edit content if available
			let fileEditedHash: string | undefined;
			if (replayResult.diffEdit) {
				fileEditedHash = await upsertFile({
					filepath: `diff-edit-${testId}`,
					content: replayResult.diffEdit
				});
			}

			// Calculate basic metrics from diff edit if available
			let numEdits = 0;
			let numLinesAdded = 0;
			let numLinesDeleted = 0;
			
			if (replayResult.diffEdit) {
				// Simple parsing to count edits - count SEARCH/REPLACE blocks
				const searchBlocks = (replayResult.diffEdit.match(/------- SEARCH/g) || []).length;
				numEdits = searchBlocks;
				
				// Count added/deleted lines (rough approximation)
				const lines = replayResult.diffEdit.split('\n');
				for (const line of lines) {
					if (line.startsWith('+') && !line.startsWith('+++')) {
						numLinesAdded++;
					} else if (line.startsWith('-') && !line.startsWith('---')) {
						numLinesDeleted++;
					}
				}
			}

			// Copy original result data but update replay-specific fields
			const resultInput: CreateResultInput = {
				run_id: this.currentRunId, // New run ID
				case_id: newCaseId, // New case ID
				model_id: originalResult.model_id, // Copy from original
				processing_functions_hash: this.processingFunctionsHash, // New processing functions
				succeeded: replayResult.success && (replayResult.diffEditSuccess ?? false), // New result
				error_enum: errorEnum, // New error if any
				num_edits: numEdits || originalResult.num_edits, // New or original
				num_lines_deleted: numLinesDeleted || originalResult.num_lines_deleted, // New or original
				num_lines_added: numLinesAdded || originalResult.num_lines_added, // New or original
				// Copy timing and cost data from original (since we didn't make API calls)
				time_to_first_token_ms: originalResult.time_to_first_token_ms,
				time_to_first_edit_ms: originalResult.time_to_first_edit_ms,
				time_round_trip_ms: originalResult.time_round_trip_ms,
				cost_usd: originalResult.cost_usd,
				completion_tokens: originalResult.completion_tokens,
				// Use original model output (since we're replaying)
				raw_model_output: originalResult.raw_model_output,
				file_edited_hash: fileEditedHash || originalResult.file_edited_hash,
				parsed_tool_call_json: replayResult.toolCalls ? JSON.stringify(replayResult.toolCalls) : originalResult.parsed_tool_call_json
			};

			await insertResult(resultInput);
		} catch (error) {
			console.error(`Failed to store replay result in database for ${testId}:`, error);
			// Continue execution - don't fail the test run
		}
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
	public estimateTokens(messages: Anthropic.Messages.MessageParam[]): number { // Made public
		let totalText = "";
		for (const message of messages) {
			if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === 'text') {
						totalText += block.text + "\n";
					}
				}
			} else if (typeof message.content === 'string') {
				totalText += message.content + "\n";
			}
		}
		return encoding.encode(totalText).length;
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
	loadTestCases(testDirectoryPath: string, isVerbose: boolean): TestCase[] {
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

				// Filter out cases with missing file_contents
				if (!testCase.file_contents || testCase.file_contents.trim() === "") {
					log(isVerbose, `Skipping case ${testCase.test_id}: missing or empty file_contents.`);
					continue;
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

	async runDatabaseReplay(replayRunId: string, diffApplyFile: string, isVerbose: boolean) {
		log(isVerbose, `Starting database replay for run_id: ${replayRunId}`)
		log(isVerbose, `Using diff apply file: ${diffApplyFile}`)

		// 1. Get the correct diffing function
		const diffEditingFunctions: Record<string, any> = {
			"diff-06-06-25": constructNewFileContent_06_06_25,
			"diff-06-23-25": constructNewFileContent_06_23_25,
			"diff-06-25-25": constructNewFileContent_06_25_25,
			"diff-06-26-25": constructNewFileContent_06_26_25,
			constructNewFileContentV3: constructNewFileContentV3,
		}
		const constructNewFileContent = diffEditingFunctions[diffApplyFile]

		if (!constructNewFileContent) {
			throw new Error(`Could not find diff apply function for: ${diffApplyFile}`)
		}
		log(isVerbose, `Successfully loaded diff apply function: ${diffApplyFile}`)

		// 2. Fetch original run data
		const originalResults = await getResultsByRun(replayRunId)
		if (originalResults.length === 0) {
			throw new Error(`No results found for run_id: ${replayRunId}`)
		}
		log(isVerbose, `Found ${originalResults.length} results to replay.`)

		const originalRun = await getBenchmarkRun(replayRunId)
		if (!originalRun) {
			throw new Error(`Could not find original run with id ${replayRunId}`)
		}

		// 3. Create a new benchmark run for the replay
		const replayRunDescription = `Replay of run ${replayRunId} using ${diffApplyFile}`
		this.currentRunId = await createBenchmarkRun({
			description: replayRunDescription,
			system_prompt_hash: originalRun.system_prompt_hash,
		})
		log(isVerbose, `Created new run for replay: ${this.currentRunId}`)

		// 4. Set up processing functions for the new run
		this.processingFunctionsHash = await upsertProcessingFunctions({
			name: `replay-${diffApplyFile}`,
			parsing_function: "parseAssistantMessageV2",
			diff_edit_function: diffApplyFile,
		})

		// 5. Process each result from the original run
		let replayedCount = 0
		const caseIdMirror: Map<string, string> = new Map()

		for (const originalResult of originalResults) {
			// 5a. Basic validation to ensure we can even process this
			if (!originalResult.case_id) {
				log(isVerbose, `Skipping result ${originalResult.result_id} due to missing case_id.`)
				continue
			}

			// 5b. Mirror the case for the new run, reusing if already created
			let newCaseId = caseIdMirror.get(originalResult.case_id)
			if (!newCaseId) {
				const originalCase = await getCaseById(originalResult.case_id)
				if (!originalCase) {
					log(isVerbose, `Skipping result ${originalResult.result_id} because original case could not be found.`)
					continue
				}
				newCaseId = await createCase({
					run_id: this.currentRunId,
					description: `Replay of case ${originalCase.case_id} from run ${replayRunId}`,
					system_prompt_hash: originalCase.system_prompt_hash,
					task_id: originalCase.task_id,
					tokens_in_context: originalCase.tokens_in_context,
					file_hash: originalCase.file_hash,
				})
				caseIdMirror.set(originalResult.case_id, newCaseId)
			}

			// 5c. Determine if the original attempt was a "valid attempt"
			const isValidOriginalAttempt = originalResult.error_enum === null || originalResult.error_enum === 3 // 3 is diff_edit_error

			const newResultInput: CreateResultInput = {
				...(originalResult as any),
				run_id: this.currentRunId,
				case_id: newCaseId,
				processing_functions_hash: this.processingFunctionsHash,
			}
			delete (newResultInput as any).result_id

			if (isValidOriginalAttempt) {
				// This was a valid attempt. Re-run the diff algorithm.
				const originalCase = await getCaseById(originalResult.case_id)
				if (!originalCase) {
					log(isVerbose, `  [WARN] Replay for result ${originalResult.result_id}: Could not find original case. Copying original result.`)
					newResultInput.succeeded = originalResult.succeeded
					newResultInput.error_enum = originalResult.error_enum
				} else {
					const originalFile = originalCase.file_hash ? await getFileByHash(originalCase.file_hash) : null
					const parsedToolCall = originalResult.parsed_tool_call_json ? JSON.parse(originalResult.parsed_tool_call_json)[0] : null
					const diffContent = parsedToolCall?.input?.diff

					if (originalFile && diffContent) {
						let diffSuccess = false
						try {
							await constructNewFileContent(diffContent, originalFile.content, true)
							diffSuccess = true
							log(isVerbose, `  [OK] Replay for task ${originalCase.task_id}: Diff applied successfully.`)
						} catch (e) {
							diffSuccess = false
							log(isVerbose, `  [FAIL] Replay for task ${originalCase.task_id}: New diff algorithm failed.`)
						}
						newResultInput.succeeded = diffSuccess
						newResultInput.error_enum = diffSuccess ? undefined : 3 // 3 = diff_edit_error
					} else {
						// Something is wrong with the ground truth data, just copy it.
						log(
							isVerbose,
							`  [WARN] Replay for task ${originalCase.task_id}: Valid original attempt but missing file or diff content. Copying original result.`,
						)
						newResultInput.succeeded = originalResult.succeeded
						newResultInput.error_enum = originalResult.error_enum
					}
				}
			} else {
				// This was not a valid attempt. Just copy the original result's outcome.
				log(isVerbose, `  [SKIP] Replay for task ${originalResult.case_id}: Invalid original attempt. Copying original result.`)
				newResultInput.succeeded = originalResult.succeeded
				newResultInput.error_enum = originalResult.error_enum
			}

			await insertResult(newResultInput)
			replayedCount++
		}

		log(isVerbose, `\n✓ Database replay completed successfully.`)
		log(isVerbose, `  Total original results: ${originalResults.length}`)
		log(isVerbose, `  Total replayed results: ${replayedCount}`)
		log(isVerbose, `  New run ID: ${this.currentRunId}`)
	}

	/**
	 * Run a single test example
	 */
	async runSingleTest(testCase: ProcessedTestCase, testConfig: TestConfig, isVerbose: boolean = false): Promise<TestResult> {
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
			diffApplyFile: testConfig.diff_apply_file,
			provider: this.provider,
			isVerbose: isVerbose,
		}

		if (isVerbose) {
			log(isVerbose, `    Sending request to ${testConfig.model_id} for test case ${testCase.test_id}...`);
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
				log(isVerbose, `  Attempt ${i+1}/${testConfig.number_of_runs} for ${testCase.test_id}...`);
				const result = await this.runSingleTest(testCase, testConfig, isVerbose)
				results[testCase.test_id].push(result)
				
				// Log result status
				if (isVerbose) {
					if (result.success) {
						log(isVerbose, `  ✓ Attempt ${i+1} completed successfully`);
					} else {
						log(isVerbose, `  ✗ Attempt ${i+1} failed (error: ${result.error || 'unknown'})`);
					}
				}
				
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

			const batchPromises = batch.map((testCase) => {
				log(isVerbose, `  Running test for ${testCase.test_id}...`);
				return this.runSingleTest(testCase, testConfig, isVerbose).then((result) => ({
					...result,
					test_id: testCase.test_id,
				}))
			})

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
				log(isVerbose, `  Attempt ${totalAttempts} for ${testCase.test_id} (${validAttempts}/${testConfig.number_of_runs} valid so far)...`);
				
				const result = await this.runSingleTest(testCase, testConfig, isVerbose)
				results[testCase.test_id].push(result)
				
				// Check if this was a valid attempt
				const isValid = this.isValidAttempt(result);
				if (isValid) {
					validAttempts++;
					log(isVerbose, `  ✓ Valid attempt ${validAttempts}/${testConfig.number_of_runs} completed (${result.success ? 'SUCCESS' : 'FAILED'})`);
				} else {
					log(isVerbose, `  ✗ Invalid attempt (error: ${result.error || 'unknown'})`);
				}
				
				// Store result in database
				try {
					await this.storeResultInDatabase(result, testCase.test_id, testConfig.model_id);
				} catch (error) {
					log(isVerbose, `Warning: Failed to store result in database: ${error}`);
				}
				
				// Safety check to prevent infinite loops - use configurable max attempts limit
				if (totalAttempts >= testConfig.max_attempts_per_case) {
					log(isVerbose, `  ⚠️ Reached maximum attempts (${totalAttempts}) for test case ${testCase.test_id}. Only got ${validAttempts}/${testConfig.number_of_runs} valid attempts.`);
					break;
				}
			}
			
			log(isVerbose, `  ✓ Completed test case ${testCase.test_id}: ${validAttempts}/${testConfig.number_of_runs} valid attempts (${totalAttempts} total attempts)`);
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
	interface EvaluationTask {
		modelId: string;
		testCase: ProcessedTestCase;
		testConfig: TestConfig;
	}

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
		.option("--max-attempts-per-case <number>", "Maximum total attempts per test case (default: 10x valid attempts)")
		.option("--max-cases <number>", "Maximum number of test cases to run (limits total cases loaded)")
		.option("--parsing-function <name>", "The parsing function to use", "parseAssistantMessageV2")
		.option("--diff-edit-function <name>", "The diff editing function to use", "diff-06-26-25")
		.option("--thinking-budget <tokens>", "Set the thinking tokens budget", "0")
		.option("--provider <provider>", "API provider to use (openrouter, openai)", "openrouter")
		.option("--parallel", "Run tests in parallel", false)
		.option("--replay", "Run evaluation from a pre-recorded LLM output, skipping the API call", false)
		.option("--replay-run-id <run_id>", "The ID of the run to replay from the database")
		.option("--diff-apply-file <filename>", "The name of the diff apply file to use for the replay")
		.option("--save-locally", "Save results to local JSON files in addition to database", false)
		.option("-v, --verbose", "Enable verbose logging", false)
		.option("--max-concurrency <number>", "Maximum number of parallel requests", "80")


	program.parse(process.argv)

	const options = program.opts()
	const isVerbose = options.verbose
	const testPath = options.testPath
	const outputPath = options.outputPath
	const saveLocally = options.saveLocally
	const maxConcurrency = parseInt(options.maxConcurrency, 10);

	// Parse model IDs from comma-separated string
	const modelIds = options.modelIds ? options.modelIds.split(',').map(id => id.trim()) : [];
	if (modelIds.length === 0) {
		console.error("Error: --model-ids is required and must contain at least one model ID");
		process.exit(1);
	}

	const validAttemptsPerCase = parseInt(options.validAttemptsPerCase, 10);
	
	// Compute dynamic default for max attempts: 10x valid attempts if not specified
	const maxAttemptsPerCase = options.maxAttemptsPerCase 
		? parseInt(options.maxAttemptsPerCase, 10)
		: validAttemptsPerCase * 10;

	const runner = new NodeTestRunner(options.replay || !!options.replayRunId, options.provider)

	if (options.replayRunId) {
		if (!options.diffApplyFile) {
			console.error("Error: --diff-apply-file is required when using --replay-run-id")
			process.exit(1)
		}
		await runner.runDatabaseReplay(options.replayRunId, options.diffApplyFile, isVerbose)
		return
	}
	
	try {
		const startTime = Date.now()

		// Load OpenRouter model data first
		openRouterModelDataGlobal = await loadOpenRouterModelData(isVerbose);
		if (Object.keys(openRouterModelDataGlobal).length === 0 && isVerbose) {
			log(isVerbose, "Warning: Could not load OpenRouter model data. Context window filtering might be affected for OpenRouter models.");
		}

		const runner = new NodeTestRunner(options.replay, options.provider)
		let allLoadedTestCases = runner.loadTestCases(testPath, isVerbose) // Pass isVerbose
		
		const allProcessedTestCasesGlobal: ProcessedTestCase[] = allLoadedTestCases.map((tc) => ({
			...tc,
			messages: runner.transformMessages(tc.messages),
		}));

		log(isVerbose, `-Loaded ${allLoadedTestCases.length} initial test cases.`)
		log(isVerbose, `-Testing ${modelIds.length} model(s): ${modelIds.join(', ')}`)
		log(isVerbose, `-Target: ${validAttemptsPerCase} valid attempts per test case per model (will retry until this many valid attempts are collected)`)
		if (options.replay) {
			log(isVerbose, `-Running in REPLAY mode. No API calls will be made.`)
		}
		log(isVerbose, "Starting tests...\n")

		// Determine the smallest context window among all specified models
		let smallestContextWindow = Infinity;
		for (const modelId of modelIds) {
			let modelInfo = openRouterModelDataGlobal[modelId];
			if (!modelInfo) {
				const foundKey = Object.keys(openRouterModelDataGlobal).find(
					key => key.includes(modelId) || modelId.includes(key)
				);
				if (foundKey) modelInfo = openRouterModelDataGlobal[foundKey];
			}
			const currentModelContext = modelInfo?.contextWindow;
			if (currentModelContext && currentModelContext > 0) {
				if (currentModelContext < smallestContextWindow) {
					smallestContextWindow = currentModelContext;
				}
			} else {
				log(isVerbose, `Warning: Context window for model ${modelId} is unknown or zero. It will not constrain the test case selection.`);
			}
		}

		if (smallestContextWindow === Infinity) {
			log(isVerbose, "Warning: Could not determine a common smallest context window. Proceeding with all loaded cases, context issues may occur.");
		} else {
			log(isVerbose, `Smallest common context window (with padding consideration) across specified models: ${smallestContextWindow} (target for filtering: ${smallestContextWindow - 20000})`);
		}
		
		let eligibleCasesForThisRun = [...allLoadedTestCases];
		if (smallestContextWindow !== Infinity && smallestContextWindow > 20000) { // Only filter if a valid smallest window is found
			const originalCaseCount = eligibleCasesForThisRun.length;
			eligibleCasesForThisRun = eligibleCasesForThisRun.filter(tc => {
				const systemPromptText = runner.constructSystemPrompt(tc.system_prompt_details, options.systemPromptName);
				const systemPromptTokens = encoding.encode(systemPromptText).length;
				const messagesTokens = runner.estimateTokens(runner.transformMessages(tc.messages));
				const totalInputTokens = systemPromptTokens + messagesTokens;
				return totalInputTokens + 20000 <= smallestContextWindow; // 20k padding
			});
			log(isVerbose, `Filtered to ${eligibleCasesForThisRun.length} cases (from ${originalCaseCount}) to fit smallest context window of ${smallestContextWindow} (with padding).`);
		}

		// Apply max-cases limit if specified, to the context-filtered list
		if (options.maxCases && options.maxCases > 0 && eligibleCasesForThisRun.length > options.maxCases) {
			log(isVerbose, `Limiting to ${options.maxCases} test cases (out of ${eligibleCasesForThisRun.length} eligible).`);
			eligibleCasesForThisRun = eligibleCasesForThisRun.slice(0, options.maxCases);
		}

		if (eligibleCasesForThisRun.length === 0) {
			log(isVerbose, `No eligible test cases found after filtering for all specified models. Exiting.`);
			process.exit(0);
		}
		
		const processedEligibleCasesForRun: ProcessedTestCase[] = eligibleCasesForThisRun.map((tc) => ({
			...tc,
			messages: runner.transformMessages(tc.messages),
		}));

		// Initialize ONE database run for ALL models using the commonly eligible cases
		const runDescription = `Models: ${modelIds.join(', ')}, Common Cases: ${processedEligibleCasesForRun.length}, Valid attempts per case: ${validAttemptsPerCase}`;
		await runner.initializeMultiModelRun(processedEligibleCasesForRun, options.systemPromptName, options.parsingFunction, options.diffEditFunction, runDescription, isVerbose);

		// Create a global task queue
		const globalTaskQueue: EvaluationTask[] = modelIds.flatMap(modelId => 
			processedEligibleCasesForRun.map(testCase => ({
				modelId,
				testCase,
				testConfig: {
					model_id: modelId,
					system_prompt_name: options.systemPromptName,
					number_of_runs: validAttemptsPerCase,
					max_attempts_per_case: maxAttemptsPerCase,
					parsing_function: options.parsingFunction,
					diff_edit_function: options.diffEditFunction,
					thinking_tokens_budget: parseInt(options.thinkingBudget, 10),
					replay: options.replay,
				}
			}))
		);

		const results: TestResultSet = {};
		const taskStates: Record<string, { valid: number; total: number; pending: number }> = {};

		globalTaskQueue.forEach(({ modelId, testCase }) => {
			const taskId = `${modelId}-${testCase.test_id}`;
			taskStates[taskId] = { valid: 0, total: 0, pending: 0 };
			if (!results[testCase.test_id]) {
				results[testCase.test_id] = [];
			}
		});

		let remainingTasks = [...globalTaskQueue];

		while (remainingTasks.length > 0) {
			const batch: EvaluationTask[] = [];
			for (const task of remainingTasks) {
				if (batch.length >= maxConcurrency) break;
				const taskId = `${task.modelId}-${task.testCase.test_id}`;
				if ((taskStates[taskId].valid + taskStates[taskId].pending) < validAttemptsPerCase) {
					batch.push(task);
					taskStates[taskId].pending++;
				}
			}

			if (batch.length === 0) {
				await new Promise(resolve => setTimeout(resolve, 100));
				continue;
			}

			const batchPromises = batch.map(task => {
				const taskId = `${task.modelId}-${task.testCase.test_id}`;
				taskStates[taskId].total++;
				log(isVerbose, `  Attempt ${taskStates[taskId].total} for ${task.testCase.test_id} with ${task.modelId} (${taskStates[taskId].valid} valid, ${taskStates[taskId].pending - 1} pending)...`);
				return runner.runSingleTest(task.testCase, task.testConfig, isVerbose).then(result => ({
					...result,
					test_id: task.testCase.test_id,
					modelId: task.modelId,
				}));
			});

			const batchResults = await Promise.all(batchPromises);

			for (const result of batchResults) {
				const taskId = `${result.modelId}-${result.test_id}`;
				taskStates[taskId].pending--;
				results[result.test_id].push(result);

				if (runner.isValidAttempt(result)) {
					taskStates[taskId].valid++;
					log(isVerbose, `  ✓ Valid attempt ${taskStates[taskId].valid}/${validAttemptsPerCase} for ${result.test_id} with ${result.modelId} completed (${result.success ? 'SUCCESS' : 'FAILED'})`);
				} else {
					log(isVerbose, `  ✗ Invalid attempt for ${result.test_id} with ${result.modelId} (error: ${result.error || 'unknown'})`);
				}

				await runner.storeResultInDatabase(result, result.test_id, result.modelId);
			}

			remainingTasks = remainingTasks.filter(task => {
				const taskId = `${task.modelId}-${task.testCase.test_id}`;
				if (taskStates[taskId].total >= task.testConfig.max_attempts_per_case) {
					log(isVerbose, `  ⚠️ Reached maximum attempts for ${task.testCase.test_id} with ${task.modelId}.`);
					return false;
				}
				return taskStates[taskId].valid < validAttemptsPerCase;
			});

			const batchCost = batchResults.reduce((total, result) => total + (result.streamResult?.usage?.totalCost || 0), 0);
			log(isVerbose, `-Completed batch... (Batch Cost: $${batchCost.toFixed(6)}, Remaining tasks: ${remainingTasks.length})`);
		}

		// Print summary for each model
		for (const modelId of modelIds) {
			const modelResults: TestResultSet = {};
			Object.keys(results).forEach(testId => {
				modelResults[testId] = results[testId].filter(r => (r as any).modelId === modelId);
			});
			log(isVerbose, `\n=== Results for Model: ${modelId} ===`);
			runner.printSummary(modelResults, isVerbose);
		}

		const endTime = Date.now()
		const durationSeconds = ((endTime - startTime) / 1000).toFixed(2)
		log(isVerbose, `\n-Total execution time: ${durationSeconds} seconds`)

		// Save results locally if requested
		if (saveLocally) {
			runner.saveTestResults(results, outputPath);
			log(isVerbose, `✓ Results also saved to JSON files in ${outputPath}`);
		}

		log(isVerbose, `\n✓ All results stored in database. Use the dashboard to view results.`)
	} catch (error) {
		console.error("\nError running tests:", error)
		process.exit(1)
	}
}

if (require.main === module) {
	main()
}
