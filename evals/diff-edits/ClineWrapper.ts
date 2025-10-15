import { OpenRouterHandler } from "../../src/core/api/providers/openrouter";
import { OpenAiNativeHandler } from "../../src/core/api/providers/openai-native";
import { Anthropic } from "@anthropic-ai/sdk";
import type { ModelInfo } from "../../src/shared/api";
import { calculateApiCostOpenAI } from "../../src/utils/cost";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";

import {
	parseAssistantMessageV2,
	AssistantMessageContent,
} from "./parsing/parse-assistant-message-06-06-25"; // "../../src/core/assistant-message"
import { formatToolCallXml } from "../../src/core/api/transform/tool-call";
import { constructNewFileContent as constructNewFileContent_06_06_25 } from "./diff-apply/diff-06-06-25";
import { constructNewFileContent as constructNewFileContent_06_23_25 } from "./diff-apply/diff-06-23-25";
import { constructNewFileContent as constructNewFileContent_06_25_25 } from "./diff-apply/diff-06-25-25";
import { constructNewFileContent as constructNewFileContent_06_26_25 } from "./diff-apply/diff-06-26-25";
import { constructNewFileContent as constructNewFileContentV3 } from "../../src/core/assistant-message/diff";

type ParseAssistantMessageFn = (message: string) => AssistantMessageContent[]
type ConstructNewFileContentFn = (diff: string, original: string, strict: boolean) => Promise<string | any>

const parsingFunctions: Record<string, ParseAssistantMessageFn> = {
	parseAssistantMessageV2: parseAssistantMessageV2,
}

const diffEditingFunctions: Record<string, ConstructNewFileContentFn> = {
	"diff-06-06-25": constructNewFileContent_06_06_25,
	"diff-06-23-25": constructNewFileContent_06_23_25,
	"diff-06-25-25": constructNewFileContent_06_25_25,
	"diff-06-26-25": constructNewFileContent_06_26_25,
    "constructNewFileContentV1": constructNewFileContent_06_23_25,
    "constructNewFileContentV2": constructNewFileContent_06_26_25,
}

import { TestInput, TestResult, ExtractedToolCall } from "./types";
import { log } from "./helpers";
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
	functionCalls?: { name: string; input: Record<string, unknown>; raw?: string; callId?: string }[]
}

interface AggregatedUsage {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost: number
}

interface AggregatedConversation {
	assistantPieces: string[]
	reasoningPieces: string[]
}

interface DiffEvaluationState {
	attempted: boolean
	success: boolean
	pathMatched: boolean
	errorType?: string
	errorMessage?: string
	diffContent?: string
	replacementData?: any
}

const MAX_OPENAI_TOOL_ITERATIONS = 6

function normalizePathForComparison(value?: string): string {
	if (!value) return ""
	let cleaned = value.trim()
	cleaned = cleaned.replace(/^['"`]+/, "").replace(/['"`]+$/, "")
	if (cleaned.startsWith("./")) {
		cleaned = cleaned.slice(2)
	}
	return cleaned
}

function extractFunctionCallsFromResponseOutput(output: any): any[] {
	const calls: any[] = []
	if (!Array.isArray(output)) {
		return calls
	}
	for (const item of output) {
		if (!item) continue
		if (item.type === "function_call" || item.type === "tool_call") {
			calls.push(item)
		}
	}
	return calls
}

function sanitizeSearchLineForEnvFallbacks(line: string): string {
	if (!line.includes("process.env") || !line.includes("||")) {
		return line
	}
	const commentIndex = line.indexOf("//")
	let comment = ""
	let core = line
	if (commentIndex >= 0) {
		comment = line.slice(commentIndex)
		core = line.slice(0, commentIndex)
	}
	let sanitized = core.replace(/\s*\|\|[^,\n]+(?=,|\n|$)/g, "")
	sanitized = sanitized.replace(/\s+,/g, ",")
	sanitized = sanitized.replace(/\s+$/, "")
	if (comment) {
		sanitized = sanitized.endsWith(" ") ? sanitized : `${sanitized} `
		sanitized += comment.trimStart()
	}
	return sanitized
}

function normalizeSearchBlocksForMatching(diff: string): string {
	const lines = diff.split("\n")
	let inSearch = false
	return lines
		.map((line) => {
			if (line.startsWith("------- SEARCH")) {
				inSearch = true
				return line
			}
			if (line.startsWith("=======")) {
				inSearch = false
				return line
			}
			if (!inSearch) {
				return line
			}
			return sanitizeSearchLineForEnvFallbacks(line)
		})
		.join("\n")
}

function normalizeFunctionCall(rawCall: any): ExtractedToolCall {
	let toolName =
		typeof rawCall?.name === "string"
			? rawCall.name
			: typeof rawCall?.function?.name === "string"
				? rawCall.function.name
				: ""
	let rawArgs =
		rawCall?.arguments ??
		rawCall?.function?.arguments ??
		{}
	if (toolName === "call_tool" || toolName === "tool_call") {
		const maybeToolName =
			typeof rawCall?.function?.tool_name === "string"
				? rawCall.function.tool_name
				: typeof rawCall?.function?.name === "string"
					? rawCall.function.name
					: ""
		const maybeArgs = rawCall?.function?.arguments ?? rawArgs
		if (maybeToolName) {
			toolName = maybeToolName
		}
		rawArgs = maybeArgs
	}
	const parsedArgs = parseFunctionCallArguments(rawArgs)
	const sanitizedArgs = sanitizeArguments(parsedArgs)
	const callId =
		(typeof rawCall?.call_id === "string" && rawCall.call_id) ||
		(typeof rawCall?.id === "string" && rawCall.id.startsWith("call_") ? rawCall.id : undefined) ||
		`call_${Math.random().toString(36).slice(2)}`
	return {
		name: toolName as any,
		input: sanitizedArgs as any,
		callId,
		rawArguments:
			typeof rawArgs === "string"
				? rawArgs
				: (() => {
					try {
						return JSON.stringify(rawArgs ?? {})
					} catch {
						return "{}"
					}
				})(),
	}
}

function parseFunctionCallArguments(raw: unknown): Record<string, unknown> {
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw)
		} catch {
			return {}
		}
	}
	if (raw && typeof raw === "object") {
		return { ...(raw as Record<string, unknown>) }
	}
	return {}
}

