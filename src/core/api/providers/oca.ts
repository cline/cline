import { liteLlmDefaultModelId, liteLlmModelInfoSaneDefaults, ModelInfo } from "@shared/api"
import OpenAI, { APIError, OpenAIError } from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { OcaAuthService } from "@/services/auth/oca/OcaAuthService"
import {
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
	OCI_HEADER_OPC_REQUEST_ID,
} from "@/services/auth/oca/utils/constants"
import { createOcaHeaders } from "@/services/auth/oca/utils/utils"
import { OcaModelInfo } from "@/shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiFormat } from "@/shared/proto/index.cline"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, type CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"
import { handleResponsesApiStreamResponse } from "../utils/responses_api_support"

export interface OcaHandlerOptions extends CommonApiHandlerOptions {
	ocaBaseUrl?: string
	ocaModelId?: string
	ocaModelInfo?: OcaModelInfo
	ocaReasoningEffort?: string
	thinkingBudgetTokens?: number
	ocaUsePromptCache?: boolean
	taskId?: string
	ocaMode?: string // "internal" or "external"
}

export class OcaHandler implements ApiHandler {
	protected options: OcaHandlerOptions
	protected client: OpenAI | undefined

	constructor(options: OcaHandlerOptions) {
		this.options = options
	}

	protected initializeClient(options: OcaHandlerOptions) {
		return new (class OCIOpenAI extends OpenAI {
			protected override async prepareOptions(opts: any): Promise<void> {
				const token = await OcaAuthService.getInstance().getAuthToken()
				if (!token) {
					throw new OpenAIError("Unable to handle auth, Oracle Code Assist (OCA) access token is not available")
				}
				opts.headers ??= {}
				// OCA Headers
				const ociHeaders = await createOcaHeaders(token, options.taskId!)
				opts.headers = { ...opts.headers, ...ociHeaders }
				Logger.log(`Making request with customer opc-request-id: ${opts.headers?.["opc-request-id"]}`)
				return super.prepareOptions(opts)
			}

			protected override makeStatusError(
				status: number | undefined,
				error: Object | undefined,
				message: string | undefined,
				headers: any | undefined,
			): APIError {
				interface OciError {
					code?: string
					message?: string
				}
				let ociErrorMessage = message
				if (typeof error === "object" && error !== null) {
					try {
						ociErrorMessage = JSON.stringify(error)
						const ociErr = error as OciError
						if (ociErr.code !== undefined && ociErr.message !== undefined) {
							ociErrorMessage = `${ociErr.code}: ${ociErr.message}`
						}
					} catch {}
				}
				const opcRequestId = headers?.[OCI_HEADER_OPC_REQUEST_ID]
				if (opcRequestId) {
					ociErrorMessage += `\n(${OCI_HEADER_OPC_REQUEST_ID}: ${opcRequestId})`
				}
				const statusCode = typeof status === "number" ? status : 500
				return super.makeStatusError(statusCode, error ?? {}, ociErrorMessage, headers)
			}
		})({
			baseURL:
				options.ocaBaseUrl ||
				(options.ocaMode === "internal" ? DEFAULT_INTERNAL_OCA_BASE_URL : DEFAULT_EXTERNAL_OCA_BASE_URL),
			apiKey: "noop",
			fetch, // Use configured fetch with proxy support
		})
	}

