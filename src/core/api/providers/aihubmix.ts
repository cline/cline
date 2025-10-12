import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler, ApiHandlerModel, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface AihubmixHandlerOptions extends CommonApiHandlerOptions {
	apiKey?: string
	baseUrl?: string
	appCode?: string
	modelId?: string
}

export class AihubmixHandler implements ApiHandler {
	private options: AihubmixHandlerOptions
	private anthropicClient: Anthropic | undefined
	private openaiClient: OpenAI | undefined

	constructor(options: AihubmixHandlerOptions) {
		this.options = {
			baseUrl: "https://aihubmix.com",
			appCode: "WHVL9885",
			...options,
		}
	}

	private ensureAnthropicClient(): Anthropic {
		if (!this.anthropicClient) {
			if (!this.options.apiKey) {
				throw new Error("Aihubmix API key is required")
			}
			try {
				this.anthropicClient = new Anthropic({
					apiKey: this.options.apiKey,
					baseURL: this.options.baseUrl,
					defaultHeaders: {
						"APP-Code": this.options.appCode || "WHVL9885",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Anthropic client: ${error.message}`)
			}
		}
		return this.anthropicClient
	}

	private ensureOpenaiClient(): OpenAI {
		if (!this.openaiClient) {
			if (!this.options.apiKey) {
				throw new Error("Aihubmix API key is required")
			}
			try {
				this.openaiClient = new OpenAI({
					apiKey: this.options.apiKey,
					baseURL: `${this.options.baseUrl}/v1`,
					defaultHeaders: {
						"APP-Code": this.options.appCode || "WHVL9885",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating OpenAI client: ${error.message}`)
			}
		}
		return this.openaiClient
	}

	private routeModel(modelName: string): "anthropic" | "openai" {
		if (modelName.startsWith("claude")) {
			return "anthropic"
		} else {
			return "openai"
		}
	}

	private fixToolChoice(requestBody: any): any {
		// 空工具修复：当 tools=[] 且存在 tool_choice 时，自动移除 tool_choice
		if (requestBody.tools?.length === 0 && requestBody.tool_choice) {
			delete requestBody.tool_choice
		}
		return requestBody
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const modelId = this.options.modelId || ""
		const route = this.routeModel(modelId)

		if (route === "anthropic") {
			yield* this.createAnthropicMessage(systemPrompt, messages)
		} else {
			yield* this.createOpenaiMessage(systemPrompt, messages)
		}
	}

	private async *createAnthropicMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureAnthropicClient()
		const modelId = this.options.modelId || "claude-3-5-sonnet-20241022"

		try {
			const stream = await client.messages.create({
				model: modelId,
				max_tokens: 4096,
				system: systemPrompt,
				messages: messages as Anthropic.Messages.MessageParam[],
				stream: true,
			})

			for await (const chunk of stream) {
				if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
					yield {
						type: "text" as const,
						text: chunk.delta.text,
					}
				}
			}
		} catch (error: any) {
			throw new Error(`Anthropic API error: ${error.message}`)
		}
	}

	private async *createOpenaiMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureOpenaiClient()
		const modelId = this.options.modelId || "gpt-4o-mini"

		try {
			const openaiMessages = [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]

			const requestBody = {
				model: modelId,
				messages: openaiMessages,
				temperature: 0.7,
				max_tokens: 4096,
				stream: true,
			}

			// 应用空工具修复
			const fixedRequestBody = this.fixToolChoice(requestBody)

			const stream = await client.chat.completions.create(fixedRequestBody)

			for await (const chunk of stream as any) {
				if (chunk.choices[0]?.delta?.content) {
					yield {
						type: "text" as const,
						text: chunk.choices[0].delta.content,
					}
				}
			}
		} catch (error: any) {
			throw new Error(`OpenAI API error: ${error.message}`)
		}
	}

	getModel(): ApiHandlerModel {
		return {
			id: this.options.modelId || "gpt-4o-mini",
			info: {
				maxTokens: 4096,
				supportsPromptCache: false,
			},
		}
	}
}