function sanitizeArguments(value: Record<string, unknown>): Record<string, unknown> {
	const sanitized: Record<string, unknown> = {}
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw === "string") {
			sanitized[key] = raw.trim()
		} else if (Array.isArray(raw)) {
			sanitized[key] = raw.map((entry) => (typeof entry === "string" ? entry.trim() : entry))
		} else if (raw && typeof raw === "object") {
			sanitized[key] = sanitizeArguments(raw as Record<string, unknown>)
		} else {
			sanitized[key] = raw
		}
	}
	return sanitized
}

function aggregateResponseOutput(response: OpenAIResponse, conversation: AggregatedConversation) {
	const appendText = (target: string[], text?: string) => {
		if (text && text.length > 0) {
			target.push(text)
		}
	}
	const processContent = (content: any, target: string[]) => {
		if (!content) return
		if (Array.isArray(content)) {
			for (const part of content) {
				processContent(part, target)
			}
			return
		}
		if (typeof content === "string") {
			appendText(target, content)
			return
		}
		if (typeof content !== "object") {
			return
		}
		if (typeof content.text === "string") {
			appendText(target, content.text)
		}
		if (content.content) {
			processContent(content.content, target)
		}
	}

	if (!response?.output) {
		return
	}
	for (const item of response.output as any[]) {
		if (!item) continue
		if (item.type === "message" && item.role === "assistant") {
			const content = (item as any).content || []
			for (const part of content) {
				if (part?.type === "output_text") {
					appendText(conversation.assistantPieces, part.text)
				} else if (part?.type === "reasoning") {
					processContent(part.content, conversation.reasoningPieces)
				} else {
					processContent(part, conversation.assistantPieces)
				}
			}
		} else if (item.type === "reasoning") {
			processContent((item as any).content, conversation.reasoningPieces)
		}
	}
}

function updateAggregatedUsage(usage: any, modelInfo: ModelInfo, aggregatedUsage: AggregatedUsage) {
	if (!usage) return
	const inputTokens = usage.input_tokens ?? aggregatedUsage.inputTokens
	const outputTokens = usage.output_tokens ?? aggregatedUsage.outputTokens
	aggregatedUsage.inputTokens = inputTokens ?? 0
	aggregatedUsage.outputTokens = outputTokens ?? 0
	aggregatedUsage.cacheReadTokens = usage.cache_read_tokens ?? 0
	aggregatedUsage.cacheWriteTokens = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0
	aggregatedUsage.totalCost = calculateApiCostOpenAI(modelInfo, aggregatedUsage.inputTokens, aggregatedUsage.outputTokens, aggregatedUsage.cacheWriteTokens, aggregatedUsage.cacheReadTokens)
}

