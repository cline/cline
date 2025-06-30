import { OpenRouterHandler } from "../../src/api/providers/openrouter"
import { ApiHandlerOptions } from "../../src/shared/api"
import { Anthropic } from "@anthropic-ai/sdk"

import {
	parseAssistantMessageV1,
	parseAssistantMessageV2,
	parseAssistantMessageV3,
	AssistantMessageContent,
} from "./parsing/parse-assistant-message-06-06-25" // "../../src/core/assistant-message"
import { constructNewFileContent as constructNewFileContent_06_06_25 } from "./diff-apply/diff-06-06-25"
import { constructNewFileContent as constructNewFileContent_06_23_25 } from "./diff-apply/diff-06-23-25"
import { constructNewFileContent as constructNewFileContent_06_25_25 } from "./diff-apply/diff-06-25-25"
import { constructNewFileContent as constructNewFileContent_06_26_25 } from "./diff-apply/diff-06-26-25"

type ParseAssistantMessageFn = (message: string) => AssistantMessageContent[]
type ConstructNewFileContentFn = (diff: string, original: string, strict: boolean) => Promise<string | any>

const parsingFunctions: Record<string, ParseAssistantMessageFn> = {
	parseAssistantMessageV1: parseAssistantMessageV1,
	parseAssistantMessageV2: parseAssistantMessageV2,
	parseAssistantMessageV3: parseAssistantMessageV3,
}

const diffEditingFunctions: Record<string, ConstructNewFileContentFn> = {
	"diff-06-06-25": constructNewFileContent_06_06_25,
	"diff-06-23-25": constructNewFileContent_06_23_25,
	"diff-06-25-25": constructNewFileContent_06_25_25,
	"diff-06-26-25": constructNewFileContent_06_26_25,
}

import { TestInput, TestResult, ExtractedToolCall } from "./types"
export { TestInput, TestResult, ExtractedToolCall }

interface StreamResult {
	assistantMessage: string
	reasoningMessage: string
	usage: {
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
		totalCost: number
	}
	timing?: {
		timeToFirstTokenMs: number
		timeToFirstEditMs?: number
		totalRoundTripMs: number
	}
}

/**
 * Process the stream and return full response with timing data
 */
async function processStream(
	handler: OpenRouterHandler,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
): Promise<StreamResult> {
	const startTime = Date.now()
	const stream = handler.createMessage(systemPrompt, messages)

	let assistantMessage = ""
	let reasoningMessage = ""
	let inputTokens = 0
	let outputTokens = 0
	let cacheWriteTokens = 0
	let cacheReadTokens = 0
	let totalCost = 0
	
	// Timing tracking
	let timeToFirstTokenMs: number | null = null
	let timeToFirstEditMs: number | null = null

	for await (const chunk of stream) {
		if (!chunk) {
			continue
		}

		// Capture time to first token (any chunk type)
		if (timeToFirstTokenMs === null) {
			timeToFirstTokenMs = Date.now() - startTime
		}

		switch (chunk.type) {
			case "usage":
				inputTokens += chunk.inputTokens
				outputTokens += chunk.outputTokens
				cacheWriteTokens += chunk.cacheWriteTokens ?? 0
				cacheReadTokens += chunk.cacheReadTokens ?? 0
				if (chunk.totalCost) {
					totalCost = chunk.totalCost
				}
				break
			case "reasoning":
				reasoningMessage += chunk.reasoning
				break
			case "text":
				assistantMessage += chunk.text
				
				// Try to detect first tool call by parsing accumulated message
				if (timeToFirstEditMs === null) {
					try {
						const parsed = parseAssistantMessageV2(assistantMessage)
						const hasToolCall = parsed.some(block => block.type === "tool_use")
						if (hasToolCall) {
							timeToFirstEditMs = Date.now() - startTime
						}
					} catch {
						// Parsing failed, continue accumulating
					}
				}
				break
		}
	}

	const totalRoundTripMs = Date.now() - startTime

	return {
		assistantMessage,
		reasoningMessage,
		usage: {
			inputTokens,
			outputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			totalCost,
		},
		timing: {
			timeToFirstTokenMs: timeToFirstTokenMs || 0,
			timeToFirstEditMs: timeToFirstEditMs || undefined,
			totalRoundTripMs,
		},
	}
}

/**
 * Main evaluation function:
 * 1. create and process stream
 * 2. extract any tool calls from the stream
 * 3. if no diff edit, considered a failure (or rerun) - otherwise attempt to apply the diff edit
 */
