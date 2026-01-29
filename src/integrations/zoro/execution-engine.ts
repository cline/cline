import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { executeTool, getController, getWorkspaceDirectory, TOOL_DEFINITIONS } from "./delegates"
import { getExecuteDoPrompt } from "./prompts/execute-do"
import { getExecuteTestPrompt } from "./prompts/execute-test"
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

async function captureState(): Promise<SystemState> {
	console.log("[execution-engine] Capturing system state")

	return {
		gitDiff: "TODO: Run git diff HEAD to capture current state",
		fileHashes: {},
		timestamp: Date.now(),
	}
}

async function executeThroughCline(task: string): Promise<void> {
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

		const systemPrompt = "You are a code execution assistant. Use tools to make targeted changes to fix the gaps identified."
		const messages: any[] = [{ role: "user", content: task }]

		console.log("[execution-engine] PHASE 1: Tool-enabled execution (10 iterations max)")

		for (let i = 0; i < 5; i++) {
			console.log(`[execution-engine] Iteration ${i + 1}/10`)

			const stream = api.createMessage(systemPrompt, messages, TOOL_DEFINITIONS)

			let assistantText = ""
			const toolCallsMap = new Map<string, { name: string; args: string }>()
			let thinkingText = ""
			let thinkingSignature: string | undefined

			for await (const chunk of stream) {
				if (chunk.type === "text") {
					assistantText += chunk.text
				}
				if (chunk.type === "tool_calls") {
					const toolCall = chunk.tool_call
					const id = toolCall.function?.id || `tool_${Date.now()}`
					const name = toolCall.function?.name || ""
					const argsChunk = toolCall.function?.arguments || ""

					if (!toolCallsMap.has(id)) {
						console.log("[execution-engine] Tool:", name)
						toolCallsMap.set(id, { name, args: "" })
					}

					toolCallsMap.get(id)!.args += argsChunk
				}
				if (chunk.type === "reasoning") {
					thinkingText += chunk.reasoning || ""
					if (chunk.signature) {
						thinkingSignature = chunk.signature
					}
				}
			}

			const toolCalls = Array.from(toolCallsMap.entries()).map(([id, data]) => ({
				function: { id, name: data.name, arguments: data.args },
			}))

			const assistantContent: any[] = []

			if (thinkingText && thinkingText.trim()) {
				const thinkingBlock: any = { type: "thinking", thinking: thinkingText.trim() }
				if (thinkingSignature) {
					thinkingBlock.signature = thinkingSignature
				}
				assistantContent.push(thinkingBlock)
			}

			if (assistantText && assistantText.trim()) {
				assistantContent.push({ type: "text", text: assistantText.trim() })
			}

			for (const toolCall of toolCalls) {
				let toolInput: any = {}
				try {
					toolInput = JSON.parse(toolCall.function?.arguments || "{}")
				} catch {
					continue
				}

				const toolResult = await executeTool(toolCall.function.name, toolInput)

				assistantContent.push({
					type: "tool_use",
					id: toolCall.function.id,
					name: toolCall.function.name,
					input: toolInput,
				})
			}

			// CRITICAL FIX: Anthropic API rejects if last content is a thinking block
			if (assistantContent.length > 0 && assistantContent[assistantContent.length - 1].type === "thinking") {
				assistantContent.push({ type: "text", text: "." })
			}

			if (assistantContent.length > 0) {
				messages.push({ role: "assistant", content: assistantContent })
			}

			for (const toolCall of toolCalls) {
				let toolInput: any = {}
				try {
					toolInput = JSON.parse(toolCall.function?.arguments || "{}")
				} catch {
					continue
				}

				const toolResult = await executeTool(toolCall.function.name, toolInput)

				messages.push({
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: toolCall.function.id,
							content: toolResult,
						},
					],
				})
			}

			if (toolCalls.length === 0) {
				console.log("[execution-engine] No more tools requested, stopping")
				break
			}
		}

		console.log("[execution-engine] ✅ Execution complete")
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

		// Step 4: PHASE 1 - Tool-enabled test generation and execution
		console.log("[execution-engine] PHASE 1: Generate and run tests (with tools)")
		await executeThroughCline(testPrompt)

		// Step 5: PHASE 2 - Force structured JSON response
		console.log("[execution-engine] PHASE 2: Extract structured test results")
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
				} catch (parseError) {
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
					} catch (parseError) {
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

function stripMarkdownJson(text: string): string {
	const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
	if (jsonMatch) {
		return jsonMatch[1].trim()
	}

	const codeMatch = text.match(/```\s*([\s\S]*?)\s*```/)
	if (codeMatch) {
		return codeMatch[1].trim()
	}

	return text.trim()
}

async function detectChanges(
	beforeState: SystemState,
	afterState: SystemState,
): Promise<{
	files_summary: Array<{ path: string; lines_changed: string; changes: string; impact: string; substeps_fulfilled: string[] }>
	code_blocks: Array<{ file: string; lines: string; code: string; annotation: string }>
}> {
	console.log("[execution-engine] Detecting changes")
	console.log("Before timestamp:", beforeState.timestamp)
	console.log("After timestamp:", afterState.timestamp)

	return {
		files_summary: [],
		code_blocks: [],
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
	if (!cached) return null

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
