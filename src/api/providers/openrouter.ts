import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import delay from "delay"

// Custom types for OpenRouter's cache control
type CacheControl = {
	type: "ephemeral"
}

type OpenRouterTextContent = {
	type: "text"
	text: string
	cache_control?: CacheControl
}

type OpenRouterImageContent = {
	type: "image_url"
	image_url: { url: string }
}

type OpenRouterContentPart = OpenRouterTextContent | OpenRouterImageContent

type OpenRouterMessage = {
	role: "system" | "user" | "assistant" | "function"
	content: string | OpenRouterContentPart[]
	name?: string
	function_call?: OpenAI.Chat.ChatCompletionMessage["function_call"]
}

const ANTHROPIC_MODELS = [
	"anthropic/claude-3-opus",
	"anthropic/claude-3-sonnet",
	"anthropic/claude-3.5-sonnet",
	"anthropic/claude-3.5-sonnet-20240620",
	"anthropic/claude-3-haiku",
	"anthropic/claude-3-5-haiku",
	"anthropic/claude-3-5-haiku-20241022",
	"anthropic/claude-3-opus:beta",
	"anthropic/claude-3-sonnet:beta",
	"anthropic/claude-3.5-sonnet:beta",
	"anthropic/claude-3.5-sonnet-20240620:beta",
	"anthropic/claude-3-haiku:beta",
	"anthropic/claude-3-5-haiku:beta",
	"anthropic/claude-3-5-haiku-20241022:beta"
]

// Threshold for considering text "large" enough to cache (1000 characters)
const CACHE_SIZE_THRESHOLD = 1000

