import { Anthropic } from "@anthropic-ai/sdk"
import { GenerateContentConfig, GoogleGenAI } from "@google/genai"
import { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { sanitizeAnthropicMessages } from "../transform/anthropic-format"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface AIhubmixHandlerOptions extends CommonApiHandlerOptions {
	apiKey?: string
	baseURL?: string
	appCode?: string
	modelId?: string
	modelInfo?: ModelInfo
	thinkingBudgetTokens?: number
}

export class AIhubmixHandler implements ApiHandler {
	private options: AIhubmixHandlerOptions
	private anthropicClient: Anthropic | undefined
	private openaiClient: OpenAI | undefined
	private geminiClient: GoogleGenAI | undefined

	constructor(options: AIhubmixHandlerOptions) {
		const { baseURL, appCode, ...rest } = options
		this.options = {
			baseURL: baseURL ?? "https://aihubmix.com",
			appCode: appCode ?? "KUWF9311",
			...rest,
		}
	}

	private ensureAnthropicClient(): Anthropic {
		if (!this.anthropicClient) {
			if (!this.options.apiKey) {
				throw new Error("AIhubmix API key is required")
			}
			try {
				this.anthropicClient = new Anthropic({
					apiKey: this.options.apiKey,
					baseURL: this.options.baseURL,
					defaultHeaders: {
						"APP-Code": this.options.appCode,
					},
				})
			} catch (error) {
				throw new Error(`Error creating Anthropic client: ${error.message}`)
			}
		}
		return this.anthropicClient
	}

	private ensureOpenaiClient(): OpenAI {
		if (!this.openaiClient) {
			if (!this.options.apiKey) {
				throw new Error("AIhubmix API key is required")
			}
			try {
				this.openaiClient = new OpenAI({
					apiKey: this.options.apiKey,
					baseURL: `${this.options.baseURL}/v1`,
					defaultHeaders: {
						"APP-Code": this.options.appCode,
					},
				})
			} catch (error) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.openaiClient
	}

	private ensureGeminiClient(): GoogleGenAI {
		if (!this.geminiClient) {
			if (!this.options.apiKey) {
				throw new Error("AIhubmix API key is required")
			}
			try {
				this.geminiClient = new GoogleGenAI({
					apiKey: this.options.apiKey,
					httpOptions: {
						baseUrl: `${this.options.baseURL}/gemini`,
						headers: {
							// @ts-expect-error
							"APP-Code": this.options.appCode,
							Authorization: `Bearer ${this.options.apiKey ?? ""}`,
						},
					},
				})
			} catch (error) {
				throw new Error(`Error creating Gemini client: ${error.message}`)
			}
		}
		return this.geminiClient
	}

	private routeModel(modelName: string): "anthropic" | "openai" | "gemini" | "openai-response" {
		const id = modelName || ""
		if (id.startsWith("claude")) {
			return "anthropic"
		}
		if (id.startsWith("gemini") && !id.endsWith("-nothink") && !id.endsWith("-search")) {
			return "gemini"
		}
		if (id === "gpt-5-pro" || id === "gpt-5-codex") {
			return "openai-response"
		}
		return "openai"
	}

	private fixToolChoice(requestBody: any): any {
		if (requestBody.tools?.length === 0 && requestBody.tool_choice) {
			delete requestBody.tool_choice
		}
		return requestBody
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: any[]): ApiStream {
		const modelId = this.options.modelId || ""
		const route = this.routeModel(modelId)

		switch (route) {
			case "anthropic":
				yield* this.createAnthropicMessage(systemPrompt, messages)
				break
			case "gemini":
				yield* this.createGeminiMessage(systemPrompt, messages)
				break
			case "openai-response":
				yield* this.createOpenaiResponseMessage(systemPrompt, messages)
				break
			case "openai":
				yield* this.createOpenaiMessage(systemPrompt, messages)
				break
			default:
				throw new Error(`Unsupported model route: ${route}`)
		}
	}

	private async *createAnthropicMessage(systemPrompt: string, messages: any[]): ApiStream {
		const client = this.ensureAnthropicClient()
		const modelId = this.options.modelId || "claude-3-5-sonnet-20241022"

		// Sanitize messages to remove Cline-specific fields like call_id that are not allowed by Anthropic API
		const sanitizedMessages = sanitizeAnthropicMessages(messages, false)

		const stream = await client.messages.create({
			model: modelId,
			temperature: 0,
			max_tokens: this.options.modelInfo?.maxTokens || 8192,
			system: [{ text: systemPrompt, type: "text" }],
			messages: sanitizedMessages,
			stream: true,
		})

		for await (const chunk of stream) {
			switch (chunk?.type) {
				case "message_start":
					const usage = chunk.message.usage
					yield {
						type: "usage",
						inputTokens: usage.input_tokens || 0,
						outputTokens: usage.output_tokens || 0,
						cacheWriteTokens: usage.cache_creation_input_tokens || undefined,
						cacheReadTokens: usage.cache_read_input_tokens || undefined,
					}
					break
				case "message_delta":
					yield {
						type: "usage",
						inputTokens: 0,
						outputTokens: chunk.usage.output_tokens || 0,
					}
					break
				case "content_block_start":
					if (chunk.content_block.type === "text") {
						yield {
							type: "text",
							text: chunk.content_block.text,
						}
					}
					break
				case "content_block_delta":
					if (chunk.delta.type === "text_delta") {
						yield {
							type: "text",
							text: chunk.delta.text,
						}
					}
					break
			}
		}
	}

	private async *createOpenaiResponseMessage(systemPrompt: string, messages: any[]): ApiStream {
		const client = this.ensureOpenaiClient()
		const modelId = this.options.modelId || "gpt-4o-mini"

		const input = (messages || []).map((m: any) => {
			const role = m.role || "user"
			const contentArray = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]
			const content = contentArray
				.filter((c: any) => c != null)
				.map((c: any) => {
					if (c.type === "image" || c.type === "input_image" || c.type === "image_url") {
						return { type: "input_image", image_url: c.image_url || c.url || c.source?.url }
					}
					const text = c.text ?? (typeof c === "string" ? c : "")
					return { type: role === "assistant" ? "output_text" : "input_text", text }
				})
			return { role, content }
		})

		const stream = await (client as any).responses.stream({
			model: modelId,
			instructions: systemPrompt,
			input,
		})

		for await (const event of stream as any) {
			if (event?.type === "response.output_text.delta") {
				yield { type: "text", text: event.delta || "" }
				continue
			}
			if (event?.type === "response.completed") {
				const usage = event.response?.usage || {}
				yield {
					type: "usage",
					inputTokens: usage.input_tokens || 0,
					outputTokens: usage.output_tokens || 0,
				}
				continue
			}
			if (event?.type === "response.error") {
				throw new Error(event.error?.message || "responses error")
			}
		}
	}

	private async *createOpenaiMessage(systemPrompt: string, messages: any[]): ApiStream {
		const client = this.ensureOpenaiClient()
		const modelId = this.options.modelId || "gpt-4o-mini"

		const openaiMessages = [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]

		const requestBody = {
			model: modelId,
			messages: openaiMessages,
			temperature: 0,
			stream: true,
		}

		const fixedRequestBody = this.fixToolChoice(requestBody)

		const stream = await client.chat.completions.create(fixedRequestBody)

		for await (const chunk of stream as any) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	private async *createGeminiMessage(systemPrompt: string, messages: any[]): ApiStream {
		const client = this.ensureGeminiClient()
		const modelId = this.options.modelId || "gemini-2.0-flash-exp"

		const contents = messages.map(convertAnthropicMessageToGemini)

		const requestConfig: GenerateContentConfig = {
			systemInstruction: systemPrompt,
			temperature: 0,
		}

		if (this.options.thinkingBudgetTokens) {
			requestConfig.thinkingConfig = {
				thinkingBudget: this.options.thinkingBudgetTokens,
				includeThoughts: true,
			}
		}

		const stream = await client.models.generateContentStream({
			model: modelId,
			contents,
			config: requestConfig,
		})

		for await (const chunk of stream as any) {
			if (chunk?.text) {
				yield { type: "text", text: chunk.text }
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.modelId || "gpt-4o-mini",
			info: this.options.modelInfo || {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				description: "AIhubmix unified model provider",
			},
		}
	}
}
