import { hicapModelInfoSaneDefaults, ModelInfo } from "@shared/api"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import OpenAI from "openai"
import type {
	ChatCompletionFunctionTool,
	ChatCompletionReasoningEffort,
	ChatCompletionTool,
} from "openai/resources/chat/completions"
import { getHicapBaseUrl, HICAP_TAG_HEADER, HICAP_TAG_VALUE, supportsHicapResponsesApi } from "@/shared/clients/hicap"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiFormat } from "@/shared/proto/cline/models"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"
import { handleResponsesApiStreamResponse } from "../utils/responses_api_support"

interface OpenAiHandlerOptions extends CommonApiHandlerOptions {
	hicapApiKey?: string
	hicapModelId?: string
	hicapUseResponsesApi?: boolean
	hicapMaxOutputTokens?: number
	hicapTemperature?: number
	reasoningEffort?: string
	thinkingBudgetTokens?: number
}

export class HicapHandler implements ApiHandler {
	private options: OpenAiHandlerOptions
	private client: OpenAI | undefined

	constructor(options: OpenAiHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.hicapApiKey) {
				throw new Error("Hicap API key is required")
			}
			if (!this.options.hicapModelId) {
				throw new Error("Model ID is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: getHicapBaseUrl(),
					apiKey: this.options.hicapApiKey,
					defaultHeaders: {
						"api-key": this.options.hicapApiKey,
						[HICAP_TAG_HEADER]: HICAP_TAG_VALUE,
					},
				})
			} catch (error) {
				throw new Error(`Error creating OpenAI client: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		if (this.shouldUseResponsesApi()) {
			yield* this.createResponseStream(systemPrompt, messages, tools)
			return
		}

		yield* this.createCompletionStream(systemPrompt, messages, tools)
	}

	private async *createCompletionStream(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ChatCompletionTool[],
	): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.hicapModelId ?? ""
		const toolCallProcessor = new ToolCallProcessor()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		const temperature = this.getTemperature()
		const requestedEffort = normalizeOpenaiReasoningEffort(this.options.reasoningEffort)
		const thinkingBudgetTokens = this.getThinkingBudgetTokens()
		const reasoningEffort =
			requestedEffort === "none" || (!supportsHicapResponsesApi(modelId) && !thinkingBudgetTokens)
				? undefined
				: (requestedEffort as ChatCompletionReasoningEffort)
		const thinkingConfig = thinkingBudgetTokens ? { type: "enabled", budget_tokens: thinkingBudgetTokens } : undefined
		const maxTokens = this.getMaxOutputTokens()

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			max_tokens: maxTokens,
			reasoning_effort: reasoningEffort,
			stream: true,
			stream_options: { include_usage: true },
			...(temperature !== undefined ? { temperature } : {}),
			...(thinkingConfig ? { thinking: thinkingConfig } : {}),
			...getOpenAIToolParams(tools),
		})
		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (delta && "thinking" in delta && delta.thinking) {
				yield {
					type: "reasoning",
					reasoning: (delta.thinking as string | undefined) || "",
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					// @ts-expect-error-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}

	private mapResponseTools(tools?: ChatCompletionTool[]): OpenAI.Responses.Tool[] | undefined {
		return tools
			?.filter((tool): tool is ChatCompletionFunctionTool => tool?.type === "function")
			.map((tool) => ({
				type: "function",
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters ?? null,
				strict: tool.function.strict ?? true,
			}))
	}

	private async *createResponseStream(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ChatCompletionTool[],
	): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const { input, previousResponseId } = convertToOpenAIResponsesInput(messages, { usePreviousResponseId: true })
		const fullContextInput = previousResponseId
			? convertToOpenAIResponsesInput(messages, { usePreviousResponseId: false }).input
			: input
		const requestedEffort = normalizeOpenaiReasoningEffort(this.options.reasoningEffort)
		const reasoning =
			requestedEffort === "none"
				? undefined
				: {
						effort: requestedEffort as ChatCompletionReasoningEffort,
						summary: "auto" as const,
					}
		const responseTools = this.mapResponseTools(tools)
		const maxOutputTokens = this.getMaxOutputTokens()
		const temperature = this.getTemperature()
		const createStream = (responseInput: OpenAI.Responses.ResponseInput, responseId?: string) =>
			client.responses.create({
				model: model.id,
				instructions: systemPrompt,
				input: responseInput,
				stream: true,
				store: true,
				...(temperature !== undefined ? { temperature } : {}),
				...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
				tools: responseTools,
				...(responseId ? { previous_response_id: responseId } : {}),
				...(reasoning ? { include: ["reasoning.encrypted_content"] } : {}),
				...(reasoning ? { reasoning } : {}),
			})

		let stream: Awaited<ReturnType<typeof createStream>>
		try {
			stream = await createStream(input, previousResponseId)
		} catch (error) {
			if (!previousResponseId || !this.isPreviousResponseNotFoundError(error)) {
				throw error
			}
			stream = await createStream(fullContextInput)
		}

		yield* handleResponsesApiStreamResponse(stream, model.info, async () => 0)
	}

	private isPreviousResponseNotFoundError(error: unknown): boolean {
		if (!error || typeof error !== "object") {
			return false
		}
		const maybeError = error as { code?: string; message?: string; error?: { code?: string; message?: string } }
		const code = maybeError.code ?? maybeError.error?.code
		const message = maybeError.message ?? maybeError.error?.message ?? ""
		return code === "previous_response_not_found" || message.includes("Previous response with id")
	}

	private getMaxOutputTokens(): number | undefined {
		const maxOutputTokens = Number(this.options.hicapMaxOutputTokens)
		return Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? Math.floor(maxOutputTokens) : undefined
	}

	private getTemperature(): number | undefined {
		const temperature = Number(this.options.hicapTemperature)
		return Number.isFinite(temperature) ? temperature : undefined
	}

	private getThinkingBudgetTokens(): number | undefined {
		const budgetTokens = Number(this.options.thinkingBudgetTokens)
		return Number.isFinite(budgetTokens) && budgetTokens > 0 ? Math.floor(budgetTokens) : undefined
	}

	private shouldUseResponsesApi(): boolean {
		return Boolean(this.options.hicapUseResponsesApi && supportsHicapResponsesApi(this.options.hicapModelId))
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.hicapModelId ?? "",
			info: {
				...hicapModelInfoSaneDefaults,
				...(this.shouldUseResponsesApi() ? { apiFormat: ApiFormat.OPENAI_RESPONSES } : {}),
			},
		}
	}
}