function simulateNonDiffToolCall(
	name: string,
	input: Record<string, unknown>,
	originalFile: string,
	originalFilePath: string,
): string {
	switch (name) {
		case "read_file": {
			const requestedPath = (input.path as string) || ""
			const normalizedRequested = normalizePathForComparison(requestedPath)
			const normalizedTarget = normalizePathForComparison(originalFilePath)
			if (!requestedPath) {
				return `[read_file] Result:\nError: missing 'path' argument.`
			}
			if (normalizedRequested === normalizedTarget) {
				return `[read_file for '${requestedPath}'] Result:\n${originalFile}`
			}
			return `[read_file for '${requestedPath}'] Result:\nError fetching content: '${requestedPath}' is not available in the offline eval snapshot.`
		}
		case "search_files": {
			const regex = typeof input.regex === "string" ? input.regex : ""
			const scope = (input.path as string) || (input.file_pattern as string) || ""
			const scopeText = scope ? ` in '${scope}'` : ""
			const target = regex || "(no regex provided)"
			return `[search_files for '${target}'${scopeText}] Result:\nSearch is unavailable during offline evaluation. Use the provided task context and file snapshot instead.`
		}
		case "list_files": {
			const scope = (input.path as string) || "."
			return `[list_files for '${scope}'] Result:\nDirectory listings are disabled during offline evaluation. Rely on the supplied environment details.`
		}
		case "ask_followup_question":
		case "plan_mode_respond":
			return `[${name}] Result:\nNo live user is available during automated evaluation. Proceed with the best possible replace_in_file diff for '${originalFilePath}'.`
		case "write_to_file":
		return `[write_to_file] Result:\nDirect file writes are disabled during evaluation. Please emit a replace_in_file diff targeting '${originalFilePath}'.`
		case "attempt_completion":
			return `[attempt_completion] Result:\nNarrative summaries are not accepted. Provide a replace_in_file diff for '${originalFilePath}'.`
		default:
			return `[${name}] Result:\nThis tool is unavailable during the benchmark. Use the provided context and finish with a replace_in_file diff for '${originalFilePath}'.`
	}
}