	protected ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.ocaModelId) {
				throw new Error("Oracle Code Assist (OCA) model is not selected")
			}
			try {
				this.client = this.initializeClient(this.options)
			} catch (error) {
				throw new Error(`Error creating Oracle Code Assist (OCA) client: ${error.message}`)
			}
		}
		return this.client
	}

	async getApiCosts(prompt_tokens: number, completion_tokens: number): Promise<number | undefined> {
		// Reference: https://github.com/BerriAI/litellm/blob/122ee634f434014267af104814022af1d9a0882f/litellm/proxy/spend_tracking/spend_management_endpoints.py#L1473
		const client = this.ensureClient()
		const modelId = this.options.ocaModelId || liteLlmDefaultModelId
		const token = await OcaAuthService.getInstance().getAuthToken()
		if (!token) {
			throw new OpenAIError("Unable to handle auth, Oracle Code Assist (OCA) access token is not available")
		}
		const ociHeaders = await createOcaHeaders(token, this.options.taskId!)
		Logger.log(`Making calculate cost request with customer opc-request-id: ${ociHeaders["opc-request-id"]}`)
		try {
			const response = await fetch(`${client.baseURL}/spend/calculate`, {
				method: "POST",
				headers: ociHeaders,
				body: JSON.stringify({
					completion_response: {
						model: modelId,
						usage: {
							prompt_tokens,
							completion_tokens,
						},
					},
				}),
			})

			if (response.ok) {
				const data: { cost: number } = await response.json()
				return data.cost
			} else {
				Logger.error("Error calculating spend:", response.statusText)
				return undefined
			}
		} catch (error) {
			Logger.error("Error calculating spend:", error)
			return undefined
		}
	}

	async calculateCost(
		modelInfo: ModelInfo,
		inputTokens: number,
		outputTokens: number,
		_cacheWriteTokens?: number,
		_cacheReadTokens?: number,
	) {
		const inputCost = (await this.getApiCosts(1e6, 0)) || 0
		const outputCost = (await this.getApiCosts(0, 1e6)) || 0
		const totalCost = (inputCost * inputTokens) / 1e6 + (outputCost * outputTokens) / 1e6
		return totalCost
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		if (this.options.ocaModelInfo?.apiFormat == ApiFormat.OPENAI_RESPONSES) {
			yield* this.createMessageResponsesApi(systemPrompt, messages, tools)
		} else {
			yield* this.createMessageChatApi(systemPrompt, messages, tools)
		}
	}

	async *createMessageChatApi(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const formattedMessages = convertToOpenAiMessages(messages)
		const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}
		const modelId = this.options.ocaModelId || liteLlmDefaultModelId
		const isOminiModel = modelId.includes("o1-mini") || modelId.includes("o3-mini") || modelId.includes("o4-mini")

		// Configuration for extended thinking
		const budgetTokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = budgetTokens !== 0
		const thinkingConfig = reasoningOn ? { type: "enabled", budget_tokens: budgetTokens } : undefined

		let temperature: number | undefined = this.options.ocaModelInfo?.temperature ?? 0
		const maxTokens: number | undefined = this.options.ocaModelInfo?.maxTokens

		if (isOminiModel && reasoningOn) {
			temperature = undefined // Thinking mode doesn't support temperature
		}

		// Define cache control object if prompt caching is enabled
		const cacheControl = this.options.ocaUsePromptCache ? { cache_control: { type: "ephemeral" } } : undefined

		// Add cache_control to system message if enabled
		const enhancedSystemMessage = {
			...systemMessage,
			...(cacheControl && cacheControl),
		}

		// Find the last two user messages to apply caching
		const userMsgIndices = formattedMessages.reduce((acc, msg, index) => {
			if (msg.role === "user") {
				acc.push(index)
			}
			return acc
		}, [] as number[])
		const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
		const secondLastUserMsgIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

		// Apply cache_control to the last two user messages if enabled
		const enhancedMessages = formattedMessages.map((message, index) => {
			if ((index === lastUserMsgIndex || index === secondLastUserMsgIndex) && cacheControl) {
				return {
					...message,
					...cacheControl,
				}
			}
			return message
		})

		const toolCallProcessor = new ToolCallProcessor()

		const chatCompletionsParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: this.options.ocaModelId || liteLlmDefaultModelId,
			messages: [enhancedSystemMessage, ...enhancedMessages],
			temperature,
			stream: true,
			max_completion_tokens: maxTokens,
			max_tokens: maxTokens,
			stream_options: { include_usage: true },
			...(thinkingConfig && { thinking: thinkingConfig }), // Add thinking configuration when applicable
			...(this.options.taskId && {
				litellm_session_id: `cline-${this.options.taskId}`,
				...getOpenAIToolParams(tools),
			}), // Add session ID for LiteLLM tracking
		}

		if (this.options.ocaModelInfo?.supportsReasoningEffort) {
			chatCompletionsParams["reasoning_effort"] = this.options.ocaReasoningEffort || ("medium" as any)
		}

		const stream = await client.chat.completions.create(chatCompletionsParams)

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta

			// Handle normal text content
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Handle reasoning events (thinking)
			// Thinking is not in the standard types but may be in the response
			interface ThinkingDelta {
				thinking?: string
			}

			if ((delta as ThinkingDelta)?.thinking) {
				yield {
					type: "reasoning",
					reasoning: (delta as ThinkingDelta).thinking || "",
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			// Handle token usage information
			if (chunk.usage) {
				const totalCost = await this.calculateCost(
					this.options.ocaModelInfo!,
					chunk.usage.prompt_tokens,
					chunk.usage.completion_tokens,
				)

				// Extract cache-related information if available
				// Need to use type assertion since these properties are not in the standard OpenAI types
				const usage = chunk.usage as {
					prompt_tokens: number
					completion_tokens: number
					cache_creation_input_tokens?: number
					prompt_cache_miss_tokens?: number
					cache_read_input_tokens?: number
					prompt_cache_hit_tokens?: number
				}

				const cacheWriteTokens = usage.cache_creation_input_tokens || usage.prompt_cache_miss_tokens || 0
				const cacheReadTokens = usage.cache_read_input_tokens || usage.prompt_cache_hit_tokens || 0

				yield {
					type: "usage",
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
					cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
					cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
					totalCost,
				}
			}
		}
	}

	async *createMessageResponsesApi(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()

		// Convert messages to Responses API input format
		const input: OpenAI.Responses.ResponseInputItem[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAIResponsesInput(messages),
		]

		// Convert ChatCompletion tools to Responses API format if provided
		const responseTools = tools
			?.filter((tool) => tool?.type === "function")
			.map((tool: any) => ({
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters,
				strict: tool.function.strict ?? true, // Responses API defaults to strict mode
			}))

		const responsesParams: OpenAI.Responses.ResponseCreateParamsStreaming = {
			model: this.options.ocaModelId || liteLlmDefaultModelId,
			input,
			stream: true,
			tools: responseTools,
		}

		if (this.options.ocaModelInfo && this.options.ocaModelInfo.supportsReasoning) {
			responsesParams["reasoning"] = { effort: this.options.ocaReasoningEffort as any, summary: "auto" }
		}

		// Create the response using Responses API
		const stream = await client.responses.create(responsesParams)

		yield* handleResponsesApiStreamResponse(stream, this.options.ocaModelInfo!, this.calculateCost.bind(this))
	}

	getModel() {
		return {
			id: this.options.ocaModelId || liteLlmDefaultModelId,
			info: this.options.ocaModelInfo || liteLlmModelInfoSaneDefaults,
		}
	}
}