export async function runSingleEvaluation(input: TestInput): Promise<TestResult> {
	try {
		// Extract parameters
		const {
			apiKey,
			systemPrompt,
			messages,
			modelId,
			originalFile,
			originalFilePath,
			parsingFunction,
			diffEditFunction,
			thinkingBudgetTokens,
			originalDiffEditToolCallMessage,
			diffApplyFile,
		} = input

		const requiredParams = {
			systemPrompt,
			messages,
			modelId,
			originalFile,
			originalFilePath,
			parsingFunction,
			diffEditFunction,
		}

		const missingParams = Object.entries(requiredParams)
			.filter(([, value]) => !value)
			.map(([key]) => key)

		if (missingParams.length > 0) {
			return {
				success: false,
				error: "missing_required_parameters",
				errorString: `Missing required parameters: ${missingParams.join(", ")}`,
			}
		}

		const parseAssistantMessage = parsingFunctions[parsingFunction]
		const constructNewFileContent = diffEditingFunctions[diffApplyFile || diffEditFunction]

		if (!parseAssistantMessage || !constructNewFileContent) {
			return {
				success: false,
				error: "invalid_functions",
			}
		}

		const options: ApiHandlerOptions = {
			openRouterApiKey: apiKey,
			openRouterModelId: modelId,
			thinkingBudgetTokens: thinkingBudgetTokens,
			openRouterModelInfo: {
				maxTokens: 10_000,
				contextWindow: 1_000_000,
				supportsImages: true,
				supportsPromptCache: true, // may need to turn this on
				inputPrice: 0,
				outputPrice: 0,
			},
		}

		// Get the output of streaming output of this llm call
		let streamResult: StreamResult
		if (originalDiffEditToolCallMessage !== undefined) {
			// Replay mode: mock the stream result
			streamResult = {
				assistantMessage: originalDiffEditToolCallMessage,
				reasoningMessage: "",
				usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, totalCost: 0 },
			}
		} else {
			// Live mode: existing API call logic
			try {
				const openRouterHandler = new OpenRouterHandler(options)
				streamResult = await processStream(openRouterHandler, systemPrompt, messages)
			} catch (error: any) {
				return {
					success: false,
					error: "llm_stream_error",
					errorString: error.message || error.toString(),
				}
			}
		}

		// process the assistant message into its constituent tool calls & text blocks
		const assistantContentBlocks: AssistantMessageContent[] = parseAssistantMessage(streamResult.assistantMessage)

		const detectedToolCalls: ExtractedToolCall[] = []

		for (const block of assistantContentBlocks) {
			if (block.type === "tool_use") {
				detectedToolCalls.push({
					name: block.name,
					input: block.params,
				})
			}
		}

		// check if there are any tool calls, if there are none then its a clear error
		if (detectedToolCalls.length === 0) {
			return {
				success: false,
				streamResult: streamResult,
				toolCalls: detectedToolCalls,
				error: "no_tool_calls",
			}
		}

		// check that there is exactly one tool call, otherwise an error
		if (detectedToolCalls.length > 1) {
			return {
				success: false,
				streamResult: streamResult,
				toolCalls: detectedToolCalls,
				error: "multi_tool_calls",
			}
		}

		// check that the tool call is diff edit tool call
		if (detectedToolCalls[0].name !== "replace_in_file") {
			return {
				success: false,
				streamResult: streamResult,
				toolCalls: detectedToolCalls,
				error: "wrong_tool_call",
			}
		}

		const toolCall = detectedToolCalls[0]
		const diffToolPath = toolCall.input.path
		const diffToolContent = toolCall.input.diff

		if (!diffToolPath || !diffToolContent) {
			return {
				success: false,
				streamResult: streamResult,
				toolCalls: detectedToolCalls,
				error: "tool_call_params_undefined",
			}
		}

		// check that we are editing the correct file path
		console.log(`Expected file path: "${originalFilePath}"`);
		console.log(`Actual file path used: "${diffToolPath}"`);
		if (diffToolPath !== originalFilePath) {
			console.log(`❌ File path mismatch detected!`);
			// Enhanced logging:
			if (streamResult?.assistantMessage) {
				console.log(`   Full model output (assistantMessage):`);
				console.log(`   -----------------------------------------`);
				console.log(`   ${streamResult.assistantMessage}`);
				console.log(`   -----------------------------------------`);
			}
			if (toolCall) {
				console.log(`   Parsed tool call that caused mismatch:`);
				console.log(`   ${JSON.stringify(toolCall, null, 2)}`);
				console.log(`   -----------------------------------------`);
			}
			return {
				success: false,
				streamResult: streamResult,
				toolCalls: detectedToolCalls,
				error: "wrong_file_edited",
			}
		}

		// checking if the diff edit succeeds, if it failed it will throw an error
		let diffSuccess = true
		let replacementData: any = undefined
		try {
			const result = await constructNewFileContent(diffToolContent, originalFile, true)
			
			// Check if result is an object with replacements (new format)
			if (typeof result === 'object' && result !== null && 'replacements' in result) {
				replacementData = result.replacements
			}
			// If it's just a string, diffSuccess stays true and replacementData stays undefined
		} catch (error: any) {
			diffSuccess = false
			console.log("ERROR:",error)
		}

		return {
			success: true,
			streamResult: streamResult,
			toolCalls: detectedToolCalls,
			diffEdit: diffToolContent,
			diffEditSuccess: diffSuccess,
			replacementData: replacementData,
		}
	} catch (error: any) {
		return {
			success: false,
			error: "other_error",
			errorString: error.message || error.toString(),
		}
	}
}