async function runOpenAiResponsesEvaluation(input: TestInput): Promise<TestResult> {
	try {
		const {
			apiKey,
			systemPrompt,
			messages,
			modelId,
			originalFile,
			originalFilePath,
			parsingFunction,
			diffEditFunction,
			diffApplyFile,
		} = input

		const constructNewFileContent = diffEditingFunctions[diffApplyFile || diffEditFunction]

		if (!constructNewFileContent) {
			return {
				success: false,
				error: "invalid_functions",
			}
		}

		const handler = new OpenAiNativeHandler({
			openAiNativeApiKey: apiKey,
			apiModelId: modelId,
		})

		let response: OpenAIResponse
		let modelInfo: ModelInfo | undefined
		let responsesClient: any

		try {
			const { client, params, modelInfo: info } = handler.buildResponsesCreateParams(systemPrompt, messages)
			responsesClient = client
			modelInfo = info
			response = await responsesClient.responses.create(params)
			if (input.isVerbose) {
				try {
					log(input.isVerbose, `[DEBUG] Initial response payload: ${JSON.stringify(response)}`)
				} catch {
					log(input.isVerbose, "[DEBUG] Initial response payload: <unserializable>")
				}
			}
		} catch (error: any) {
			if (input.isVerbose) {
				log(input.isVerbose, `[DEBUG] responses.create threw error: ${error?.message || error}`)
			}
			return {
				success: false,
				error: "llm_stream_error",
				errorString: error?.message || error?.toString?.() || String(error),
			}
		}

		if (!modelInfo || !responsesClient) {
			return {
				success: false,
				error: "llm_stream_error",
				errorString: "Failed to initialize OpenAI responses client",
			}
		}

		const resolvedModelInfo = modelInfo
		const aggregatedUsage: AggregatedUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0,
		}
		const conversation: AggregatedConversation = { assistantPieces: [], reasoningPieces: [] }
        const aggregatedToolCalls: ExtractedToolCall[] = []
		let currentFileContent = originalFile

		const collectToolCall = (call: ExtractedToolCall) => {
			aggregatedToolCalls.push(call)
		}

		let diffState: DiffEvaluationState = {
			attempted: false,
			success: false,
			pathMatched: false,
		}

        const processNormalizedCall = async (call: ExtractedToolCall, requireOutput: boolean): Promise<string | undefined> => {
			collectToolCall(call)
			if (call.name === "replace_in_file") {
				diffState.attempted = true
				const targetPath = typeof call.input?.path === "string" ? call.input.path : ""
				const diffContent = typeof call.input?.diff === "string" ? call.input.diff : ""
				if (!targetPath || !diffContent) {
					diffState.success = false
					diffState.errorType = "tool_call_params_undefined"
					diffState.errorMessage = "Missing 'path' or 'diff' parameter."
					diffState.pathMatched = false
					return requireOutput ? "Error: replace_in_file requires both 'path' and 'diff' parameters." : undefined
				}

				const normalizedTarget = normalizePathForComparison(targetPath)
				const normalizedExpected = normalizePathForComparison(originalFilePath)
				if (normalizedTarget !== normalizedExpected) {
					diffState.success = false
					diffState.errorType = "wrong_file_edited"
					diffState.errorMessage = `Expected path '${originalFilePath}' but received '${targetPath}'.`
					diffState.pathMatched = false
					return requireOutput
						? `Error: expected path '${originalFilePath}' but got '${targetPath}'. Please target the correct file.`
						: undefined
				}

				diffState.pathMatched = true
				diffState.diffContent = diffContent

				let diffApplied = false
				let replacementData: any = undefined
				let diffError: unknown = undefined

				const diffForApplication = normalizeSearchBlocksForMatching(diffContent)

				try {
					const result = await constructNewFileContent(diffForApplication, currentFileContent, true)
					diffApplied = true
					if (typeof result === "object" && result !== null && "replacements" in result) {
						replacementData = (result as any).replacements
					}
					if (typeof result === "string") {
						currentFileContent = result
					} else if (result && typeof result === "object" && typeof (result as any).newContent === "string") {
						currentFileContent = (result as any).newContent
					}
				} catch (error: any) {
					diffApplied = false
					diffError = error
				}

				if (!diffApplied) {
					try {
						const fallbackResult = await constructNewFileContentV3(diffForApplication, currentFileContent, true)
						diffApplied = true
						if (typeof fallbackResult === "object" && fallbackResult !== null && "replacements" in fallbackResult) {
							replacementData = (fallbackResult as any).replacements
						}
						if (typeof fallbackResult === "string") {
							currentFileContent = fallbackResult
						} else if (fallbackResult && typeof fallbackResult === "object" && typeof (fallbackResult as any).newContent === "string") {
							currentFileContent = (fallbackResult as any).newContent
						}
					} catch (fallbackError: any) {
						diffApplied = false
						diffError = fallbackError
					}
				}

				if (diffApplied) {
					diffState.success = true
					diffState.errorType = undefined
					diffState.errorMessage = undefined
					diffState.replacementData = replacementData
					return requireOutput ? "Diff applied successfully." : undefined
				} else {
					diffState.success = false
					diffState.errorType = "diff_edit_error"
					diffState.errorMessage = diffError instanceof Error ? diffError.message : "Diff apply failed."
					diffState.replacementData = undefined
					return requireOutput ? `Diff application failed: ${diffState.errorMessage}` : undefined
				}
			}

            const simulatedOutput = simulateNonDiffToolCall(call.name, call.input as any, currentFileContent, originalFilePath)
            return requireOutput ? simulatedOutput : undefined
		}

		let iterationCount = 0
		while (true) {
			aggregateResponseOutput(response, conversation)
			updateAggregatedUsage(response.usage, resolvedModelInfo, aggregatedUsage)

			const outputFunctionCalls = extractFunctionCallsFromResponseOutput((response as any).output)
			for (const rawCall of outputFunctionCalls) {
				const normalized = normalizeFunctionCall(rawCall)
				await processNormalizedCall(normalized, false)
			}

			if ((response as any).status === "completed") {
				break
			}

			if ((response as any).status !== "requires_action") {
				return {
					success: false,
					streamResult: {
						assistantMessage: conversation.assistantPieces.join("\n").trim(),
						reasoningMessage: conversation.reasoningPieces.join("\n").trim(),
						usage: { ...aggregatedUsage },
					},
					toolCalls: aggregatedToolCalls,
					error: "other_error",
					errorString: `Unexpected response status: ${(response as any).status}`,
				}
			}

			const toolCallsRaw = (response as any).required_action?.submit_tool_outputs?.tool_calls || []
			if (toolCallsRaw.length === 0) {
				return {
					success: false,
					streamResult: {
						assistantMessage: conversation.assistantPieces.join("\n").trim(),
						reasoningMessage: conversation.reasoningPieces.join("\n").trim(),
						usage: { ...aggregatedUsage },
					},
					toolCalls: aggregatedToolCalls,
					error: "other_error",
					errorString: "Response requested tool outputs but no tool calls were provided.",
				}
			}

			iterationCount++
			if (iterationCount > MAX_OPENAI_TOOL_ITERATIONS) {
				return {
					success: false,
					streamResult: {
						assistantMessage: conversation.assistantPieces.join("\n").trim(),
						reasoningMessage: conversation.reasoningPieces.join("\n").trim(),
						usage: { ...aggregatedUsage },
					},
					toolCalls: aggregatedToolCalls,
					error: "no_tool_calls",
					errorString: "Exceeded maximum tool interaction iterations without completing a diff.",
				}
			}

            const toolOutputs: { tool_call_id: string; output: string }[] = []
			for (const rawCall of toolCallsRaw) {
				const normalized = normalizeFunctionCall(rawCall)
				const requireOutput = normalized.name !== "replace_in_file"
				const output = await processNormalizedCall(normalized, requireOutput)
				const toolCallId =
					normalized.callId ||
					(typeof rawCall?.id === "string" ? rawCall.id : undefined) ||
					`call_${Math.random().toString(36).slice(2)}`
				toolOutputs.push({ tool_call_id: toolCallId, output: output ?? "" })
			}

			try {
				response = await responsesClient.responses.submit_tool_outputs({
					response_id: response.id,
					tool_outputs: toolOutputs,
				})
				if (input.isVerbose) {
					try {
						log(input.isVerbose, `[DEBUG] Response after submit_tool_outputs: ${JSON.stringify(response)}`)
					} catch {
						log(input.isVerbose, "[DEBUG] Response after submit_tool_outputs: <unserializable>")
					}
				}
			} catch (error: any) {
				if (input.isVerbose) {
					log(input.isVerbose, `[DEBUG] submit_tool_outputs threw error: ${error?.message || error}`)
				}
				return {
					success: false,
					streamResult: {
						assistantMessage: conversation.assistantPieces.join("\n").trim(),
						reasoningMessage: conversation.reasoningPieces.join("\n").trim(),
						usage: { ...aggregatedUsage },
					},
					toolCalls: aggregatedToolCalls,
					error: "llm_stream_error",
					errorString: error?.message || error?.toString?.() || String(error),
				}
			}
		}

        const streamResult: StreamResult = {
			assistantMessage: conversation.assistantPieces.join("\n").trim(),
			reasoningMessage: conversation.reasoningPieces.join("\n").trim(),
			usage: { ...aggregatedUsage },
			functionCalls: aggregatedToolCalls,
		}

		if (!diffState.attempted) {
			return {
				success: false,
				streamResult,
				toolCalls: aggregatedToolCalls,
				error: "no_tool_calls",
			}
		}

		if (!diffState.pathMatched) {
			return {
				success: false,
				streamResult,
				toolCalls: aggregatedToolCalls,
				error: diffState.errorType || "wrong_file_edited",
				errorString: diffState.errorMessage,
			}
		}

		if (!diffState.success) {
			return {
				success: false,
				streamResult,
				toolCalls: aggregatedToolCalls,
				error: diffState.errorType || "diff_edit_error",
				errorString: diffState.errorMessage,
				diffEdit: diffState.diffContent,
				diffEditSuccess: false,
			}
		}

		return {
			success: true,
			streamResult,
            toolCalls: aggregatedToolCalls,
			diffEdit: diffState.diffContent,
			diffEditSuccess: true,
			replacementData: diffState.replacementData,
		}
	} catch (error: any) {
		return {
			success: false,
			error: "other_error",
			errorString: error.message || error.toString(),
		}
	}
}

