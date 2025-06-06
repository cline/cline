import { OpenRouterHandler } from "../../src/api/providers/openrouter"
import { ApiHandlerOptions } from "../../src/shared/api"
import { Anthropic } from "@anthropic-ai/sdk"

import {
	parseAssistantMessageV1,
	parseAssistantMessageV2,
	parseAssistantMessageV3,
	AssistantMessageContent,
	ToolUseName,
	ToolParamName,
} from "../../src/core/assistant-message"
import { constructNewFileContentV2 } from "../../src/core/assistant-message/diff"

type ParseAssistantMessageFn = (message: string) => AssistantMessageContent[]
type ConstructNewFileContentFn = (diff: string, original: string, strict: boolean) => Promise<string>

const parsingFunctions: Record<string, ParseAssistantMessageFn> = {
	parseAssistantMessageV1: parseAssistantMessageV1,
	parseAssistantMessageV2: parseAssistantMessageV2,
	parseAssistantMessageV3: parseAssistantMessageV3,
}

const diffEditingFunctions: Record<string, ConstructNewFileContentFn> = {
	constructNewFileContentV2: constructNewFileContentV2,
}

interface ExtractedToolCall {
	name: ToolUseName
	input: Partial<Record<ToolParamName, string>>
}

export interface TestInput {
	apiKey: string
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	modelId: string
	originalFile: string
	originalFilePath: string
	parsingFunction: string
	diffEditFunction: string
}

export interface TestResult {
	success: boolean
	result?: any
	diffEdit?: string
	toolCalls?: ExtractedToolCall[]
	diffEditSuccess?: boolean
	error?: string
	errorString?: string
}

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
}

/**
 * Process the stream and return full response
 */
async function processStream(
	handler: OpenRouterHandler,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
): Promise<StreamResult> {
	const stream = handler.createMessage(systemPrompt, messages)

	let assistantMessage = ""
	let reasoningMessage = ""
	let inputTokens = 0
	let outputTokens = 0
	let cacheWriteTokens = 0
	let cacheReadTokens = 0
	let totalCost = 0

	for await (const chunk of stream) {
		if (!chunk) {
			continue
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
				break
		}
	}

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
		const { apiKey, systemPrompt, messages, modelId, originalFile, originalFilePath, parsingFunction, diffEditFunction } =
			input

		if (
			!apiKey ||
			!messages ||
			!modelId ||
			!systemPrompt ||
			!originalFile ||
			!originalFilePath ||
			!parsingFunction ||
			!diffEditFunction
		) {
			return {
				success: false,
				error: "missing_required_parameters",
			}
		}

		const parseAssistantMessage = parsingFunctions[parsingFunction]
		const constructNewFileContent = diffEditingFunctions[diffEditFunction]

		if (!parseAssistantMessage || !constructNewFileContent) {
			return {
				success: false,
				error: "invalid_functions",
			}
		}

		const options: ApiHandlerOptions = {
			openRouterApiKey: apiKey,
			openRouterModelId: modelId,
			// reasoningEffort: "medium", // may need to turn this on
			openRouterModelInfo: {
				maxTokens: 10_000,
				contextWindow: 1_000_000,
				supportsImages: true,
				supportsPromptCache: false, // may need to turn this on
				inputPrice: 0,
				outputPrice: 0,
			},
		}

		const openRouterHandler = new OpenRouterHandler(options)

		// Get the output of streaming output of this llm call
		let result: StreamResult
		try {
			result = await processStream(openRouterHandler, systemPrompt, messages)
		} catch (error: any) {
			return {
				success: false,
				error: "llm_stream_error",
				errorString: error.message || error.toString(),
			}
		}

		// process the assistant message into its constituent tool calls & text blocks
		const assistantContentBlocks: AssistantMessageContent[] = parseAssistantMessage(result.assistantMessage)

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
				toolCalls: detectedToolCalls,
				error: "no_tool_calls",
			}
		}

		// check that there is exactly one tool call, otherwise an error
		if (detectedToolCalls.length > 1) {
			return {
				success: false,
				toolCalls: detectedToolCalls,
				error: "multi_tool_calls",
			}
		}

		// check that the tool call is diff edit tool call
		if (detectedToolCalls[0].name !== "replace_in_file") {
			return {
				success: false,
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
				toolCalls: detectedToolCalls,
				error: "tool_call_params_undefined",
			}
		}

		// check that we are editing the correct file path
		if (diffToolPath !== originalFilePath) {
			return {
				success: false,
				toolCalls: detectedToolCalls,
				error: "wrong_file_edited",
			}
		}

		// checking if the diff edit succeeds, if it failed it will throw an error
		let diffSuccess = true
		try {
			await constructNewFileContent(diffToolContent, originalFile, true)
		} catch (error: any) {
			diffSuccess = false
		}

		return {
			success: true,
			result: result,
			toolCalls: detectedToolCalls,
			diffEdit: diffToolContent,
			diffEditSuccess: diffSuccess,
		}
	} catch (error: any) {
		return {
			success: false,
			error: "other_error",
			errorString: error.message || error.toString(),
		}
	}
}
