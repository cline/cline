import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { executeTool, getController, getWorkspaceDirectory, TOOL_DEFINITIONS } from "./delegates"
import { getExecuteDoPrompt } from "./prompts/execute-do"
import { getExecuteTestPrompt } from "./prompts/execute-test"
import type { ConversationMessage } from "./providers/base"
import { getProviderAdapter } from "./providers/factory"
import { EnforcementRequest, EnforcementResponse } from "./types"
import { runVerification } from "./verification-engine"

export async function executeAndVerify(request: EnforcementRequest): Promise<EnforcementResponse> {
	try {
		console.log("[execution-engine] 🔧 DO Flow: executeAndVerify")

		// Step 1: Run verification to identify gaps
		console.log("[execution-engine] Step 1: Running initial verification")
		const initialVerification = await runVerification(request)

		// If already done, no need to execute
		if (initialVerification.verdict === "done") {
			console.log("[execution-engine] Already done, returning verification")
			return initialVerification
		}

		// Step 2: Build gap-focused prompt from verification result
		console.log("[execution-engine] Step 2: Building gap-focused prompt")
		const stepDescription = request.node?.description || ""
		const substepDescription = request.substep_id
			? request.node?.substeps?.find((s) => s.id === request.substep_id)?.text
			: undefined

		const gapPrompt = getExecuteDoPrompt(initialVerification, stepDescription, substepDescription)

		// Step 3: Execute changes through Cline
		console.log("[execution-engine] Step 3: Executing fixes through Cline")
		await executeThroughCline(gapPrompt)

		// Step 4: Run verification again to check if gaps are fixed
		console.log("[execution-engine] Step 4: Running post-execution verification")
		const finalVerification = await runVerification(request)

		console.log("[execution-engine] ✅ DO Flow complete, new verdict:", finalVerification.verdict)
		return finalVerification
	} catch (error) {
		console.error("[execution-engine] Error:", error)
		return {
			verdict: "unclear",
			overview: `## Execution Failed\n- Error: ${error instanceof Error ? error.message : "Unknown error"}`,
			rules_analysis: [],
			files_summary: [],
			code_blocks: [],
		}
	}
}

interface SystemState {
	gitDiff: string
	fileHashes: Record<string, string>
	timestamp: number
}

async function _captureState(): Promise<SystemState> {
	console.log("[execution-engine] Capturing system state")

	return {
		gitDiff: "TODO: Run git diff HEAD to capture current state",
		fileHashes: {},
		timestamp: Date.now(),
	}
}

async function executeThroughCline(
	task: string,
	maxIterations: number = 10,
	existingMessages?: ConversationMessage[],
): Promise<ConversationMessage[]> {
	console.log("[execution-engine] 🚀 START executeThroughCline")

	try {
		const controller = getController()
		if (!controller || !controller.task) {
			throw new Error("No active Cline task")
		}

		const api = controller.task.api
		if (!api) {
			throw new Error("No LLM API available")
		}

		// 🎯 Get provider adapter for this API
		const adapter = getProviderAdapter(api)
		console.log(`[execution-engine] Using ${adapter.name} provider adapter`)

		const systemPrompt = "You are a code execution assistant. Use tools to make targeted changes to fix the gaps identified."
		const messages: ConversationMessage[] = existingMessages || [{ role: "user", content: [{ type: "text", text: task }] }]

		console.log(`[execution-engine] PHASE 1: Tool-enabled execution (${maxIterations} iterations max)`)

		for (let i = 0; i < maxIterations; i++) {
			console.log(`[execution-engine] Iteration ${i + 1}/${maxIterations}`)

			// 🎯 Prepare messages using provider adapter
			const preparedMessages = adapter.prepareMessages(messages)

			const stream = api.createMessage(systemPrompt, preparedMessages, TOOL_DEFINITIONS)

			// 🎯 Consume stream using provider adapter
			const streamResult = await adapter.consumeStream(stream, {
				onText: () => {
					// Optional: log text chunks
				},
				onToolCall: (_id, name) => {
					console.log("[execution-engine] Tool:", name)
				},
				onThinking: () => {
					// Optional: log thinking
				},
				onComplete: () => {
					// Stream complete
				},
			})

			// 🎯 Validate tool calls using provider adapter (e.g., filter malformed JSON)
			const validToolCalls = adapter.validateToolCalls
				? adapter.validateToolCalls(streamResult.toolCalls)
				: streamResult.toolCalls

			console.log(`[execution-engine] Valid tool calls: ${validToolCalls.length}/${streamResult.toolCalls.length}`)

			// Execute tools and collect results (ONLY valid tools)
			const toolExecutions: Array<{
				id: string
				name: string
				input: any
				result: string
			}> = []

			for (const toolCall of validToolCalls) {
				try {
					const toolInput = JSON.parse(toolCall.arguments)
					const toolResult = await executeTool(toolCall.name, toolInput)

					toolExecutions.push({
						id: toolCall.id,
						name: toolCall.name,
						input: toolInput,
						result: toolResult,
					})
				} catch (error) {
					console.error("[execution-engine] Tool execution failed:", error)
					toolExecutions.push({
						id: toolCall.id,
						name: toolCall.name,
						input: {},
						result: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
					})
				}
			}

			// 🎯 Build assistant message using provider adapter (SAME valid tools)
			const assistantMessage = adapter.buildAssistantMessage(
				streamResult.text,
				validToolCalls,
				streamResult.thinking,
				streamResult.thinkingSignature,
			)

			messages.push(assistantMessage)

			// 🎯 Add tool results using provider adapter
			if (toolExecutions.length > 0) {
				const toolResultMessage = adapter.buildToolResultMessage(toolExecutions)
				messages.push(toolResultMessage)
			}

			// Add iteration tracking after tool results
			if (streamResult.toolCalls.length > 0 && i < maxIterations - 1) {
				const iterationMsg =
					i >= maxIterations - 2
						? `[System: Iteration ${i + 1} of ${maxIterations}. ⚠️ FINAL ITERATION - complete your task now!]`
						: `[System: Iteration ${i + 1} of ${maxIterations}]`

				messages.push({
					role: "user",
					content: [{ type: "text", text: iterationMsg }],
				})
			}

			if (validToolCalls.length === 0) {
				console.log("[execution-engine] No more valid tools requested, stopping")
				break
			}
		}

		console.log("[execution-engine] ✅ Execution complete")
		return messages
	} catch (error) {
		console.error("[execution-engine] Error:", error)
		throw error
	}
}