async function processStream(
	handler: OpenRouterHandler | OpenAiNativeHandler,
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

    const functionCalls: { name: string; input: Record<string, unknown>; raw?: string; callId?: string }[] = []

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
            case "tool_call": {
                // Convert function call to legacy XML so existing parsing continues to work
                try {
                    const xml = formatToolCallXml((chunk as any).name, (chunk as any).rawArguments)
                    if (xml) {
                        assistantMessage += xml
                        if (timeToFirstEditMs === null) {
                            timeToFirstEditMs = Date.now() - startTime
                        }
                    }
                    // Also record native function call so XML is not required for checks
                    functionCalls.push({
                        name: (chunk as any).name,
                        input: (chunk as any).arguments,
                        raw: (chunk as any).rawArguments,
                        callId: (chunk as any).callId,
                    })
                } catch {}
                break
            }
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
        functionCalls,
	}
}

/**
 * Main evaluation function:
 * 1. create and process stream
 * 2. extract any tool calls from the stream
 * 3. if no diff edit, considered a failure (or rerun) - otherwise attempt to apply the diff edit
 */
async function runStreamingEvaluation(input: TestInput): Promise<TestResult> {
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

		const provider = input.provider || "openrouter"

		const cloneMessages = (inputMessages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] =>
			inputMessages.map((message) => {
				if (typeof message.content === "string") {
					return { ...message }
				}
				const clonedContent = message.content.map((part) => {
					if (part.type === "text" || part.type === "image") {
						return { ...part }
					}
					if (part.type === "tool_use") {
						return {
							...part,
							input: part.input ? { ...part.input } : {},
						}
					}
					if (part.type === "tool_result") {
						return {
							...part,
							content: Array.isArray(part.content) ? [...part.content] : part.content,
						}
					}
					return { ...part }
				})
				return {
					role: message.role,
					content: clonedContent,
				}
			})

		const normalizePathForComparison = (value?: string): string => {
			if (!value) return ""
			let cleaned = value.trim()
			cleaned = cleaned.replace(/^['"`]+/, "").replace(/['"`]+$/, "")
			if (cleaned.startsWith("./")) {
				cleaned = cleaned.slice(2)
			}
			return cleaned
		}

		const aggregatedAssistantParts: string[] = []
		const aggregatedReasoningParts: string[] = []
		const aggregatedToolCalls: ExtractedToolCall[] = []
		const aggregatedUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0,
		}
		let latestTiming: StreamResult["timing"] | undefined

		const createAggregatedStreamResult = (): StreamResult => ({
			assistantMessage: aggregatedAssistantParts.join("\n"),
			reasoningMessage: aggregatedReasoningParts.join("\n"),
			usage: { ...aggregatedUsage },
			timing: latestTiming,
			functionCalls: aggregatedToolCalls.map((call) => ({
				name: call.name,
				input: (call.input as Record<string, unknown>) ?? {},
				raw: call.rawArguments,
				callId: call.callId,
			})),
		})

		const buildAssistantMessageContent = (
			assistantMessage: string,
			toolCalls: ExtractedToolCall[],
			iteration: number,
		): Anthropic.Messages.MessageParam["content"] => {
			const parsedBlocks = parseAssistantMessage(assistantMessage)
			const contentBlocks: Anthropic.Messages.MessageParam["content"] = []
			let toolIndex = 0

			for (const block of parsedBlocks) {
				if (block.type === "text") {
					const trimmed = block.content.trim()
					if (trimmed.length > 0) {
						contentBlocks.push({ type: "text", text: trimmed })
					}
					continue
				}

				const existingCall = toolCalls[toolIndex]
				const callId = existingCall?.callId || `tool_call_${iteration}_${toolIndex}`
				if (existingCall) {
					existingCall.callId = callId
				}
				const callInput =
					existingCall?.input && Object.keys(existingCall.input).length > 0
						? (existingCall.input as Record<string, unknown>)
						: (block.params as unknown as Record<string, unknown>)

				contentBlocks.push({
					type: "tool_use",
					name: (existingCall?.name || block.name) as string,
					id: callId,
					input: callInput ?? {},
				})
				if (!existingCall) {
					toolCalls.push({
						name: block.name as any,
                        input: block.params,
						callId,
					})
				}
				toolIndex++
			}

			if (contentBlocks.length === 0) {
				const trimmed = assistantMessage.trim()
				if (trimmed.length > 0) {
					contentBlocks.push({ type: "text", text: trimmed })
				}
			}

			return contentBlocks
		}

		const simulateToolResult = (
			call: ExtractedToolCall,
			targetContent: string,
			targetPath: string,
		): string | null => {
			switch (call.name) {
				case "read_file": {
					const requestedPath = call.input?.path ?? ""
					const normalizedRequested = normalizePathForComparison(requestedPath)
					const normalizedTarget = normalizePathForComparison(targetPath)
					if (!requestedPath) {
						return `[read_file] Result:\nError: missing 'path' argument.`
					}
					if (normalizedRequested === normalizedTarget) {
						return `[read_file for '${requestedPath}'] Result:\n${targetContent}`
					}
					return `[read_file for '${requestedPath}'] Result:\nError fetching content: '${requestedPath}' is not available in the offline eval snapshot.`
				}
				case "search_files": {
					const regex = typeof call.input?.regex === "string" ? call.input.regex : ""
					const scope = call.input?.path || call.input?.file_pattern || ""
					const scopeText = scope ? ` in '${scope}'` : ""
					const target = regex || "(no regex provided)"
					return `[search_files for '${target}'${scopeText}] Result:\nSearch is unavailable during offline evaluation. Use the provided task context and file snapshot instead.`
				}
				case "list_files": {
					const scope = call.input?.path || "."
					return `[list_files for '${scope}'] Result:\nDirectory listings are disabled during offline evaluation. Rely on the supplied environment details.`
				}
				case "ask_followup_question":
					return `[ask_followup_question] Result:\nNo user is available to answer questions during automated evaluation. Proceed with the best possible edit.`
				case "write_to_file":
					return `[write_to_file] Result:\nDirect writes are disabled in this benchmark. Craft a replace_in_file diff targeting '${targetPath}' instead.`
				case "attempt_completion":
					return `[attempt_completion] Result:\nNarrative summaries are not accepted. Please provide a replace_in_file tool call with the minimal diff for '${targetPath}'.`
				case "plan_mode_respond":
					return `[plan_mode_respond] Result:\nPlanning is acknowledged. When ready, emit a replace_in_file diff for '${targetPath}'.`
				default:
					return `[${call.name}] Result:\nThis tool isn't available during evaluation. Gather any information you need from the provided context, then issue a replace_in_file diff for '${targetPath}'.`
			}
		}

		const evaluateReplaceCalls = async (toolCallHistory: ExtractedToolCall[]): Promise<TestResult> => {
			const aggregateStream = createAggregatedStreamResult()

			const replaceIndices: number[] = []
			for (let i = 0; i < toolCallHistory.length; i++) {
				if (toolCallHistory[i]?.name === "replace_in_file") {
					replaceIndices.push(i)
				}
			}

			if (toolCallHistory.length === 0 || replaceIndices.length === 0) {
				log(input.isVerbose, `[DEBUG] no_tool_calls: assistantMessage preview:`)
				if (aggregateStream.assistantMessage) {
					log(
						input.isVerbose,
						`   ${aggregateStream.assistantMessage.slice(0, 400)}${
							aggregateStream.assistantMessage.length > 400 ? "…" : ""
						}`,
					)
				}
			return {
				success: false,
					streamResult: aggregateStream,
					toolCalls: toolCallHistory,
				error: "no_tool_calls",
			}
		}

			let selectedIndex = -1
			for (let i = replaceIndices.length - 1; i >= 0; i--) {
				const idx = replaceIndices[i]
				const candidatePath = normalizePathForComparison(toolCallHistory[idx]?.input?.path as string | undefined)
				if (candidatePath && candidatePath === normalizePathForComparison(originalFilePath)) {
					selectedIndex = idx
					break
				}
			}

			if (selectedIndex === -1) {
				const lastIdx = replaceIndices[replaceIndices.length - 1]
				const lastCall = toolCallHistory[lastIdx]
				log(
					input.isVerbose,
					`❌ No replace_in_file targeted expected path. Expected: "${originalFilePath}", observed: "${
						(lastCall?.input as any)?.path
					}"`,
				)
			return {
				success: false,
					streamResult: aggregateStream,
					toolCalls: toolCallHistory,
					error: "wrong_file_edited",
				}
			}

			const toolCall = toolCallHistory[selectedIndex]
			const diffToolPath = toolCall.input?.path
			const diffToolContent = toolCall.input?.diff

		if (!diffToolPath || !diffToolContent) {
				log(input.isVerbose, `[DEBUG] tool_call_params_undefined: path or diff missing`)
				try {
					log(input.isVerbose, `   toolCall: ${JSON.stringify(toolCall).slice(0, 500)}`)
				} catch {}
			return {
				success: false,
					streamResult: aggregateStream,
					toolCalls: toolCallHistory,
				error: "tool_call_params_undefined",
			}
		}

		log(input.isVerbose, `Expected file path: "${originalFilePath}"`)
		log(input.isVerbose, `Actual file path used: "${diffToolPath}"`)
			if (normalizePathForComparison(diffToolPath) !== normalizePathForComparison(originalFilePath)) {
			log(input.isVerbose, `❌ File path mismatch detected!`)
			return {
				success: false,
					streamResult: aggregateStream,
					toolCalls: toolCallHistory,
				error: "wrong_file_edited",
			}
		}

		let diffSuccess = true
		let replacementData: any = undefined
			let diffError: unknown = undefined
		try {
			const result = await constructNewFileContent(diffToolContent, originalFile, true)
				if (typeof result === "object" && result !== null && "replacements" in result) {
				replacementData = result.replacements
			}
		} catch (error: any) {
			diffSuccess = false
				diffError = error
			log(input.isVerbose, `ERROR: ${error}`)
				log(
					input.isVerbose,
					`[DEBUG] diff apply failed. SEARCH block count: ${
						(diffToolContent.match(/------- SEARCH/g) || []).length
					}`,
				)
				try {
					const fallbackResult = await constructNewFileContentV3(diffToolContent, originalFile, true)
					diffSuccess = true
					if (typeof fallbackResult === "object" && fallbackResult !== null && "replacements" in fallbackResult) {
						replacementData = (fallbackResult as any).replacements
					}
					log(
						input.isVerbose,
						`[DEBUG] diff apply fallback (constructNewFileContentV3) succeeded after primary failure.`,
					)
				} catch (fallbackError: any) {
					diffSuccess = false
					diffError = fallbackError
					log(input.isVerbose, `ERROR (fallback): ${fallbackError}`)
				}
		}

		return {
			success: true,
				streamResult: aggregateStream,
				toolCalls: toolCallHistory,
			diffEdit: diffToolContent,
			diffEditSuccess: diffSuccess,
			replacementData: replacementData,
				error: diffSuccess ? undefined : "diff_edit_error",
				errorString: diffSuccess ? undefined : diffError instanceof Error ? diffError.message : "Diff apply failed",
			}
		}

		if (originalDiffEditToolCallMessage !== undefined) {
			aggregatedAssistantParts.push(originalDiffEditToolCallMessage)
			const replayBlocks = parseAssistantMessage(originalDiffEditToolCallMessage)
			let replayIndex = 0
			for (const block of replayBlocks) {
				if (block.type === "tool_use") {
					aggregatedToolCalls.push({
						name: block.name as any,
						input: block.params,
						callId: `replay_${replayIndex++}`,
					})
				}
			}
			return await evaluateReplaceCalls(aggregatedToolCalls)
		}

		let handler: OpenRouterHandler | OpenAiNativeHandler
		try {
				if (provider === "openai") {
				handler = new OpenAiNativeHandler({
						openAiNativeApiKey: apiKey,
						apiModelId: modelId,
				})
				} else {
				handler = new OpenRouterHandler({
						openRouterApiKey: apiKey,
						openRouterModelId: modelId,
						thinkingBudgetTokens: thinkingBudgetTokens,
						openRouterModelInfo: {
							maxTokens: 10_000,
							contextWindow: 1_000_000,
							supportsImages: true,
							supportsPromptCache: true,
							inputPrice: 0,
							outputPrice: 0,
						},
				})
			}
		} catch (error: any) {
			return {
				success: false,
				error: "llm_stream_error",
				errorString: error.message || error.toString(),
			}
		}

		const conversation = cloneMessages(messages)
		const maxToolIterations = Math.max(1, Math.min(10, (input as any).maxToolIterations ?? 5))

		for (let iteration = 0; iteration < maxToolIterations; iteration++) {
			let streamResultIteration: StreamResult
			try {
				streamResultIteration = await processStream(handler, systemPrompt, conversation)
			} catch (error: any) {
				return {
					success: false,
					error: "llm_stream_error",
					errorString: error.message || error.toString(),
				}
			}

			aggregatedAssistantParts.push(streamResultIteration.assistantMessage)
			if (streamResultIteration.reasoningMessage) {
				aggregatedReasoningParts.push(streamResultIteration.reasoningMessage)
			}
			aggregatedUsage.inputTokens += streamResultIteration.usage.inputTokens
			aggregatedUsage.outputTokens += streamResultIteration.usage.outputTokens
			aggregatedUsage.cacheWriteTokens += streamResultIteration.usage.cacheWriteTokens
			aggregatedUsage.cacheReadTokens += streamResultIteration.usage.cacheReadTokens
			aggregatedUsage.totalCost += streamResultIteration.usage.totalCost
			latestTiming = streamResultIteration.timing || latestTiming

			let iterationToolCalls: ExtractedToolCall[] = []
			if (streamResultIteration.functionCalls && streamResultIteration.functionCalls.length > 0) {
				iterationToolCalls = streamResultIteration.functionCalls.map((fc, idx) => ({
					name: fc.name as any,
					input: (fc.input || {}) as any,
					callId: fc.callId || `live_${iteration}_${idx}`,
					rawArguments: fc.raw,
				}))
        } else {
				const contentBlocks = parseAssistantMessage(streamResultIteration.assistantMessage)
				let toolCounter = 0
				for (const block of contentBlocks) {
                if (block.type === "tool_use") {
						iterationToolCalls.push({
							name: block.name as any,
                        input: block.params,
							callId: `live_${iteration}_${toolCounter++}`,
                    })
                }
            }
        }

			const assistantContent = buildAssistantMessageContent(
				streamResultIteration.assistantMessage,
				iterationToolCalls,
				iteration,
			)
			if (assistantContent.length > 0) {
				conversation.push({
					role: "assistant",
					content: assistantContent,
				})
			}

			aggregatedToolCalls.push(...iterationToolCalls)

			if (iterationToolCalls.some((call) => call.name === "replace_in_file")) {
				return await evaluateReplaceCalls(aggregatedToolCalls)
			}

			let handledTool = false
			for (const call of iterationToolCalls) {
				if (call.name === "replace_in_file") {
					continue
				}
				const simulatedOutput = simulateToolResult(call, originalFile, originalFilePath)
				if (simulatedOutput !== null) {
					const callId = call.callId || `tool_result_${iteration}_${Math.random().toString(36).slice(2, 8)}`
					call.callId = callId
					conversation.push({
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: callId,
								content: simulatedOutput,
							},
						],
					})
					handledTool = true
				}
			}

			if (handledTool) {
				continue
			}

			const aggregateStream = createAggregatedStreamResult()
			return {
				success: false,
				streamResult: aggregateStream,
				toolCalls: aggregatedToolCalls,
				error: iterationToolCalls.length === 0 ? "no_tool_calls" : "other_error",
			}
		}

		const aggregateStream = createAggregatedStreamResult()
		return {
			success: false,
			streamResult: aggregateStream,
			toolCalls: aggregatedToolCalls,
			error: "no_tool_calls",
		}
	} catch (error: any) {
		return {
			success: false,
			error: "other_error",
			errorString: error.message || error.toString(),
		}
	}
}

export async function runSingleEvaluation(input: TestInput): Promise<TestResult> {
	if (input.provider === "openai") {
		return runOpenAiResponsesEvaluation(input)
	}
	return runStreamingEvaluation(input)
}