export class OpenRouterHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private isAnthropicModel: boolean
	private cacheBreakpointsUsed: number

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.isAnthropicModel = ANTHROPIC_MODELS.includes(options.openRouterModelId || openRouterDefaultModelId)
		this.cacheBreakpointsUsed = 0

		console.log("[OpenRouter] Initializing handler:", {
			model: options.openRouterModelId || openRouterDefaultModelId,
			isAnthropicModel: this.isAnthropicModel
		})

		const defaultHeaders: Record<string, string> = {
			"HTTP-Referer": "https://cline.bot",
			"X-Title": "Cline"
		}

		if (this.isAnthropicModel) {
			defaultHeaders["anthropic-beta"] = "prompt-caching-2024-07-31"
			console.log("[OpenRouter] Added Anthropic beta header for caching")
		}

		this.client = new OpenAI({
			baseURL: "https://openrouter.ai/api/v1",
			apiKey: this.options.openRouterApiKey,
			defaultHeaders
		})
	}

	private shouldCache(text: string): boolean {
		return this.isAnthropicModel && 
			   this.cacheBreakpointsUsed < 4 && 
			   text.length >= CACHE_SIZE_THRESHOLD
	}

	private convertToOpenRouterMessage(msg: OpenAI.Chat.ChatCompletionMessageParam): OpenRouterMessage {
		console.log("[OpenRouter] Converting message:", {
			role: msg.role,
			contentType: typeof msg.content,
			hasArray: Array.isArray(msg.content)
		})

		const role = msg.role as OpenRouterMessage["role"]
		let content: OpenRouterMessage["content"]

		if (typeof msg.content === "string") {
			if (this.shouldCache(msg.content)) {
				content = [{
					type: "text",
					text: msg.content,
					cache_control: { type: "ephemeral" }
				}]
				this.cacheBreakpointsUsed++
				console.log("[OpenRouter] Added cache breakpoint:", {
					textLength: msg.content.length,
					breakpointsUsed: this.cacheBreakpointsUsed
				})
			} else {
				content = msg.content
			}
			console.log("[OpenRouter] Converted string content:", {
				original: msg.content.substring(0, 100) + "...",
				transformed: typeof content === "string" ? content.substring(0, 100) + "..." : "array",
				cached: Array.isArray(content)
			})
		} else if (Array.isArray(msg.content)) {
			content = msg.content.map(part => {
				if ("text" in part) {
					const shouldCacheThis = this.shouldCache(part.text)
					const transformed = {
						type: "text",
						text: part.text,
						...(shouldCacheThis && { cache_control: { type: "ephemeral" } })
					} as OpenRouterTextContent
					if (shouldCacheThis) {
						this.cacheBreakpointsUsed++
						console.log("[OpenRouter] Added cache breakpoint:", {
							textLength: part.text.length,
							breakpointsUsed: this.cacheBreakpointsUsed
						})
					}
					return transformed
				} else if ("image_url" in part) {
					console.log("[OpenRouter] Found image part")
					return {
						type: "image_url",
						image_url: part.image_url
					} as OpenRouterImageContent
				}
				console.warn("[OpenRouter] Unsupported content part:", part)
				throw new Error(`Unsupported content part type: ${JSON.stringify(part)}`)
			})
		} else {
			content = ""
			console.log("[OpenRouter] Empty content")
		}

		const message: OpenRouterMessage = { role, content }

		if ("name" in msg && msg.name) {
			message.name = msg.name
			console.log("[OpenRouter] Added name to message:", msg.name)
		}

		if (msg.role === "assistant" && "function_call" in msg && msg.function_call) {
			message.function_call = msg.function_call
			console.log("[OpenRouter] Added function call to message:", {
				name: msg.function_call.name,
				argsLength: msg.function_call.arguments?.length
			})
		}

		return message
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		console.log("[OpenRouter] Creating message:", {
			systemPromptLength: systemPrompt.length,
			messagesCount: messages.length,
			model: this.getModel().id
		})

		// Reset cache breakpoints counter
		this.cacheBreakpointsUsed = 0

		// Convert messages to OpenRouter format
		const openRouterMessages: OpenRouterMessage[] = [
			this.convertToOpenRouterMessage({ role: "system", content: systemPrompt })
		]

		// Convert and add other messages
		const convertedMessages = convertToOpenAiMessages(messages)
		console.log("[OpenRouter] Converted messages count:", convertedMessages.length)

		// For non-Anthropic models, convert messages directly
		openRouterMessages.push(...convertedMessages.map(msg => this.convertToOpenRouterMessage(msg)))

		console.log("[OpenRouter] Final messages:", {
			count: openRouterMessages.length,
			cacheBreakpointsUsed: this.cacheBreakpointsUsed,
			messages: openRouterMessages.map(msg => ({
				role: msg.role,
				contentType: typeof msg.content,
				partsCount: Array.isArray(msg.content) ? msg.content.length : 'string',
				hasCacheControl: Array.isArray(msg.content) && msg.content.some(part => 'cache_control' in part)
			}))
		})

		// Set max tokens for specific models
		let maxTokens: number | undefined
		const modelId = this.getModel().id
		if (modelId.includes("claude-3-sonnet") || modelId.includes("claude-3.5-sonnet")) {
			maxTokens = 8_192
			console.log("[OpenRouter] Set max tokens:", maxTokens)
		}

		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			max_tokens: maxTokens,
			temperature: 0,
			messages: openRouterMessages as any,
			stream: true
		})

		let genId: string | undefined
		let totalContent = ""

		for await (const chunk of stream) {
			// openrouter returns an error object instead of the openai sdk throwing an error
			if ("error" in chunk) {
				const error = chunk.error as { message?: string; code?: number }
				console.error("[OpenRouter] API Error:", {
					code: error?.code,
					message: error?.message
				})
				throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
			}

			if (!genId && chunk.id) {
				genId = chunk.id
				console.log("[OpenRouter] Received generation ID:", genId)
			}

			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				totalContent += delta.content
				console.log("[OpenRouter] Received content chunk:", {
					length: delta.content.length,
					totalLength: totalContent.length
				})
				yield {
					type: "text",
					text: delta.content,
				}
			}
		}

		console.log("[OpenRouter] Stream completed:", {
			totalContentLength: totalContent.length,
			hasGenId: !!genId
		})

		await delay(500) // FIXME: necessary delay to ensure generation endpoint is ready

		try {
			console.log("[OpenRouter] Fetching generation details:", { genId })
			const response = await axios.get(`https://openrouter.ai/api/v1/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.openRouterApiKey}`,
				},
				timeout: 5_000, // this request hangs sometimes
			})

			const generation = response.data?.data
			console.log("[OpenRouter] Generation details:", {
				inputTokens: generation?.native_tokens_prompt || 0,
				outputTokens: generation?.native_tokens_completion || 0,
				totalCost: generation?.total_cost || 0,
				rawResponse: response.data
			})

			yield {
				type: "usage",
				inputTokens: generation?.native_tokens_prompt || 0,
				outputTokens: generation?.native_tokens_completion || 0,
				totalCost: generation?.total_cost || 0,
			}
		} catch (error) {
			console.error("[OpenRouter] Error fetching generation details:", {
				error: error instanceof Error ? error.message : error,
				genId
			})
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