export async function generateAndRunTests(request: EnforcementRequest, cachedVerification?: EnforcementResponse): Promise<any> {
	try {
		console.log("[execution-engine] 🧪 TEST Flow: generateAndRunTests")

		// Step 1: Use cached verification if available, otherwise run verification
		let verification: EnforcementResponse
		if (cachedVerification) {
			console.log("[execution-engine] Step 1: Using cached verification (skipping expensive re-verification!)")
			verification = cachedVerification
		} else {
			console.log("[execution-engine] Step 1: Running verification")
			verification = await runVerification(request)
		}

		// Step 2: Build test file path
		const workspaceDir = getWorkspaceDirectory()
		const chatId = request.chat_id
		const nodeId = request.step_id || "unknown"
		const substepId = request.substep_id || "step"
		const testFileName = `${nodeId}-${substepId}_test.py`
		const testFilePath = path.join(".zoro", "generated", "assistant", chatId, "test", testFileName)
		const absoluteTestPath = path.join(workspaceDir, testFilePath)

		console.log("[execution-engine] Test file:", testFilePath)

		// Step 3: Build test generation prompt
		const stepDescription = request.node?.description || ""
		const substepDescription = request.substep_id
			? request.node?.substeps?.find((s) => s.id === request.substep_id)?.text
			: undefined

		const testPrompt = getExecuteTestPrompt(
			verification,
			stepDescription,
			substepDescription,
			workspaceDir,
			testFilePath,
			chatId,
			nodeId,
			substepId,
		)

		// Step 4: PHASE 1 - Three-stage test generation (like verification's two phases)
		console.log("[execution-engine] PHASE 1: Three-stage test generation")

		// Stage 1: Research (3 iterations)
		console.log("[execution-engine] Stage 1: Research implementation (3 iterations)")
		let messages = await executeThroughCline(testPrompt, 3)

		// Stage 2: Write test file (3 iterations)
		console.log("[execution-engine] Stage 2: Write test file (3 iterations)")
		messages.push({
			role: "user",
			content: [
				{
					type: "text",
					text: `Now you MUST write the test file to: ${testFilePath}

Use the write_to_file tool. This is CRITICAL - the file must be created at this exact path.`,
				},
			],
		})
		messages = await executeThroughCline("", 3, messages)

		// Stage 3: Run test (1 iteration)
		console.log("[execution-engine] Stage 3: Run test (1 iteration)")
		messages.push({
			role: "user",
			content: [{ type: "text", text: `Now run the test file: python ${testFilePath}` }],
		})
		messages = await executeThroughCline("", 1, messages)

		// Fallback: If file doesn't exist, create minimal test
		if (!fs.existsSync(absoluteTestPath)) {
			console.log("[execution-engine] ⚠️ Test file not created, creating minimal fallback test")
			fs.mkdirSync(path.dirname(absoluteTestPath), { recursive: true })
			const minimalTest = `import sys
import json
import unittest

sys.path.insert(0, '${workspaceDir}')

def print_test_result(name, status, description):
    result = {"name": name, "status": status, "description": description, "category": "general"}
    print(f"TEST_RESULT: {json.dumps(result)}")

class FallbackTest(unittest.TestCase):
    def test_generation_failed(self):
        print_test_result("test_generation_failed", "fail", "LLM did not generate test file")
        self.fail("Test file was not created by LLM")

if __name__ == '__main__':
    unittest.main()
`
			fs.writeFileSync(absoluteTestPath, minimalTest)
		}

		// Step 5: PHASE 2 - Extract test results
		console.log("[execution-engine] PHASE 2: Extract test results")
		const testResults = await extractTestResults(absoluteTestPath)

		console.log("[execution-engine] ✅ TEST Flow complete")
		return {
			test_file: testFilePath,
			results: testResults,
		}
	} catch (error) {
		console.error("[execution-engine] Test generation error:", error)
		return {
			test_file: "",
			results: [],
			error: error instanceof Error ? error.message : "Unknown error",
		}
	}
}

