import { Anthropic } from "@anthropic-ai/sdk"
import { GenerateContentConfig, GoogleGenAI } from "@google/genai"
import { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
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
			appCode: appCode ?? "KUWF9311", // 应用代码，享受折扣
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
						baseUrl: `${this.options.baseURL}/gemini/v1beta`,
					},
				})
			} catch (error) {
				throw new Error(`Error creating Gemini client: ${error.message}`)
			}
		}
		return this.geminiClient
	}

	/**
	 * 根据模型名称路由到对应的客户端
	 */
	private routeModel(modelName: string): "anthropic" | "openai" | "gemini" {
		const id = modelName || ""
		const lower = id.toLowerCase()
		if (lower.startsWith("claude")) {
			return "anthropic"
		}
		if (lower.startsWith("gemini") && !lower.endsWith("-nothink") && !lower.endsWith("-search")) {
			return "gemini"
		}
		return "openai"
	}

	/**
	 * 修复空工具时的 tool_choice 问题
	 */
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

		console.log("🔍 AIhubmixHandler.createMessage:", {
			modelId,
			route,
			options: {
				apiKey: this.options.apiKey,
				baseURL: this.options.baseURL,
				appCode: this.options.appCode,
			},
		})

		switch (route) {
			case "anthropic":
				yield* this.createAnthropicMessage(systemPrompt, messages)
				break
			case "openai":
				yield* this.createOpenaiMessage(systemPrompt, messages)
				break
			case "gemini":
				yield* this.createGeminiMessage(systemPrompt, messages)
				break
			default:
				throw new Error(`Unsupported model route: ${route}`)
		}
	}

	private async *createAnthropicMessage(systemPrompt: string, messages: any[]): ApiStream {
		const client = this.ensureAnthropicClient()
		const modelId = this.options.modelId || "claude-3-5-sonnet-20241022"

		const stream = await client.messages.create({
			model: modelId,
			temperature: 0,
			max_tokens: this.options.modelInfo?.maxTokens || 8192,
			system: [{ text: systemPrompt, type: "text" }],
			messages,
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

	private async *createOpenaiMessage(systemPrompt: string, messages: any[]): ApiStream {
		const client = this.ensureOpenaiClient()
		const modelId = this.options.modelId || "gpt-4o-mini"

		const openaiMessages = [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]

		const requestBody = {
			model: modelId,
			messages: openaiMessages,
			temperature: 0,
			max_tokens: this.options.modelInfo?.maxTokens || 8192,
			stream: true,
		}

		// 修复空工具问题
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
