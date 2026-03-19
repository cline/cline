import { ModelInfo, XAIModelId, xaiDefaultModelId, xaiModels } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import type { ChatCompletionFunctionTool, ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { ApiStream } from "../transform/stream"
import { handleResponsesApiStreamResponse } from "../utils/responses_api_support"

interface XAIHandlerOptions extends CommonApiHandlerOptions {
	xaiApiKey?: string
	reasoningEffort?: string
	apiModelId?: string
}

export class XAIHandler implements ApiHandler {
	private options: XAIHandlerOptions
	private client: OpenAI | undefined

	constructor(options: XAIHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.xaiApiKey) {
				throw new Error("xAI API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: "https://api.x.ai/v1",
					apiKey: this.options.xaiApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating xAI client: ${error.message}`)
			}
		}
		return this.client
	}

	private mapResponseTools(tools?: OpenAITool[]): OpenAI.Responses.Tool[] {
		if (!tools?.length) {
			return []
		}
		return tools
			.filter((tool): tool is ChatCompletionFunctionTool => tool?.type === "function")
			.map((tool) => ({
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters ?? null,
				strict: false,
			}))
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		// Convert directly from Cline/Anthropic format to Responses API input format
		const { input } = convertToOpenAIResponsesInput(messages)
		const responseTools = this.mapResponseTools(tools)

		const stream = await client.responses.create({
			model: model.id,
			instructions: systemPrompt,
			input: input,
			max_output_tokens: model.info.maxTokens,
			temperature: 0,
			stream: true,
			store: false, // Don't store responses server-side for privacy
			tools: responseTools.length > 0 ? responseTools : undefined,
			tool_choice: responseTools.length > 0 ? "auto" : undefined,
			include: ["reasoning.encrypted_content"],
		})

		yield* handleResponsesApiStreamResponse(
			stream,
			model.info,
			async (modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens) =>
				calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens),
		)
	}

	getModel(): { id: XAIModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in xaiModels) {
			const id = modelId as XAIModelId
			return { id, info: xaiModels[id] }
		}
		return {
			id: xaiDefaultModelId,
			info: xaiModels[xaiDefaultModelId],
		}
	}
}