async function extractTestResults(testFilePath: string): Promise<any[]> {
	console.log("[execution-engine] Extracting test results from:", testFilePath)

	// Check if test file exists
	if (!fs.existsSync(testFilePath)) {
		console.log("[execution-engine] Test file not found")
		return []
	}

	try {
		const workspaceDir = getWorkspaceDirectory()

		console.log("[execution-engine] Executing test file:", testFilePath)
		console.log("[execution-engine] Working directory:", workspaceDir)

		// Execute test from workspace directory (so imports work!)
		// Use same pattern as loadGitDiff in verification-engine.ts
		const output = execSync(`python "${testFilePath}"`, {
			cwd: workspaceDir,
			env: {
				...process.env,
				PYTHONPATH: workspaceDir, // Ensure workspace directory is first in Python's import path
			},
			encoding: "utf-8",
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			timeout: 120000, // 120s timeout
		})

		console.log("[execution-engine] Test execution completed")

		// Parse TEST_RESULT: lines from stdout
		const results: any[] = []
		const lines = output.split("\n")

		for (const line of lines) {
			if (line.includes("TEST_RESULT:")) {
				try {
					const jsonStr = line.split("TEST_RESULT:")[1].trim()
					const result = JSON.parse(jsonStr)
					results.push(result)
				} catch (_parseError) {
					console.warn("[execution-engine] Failed to parse TEST_RESULT line:", line)
				}
			}
		}

		console.log(`[execution-engine] Extracted ${results.length} test results from stdout`)
		return results
	} catch (error: any) {
		console.error("[execution-engine] Test execution failed:", error)

		// Try to extract partial results from error output
		const output = error.stdout || error.output?.[1] || ""
		if (output) {
			const results: any[] = []
			const lines = output.split("\n")

			for (const line of lines) {
				if (line.includes("TEST_RESULT:")) {
					try {
						const jsonStr = line.split("TEST_RESULT:")[1].trim()
						const result = JSON.parse(jsonStr)
						results.push(result)
					} catch (_parseError) {
						// Skip unparseable lines
					}
				}
			}

			if (results.length > 0) {
				console.log(`[execution-engine] Extracted ${results.length} partial test results from failed execution`)
				return results
			}
		}

		// Return empty on complete failure
		return []
	}
}

const executionCache = new Map<string, { timestamp: number; result: any }>()
const CACHE_TTL = 60000

export function cacheExecution(requestId: string, result: any): void {
	executionCache.set(requestId, {
		timestamp: Date.now(),
		result,
	})
}

export function getCachedExecution(requestId: string): any | null {
	const cached = executionCache.get(requestId)
	if (!cached) {
		return null
	}

	if (Date.now() - cached.timestamp > CACHE_TTL) {
		executionCache.delete(requestId)
		return null
	}

	return cached.result
}

export function generateRequestId(request: any): string {
	const key = JSON.stringify({
		task: request.task,
		context: request.context,
		timestamp: Math.floor(Date.now() / 10000),
	})
	return Buffer.from(key).toString("base64").substring(0, 32)
}
