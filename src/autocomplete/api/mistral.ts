import * as z from "zod"
import {
	ChatCompletionAssistantMessageParam,
	ChatCompletionChunk,
	ChatCompletionCreateParams,
	ChatCompletionMessageParam,
} from "openai/resources/index.mjs"
import { BaseLlmApi, ChatMessage, FimCreateParamsStreaming, TextMessagePart } from "../types.js"
import { codestralEditPrompt } from "./codestral.js"
import { OpenAIApi, streamSse } from "./openai.js"
import { fetchwithRequestOptions } from "./fetch.js"
import { renderChatMessage } from "../util/stream.js"
import mergeJson from "../../utils/merge.js"

type MistralApiKeyType = "mistral" | "codestral"

export const ClientCertificateOptionsSchema = z.object({
	cert: z.string(),
	key: z.string(),
	passphrase: z.string().optional(),
})

export const RequestOptionsSchema = z.object({
	timeout: z.number().optional(),
	verifySsl: z.boolean().optional(),
	caBundlePath: z.union([z.string(), z.array(z.string())]).optional(),
	proxy: z.string().optional(),
	headers: z.record(z.string()).optional(),
	extraBodyProperties: z.record(z.unknown()).optional(),
	noProxy: z.array(z.string()).optional(),
	clientCertificate: z.lazy(() => ClientCertificateOptionsSchema).optional(),
})

// Base config objects
export const BaseConfig = z.object({
	provider: z.string(),
	requestOptions: RequestOptionsSchema.optional(),
})

export const BasePlusConfig = BaseConfig.extend({
	apiBase: z.string().optional(),
	apiKey: z.string().optional(),
})
const DEFAULT_MAX_TOKENS = 4096

// OpenAI and compatible
export const OpenAIConfigSchema = BasePlusConfig.extend({
	provider: z.union([
		z.literal("openai"),
		z.literal("mistral"),
		z.literal("voyage"),
		z.literal("deepinfra"),
		z.literal("groq"),
		z.literal("nvidia"),
		z.literal("fireworks"),
		z.literal("together"),
		z.literal("novita"),
		z.literal("nebius"),
		z.literal("function-network"),
		z.literal("llama.cpp"),
		z.literal("llamafile"),
		z.literal("lmstudio"),
		z.literal("cerebras"),
		z.literal("kindo"),
		z.literal("msty"),
		z.literal("openrouter"),
		z.literal("sambanova"),
		z.literal("text-gen-webui"),
		z.literal("vllm"),
		z.literal("x-ai"),
		z.literal("scaleway"),
		z.literal("ncompass"),
		z.literal("relace"),
	]),
})

export class LLMError extends Error {
	constructor(
		message: string,
		public llm: Mistral,
	) {
		super(message)
	}
}
export interface APIError extends Error {
	response?: Response
}
export const RETRY_AFTER_HEADER = "Retry-After"

const withExponentialBackoff = async <T>(apiCall: () => Promise<T>, maxTries = 5, initialDelaySeconds = 1) => {
	for (let attempt = 0; attempt < maxTries; attempt++) {
		try {
			const result = await apiCall()
			return result
		} catch (error: any) {
			if ((error as APIError).response?.status === 429) {
				const retryAfter = (error as APIError).response?.headers.get(RETRY_AFTER_HEADER)
				const delay = retryAfter ? parseInt(retryAfter, 10) : initialDelaySeconds * 2 ** attempt
				console.log(`Hit rate limit. Retrying in ${delay} seconds (attempt ${attempt + 1})`)
				await new Promise((resolve) => setTimeout(resolve, delay * 1000))
			} else {
				throw error // Re-throw other errors
			}
		}
	}
	throw new Error(`Failed to make API call after ${maxTries} retries`)
}

function openAICompatible(apiBase: string, config: z.infer<typeof OpenAIConfigSchema>): OpenAIApi {
	return new OpenAIApi({
		...config,
		apiBase: config.apiBase ?? apiBase,
	})
}
export interface ClientCertificateOptions {
	cert: string
	key: string
	passphrase?: string
}

export interface RequestOptions {
	timeout?: number
	verifySsl?: boolean
	caBundlePath?: string | string[]
	proxy?: string
	headers?: { [key: string]: string }
	extraBodyProperties?: { [key: string]: any }
	noProxy?: string[]
	clientCertificate?: ClientCertificateOptions
}

export function fromChatCompletionChunk(chunk: ChatCompletionChunk): ChatMessage | undefined {
	const delta = chunk.choices?.[0]?.delta

	if (delta?.content) {
		return {
			role: "assistant",
			content: delta.content,
		}
	} else if (delta?.tool_calls) {
		return {
			role: "assistant",
			content: "",
			toolCalls: delta?.tool_calls.map((tool_call: any) => ({
				id: tool_call.id,
				type: tool_call.type,
				function: {
					name: tool_call.function.name,
					arguments: tool_call.function.arguments,
				},
			})),
		}
	}

	return undefined
}
export interface Prediction {
	type: "content"
	content:
		| string
		| {
				type: "text"
				text: string
		  }[]
}

export interface Tool {
	type: "function"
	function: {
		name: string
		description?: string
		parameters?: Record<string, any>
		strict?: boolean | null
	}

	displayTitle: string
	wouldLikeTo?: string
	isCurrently?: string
	hasAlready?: string
	readonly: boolean
	uri?: string
	faviconUrl?: string
	group: string
}

interface ToolChoice {
	type: "function"
	function: {
		name: string
	}
}

export interface BaseCompletionOptions {
	temperature?: number
	topP?: number
	topK?: number
	minP?: number
	presencePenalty?: number
	frequencyPenalty?: number
	mirostat?: number
	stop?: string[]
	maxTokens?: number
	numThreads?: number
	useMmap?: boolean
	keepAlive?: number
	raw?: boolean
	stream?: boolean
	prediction?: Prediction
	tools?: Tool[]
	toolChoice?: ToolChoice
	reasoning?: boolean
	reasoningBudgetTokens?: number
}

export interface LLMFullCompletionOptions extends BaseCompletionOptions {
	log?: boolean
	model?: string
}

export interface CompletionOptions extends BaseCompletionOptions {
	model: string
}

export type LlmApiRequestType = "chat" | "streamChat" | "complete" | "streamComplete" | "streamFim" | "embed" | "rerank" | "list"

export function toFimBody(prefix: string, suffix: string, options: CompletionOptions): FimCreateParamsStreaming {
	return {
		model: options.model,
		prompt: prefix,
		suffix,
		max_tokens: options.maxTokens,
		temperature: options.temperature,
		top_p: options.topP,
		frequency_penalty: options.frequencyPenalty,
		presence_penalty: options.presencePenalty,
		stop: options.stop,
		stream: true,
	} as any
}
class Mistral {
	static providerName = "mistral"
	static defaultOptions = {
		apiBase: "https://api.mistral.ai/v1/",
		model: "codestral-latest",
		promptTemplates: {
			edit: codestralEditPrompt,
		},
		maxEmbeddingBatchSize: 128,
	}
	apiKey?: string
	apiBase?: string
	requestOptions?: RequestOptions
	maxStopWords?: number | undefined
	completionOptions: CompletionOptions
	protected openaiAdapter?: BaseLlmApi

	protected _getHeaders() {
		return {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.apiKey}`,
			"api-key": this.apiKey ?? "", // For Azure
		}
	}

	private async autodetectApiKeyType(): Promise<MistralApiKeyType> {
		const mistralResp = await fetch("https://api.mistral.ai/v1/models", {
			method: "GET",
			headers: this._getHeaders(),
		})
		if (mistralResp.status === 401) {
			return "codestral"
		}
		return "mistral"
	}

	constructor(_options: { model: string; apiBase?: string }) {
		if (_options.model.includes("codestral") && !_options.model.includes("mamba")) {
			this.apiBase = _options.apiBase ?? "https://codestral.mistral.ai/v1/"
		}

		if (!this.apiBase?.endsWith("/")) {
			this.apiBase += "/"
		}

		// Unless the user explicitly specifies, we will autodetect the API key type and adjust the API base accordingly
		if (!_options.apiBase) {
			this.autodetectApiKeyType()
				.then((keyType) => {
					switch (keyType) {
						case "codestral":
							this.apiBase = "https://codestral.mistral.ai/v1/"
							break
						case "mistral":
							this.apiBase = "https://api.mistral.ai/v1/"
							break
					}

					this.openaiAdapter = this.createOpenAiAdapter()
				})
				.catch((err: any) => {})
		}
		const options = {
			title: (this.constructor as typeof Mistral).providerName,
			...(this.constructor as typeof Mistral).defaultOptions,
			..._options,
		}
		this.completionOptions = {
			model: options.model || "gpt-4",
			maxTokens: DEFAULT_MAX_TOKENS,
		}
	}

	protected createOpenAiAdapter() {
		return openAICompatible("https://api.mistral.ai/v1/", {
			provider: Mistral.providerName as any,
			apiKey: this.apiKey ?? "",
			apiBase: this.apiBase,
			requestOptions: this.requestOptions,
		})
	}

	private static modelConversion: { [key: string]: string } = {
		"mistral-7b": "open-mistral-7b",
		"mistral-8x7b": "open-mixtral-8x7b",
	}
	protected _convertModelName(model: string): string {
		return Mistral.modelConversion[model] ?? model
	}

	protected toChatMessage(message: ChatMessage): ChatCompletionMessageParam {
		if (message.role === "tool") {
			return {
				role: "tool",
				content: message.content,
				tool_call_id: message.toolCallId,
			}
		}
		if (message.role === "system") {
			return {
				role: "system",
				content: message.content,
			}
		}

		if (message.role === "assistant") {
			const msg: ChatCompletionAssistantMessageParam = {
				role: "assistant",
				content:
					typeof message.content === "string"
						? message.content || " " // LM Studio (and other providers) don't accept empty content
						: message.content.filter((part) => part.type === "text").map((part) => part as TextMessagePart), // can remove with newer typescript version
			}

			if (message.toolCalls) {
				msg.tool_calls = message.toolCalls.map((toolCall) => ({
					id: toolCall.id!,
					type: toolCall.type!,
					function: {
						name: toolCall.function?.name!,
						arguments: toolCall.function?.arguments!,
					},
				}))
			}
			return msg
		} else {
			if (typeof message.content === "string") {
				return {
					role: "user",
					content: message.content ?? " ", // LM Studio (and other providers) don't accept empty content
				}
			}

			// If no multi-media is in the message, just send as text
			// for compatibility with OpenAI-"compatible" servers
			// that don't support multi-media format
			return {
				role: "user",
				content: !message.content.some((item) => item.type !== "text")
					? message.content.map((item) => (item as TextMessagePart).text).join("") || " "
					: message.content.map((part) => {
							if (part.type === "imageUrl") {
								return {
									type: "image_url" as const,
									image_url: {
										url: part.imageUrl.url,
										detail: "auto" as const,
									},
								}
							}
							return part
						}),
			}
		}
	}

	protected toChatBody(messages: ChatMessage[], options: CompletionOptions): ChatCompletionCreateParams {
		const params: ChatCompletionCreateParams = {
			messages: messages.map(this.toChatMessage),
			model: options.model,
			max_tokens: options.maxTokens,
			temperature: options.temperature,
			top_p: options.topP,
			frequency_penalty: options.frequencyPenalty,
			presence_penalty: options.presencePenalty,
			stream: options.stream ?? true,
			stop: options.stop,
			prediction: options.prediction,
			tool_choice: options.toolChoice,
		}

		if (options.tools?.length) {
			params.tools = options.tools.map((tool) => ({
				type: tool.type,
				function: {
					name: tool.function.name,
					description: tool.function.description,
					parameters: tool.function.parameters,
					strict: tool.function.strict,
				},
			}))
		}

		return params
	}

	protected _convertArgs(options: any, messages: ChatMessage[]) {
		const finalOptions = this.toChatBody(messages, options)

		finalOptions.stop = options.stop?.slice(0, this.getMaxStopWords())

		finalOptions.prediction = undefined

		const lastMessage = finalOptions.messages[finalOptions.messages.length - 1]
		if (lastMessage?.role === "assistant") {
			;(lastMessage as any).prefix = true
		}

		return finalOptions
	}

	supportsFim(): boolean {
		return true
	}

	protected getMaxStopWords(): number {
		return Infinity
	}

	fetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
		// Custom Node.js fetch
		const customFetch = async (input: URL | RequestInfo, init: any) => {
			try {
				const resp = await fetchwithRequestOptions(new URL(input as any), { ...init }, { ...this.requestOptions })

				// Error mapping to be more helpful
				if (!resp.ok) {
					let text = await resp.text()
					if (resp.status === 404 && !resp.url.includes("/v1")) {
						const error = JSON.parse(text)?.error?.replace(/"/g, "'")
						let model = error?.match(/model '(.*)' not found/)?.[1]
						if (model && resp.url.match("127.0.0.1:11434")) {
							text = `The model "${model}" was not found. To download it, run \`ollama run ${model}\`.`
							throw new LLMError(text, this) // No need to add HTTP status details
						} else if (text.includes("/api/chat")) {
							text =
								"The /api/chat endpoint was not found. This may mean that you are using an older version of Ollama that does not support /api/chat. Upgrading to the latest version will solve the issue."
						} else {
							text = "This may mean that you forgot to add '/v1' to the end of your 'apiBase' in config.json."
						}
					} else if (resp.status === 404 && resp.url.includes("api.openai.com")) {
						text = "You may need to add pre-paid credits before using the OpenAI API."
					} else if (
						resp.status === 401 &&
						(resp.url.includes("api.mistral.ai") || resp.url.includes("codestral.mistral.ai"))
					) {
						if (resp.url.includes("codestral.mistral.ai")) {
							throw new Error(
								"You are using a Mistral API key, which is not compatible with the Codestral API. Please either obtain a Codestral API key, or use the Mistral API by setting 'apiBase' to 'https://api.mistral.ai/v1' in config.json.",
							)
						} else {
							throw new Error(
								"You are using a Codestral API key, which is not compatible with the Mistral API. Please either obtain a Mistral API key, or use the the Codestral API by setting 'apiBase' to 'https://codestral.mistral.ai/v1' in config.json.",
							)
						}
					}
					throw new Error(`HTTP ${resp.status} ${resp.statusText} from ${resp.url}\n\n${text}`)
				}

				return resp
			} catch (e: any) {
				// Errors to ignore
				if (e.message.includes("/api/tags")) {
					throw new Error(`Error fetching tags: ${e.message}`)
				} else if (e.message.includes("/api/show")) {
					throw new Error(
						`HTTP ${e.response.status} ${e.response.statusText} from ${e.response.url}\n\n${e.response.body}`,
					)
				} else {
					if (e.name !== "AbortError") {
						// Don't pollute console with abort errors. Check on name instead of instanceof, to avoid importing node-fetch here
						console.debug(
							`${e.message}\n\nCode: ${e.code}\nError number: ${e.errno}\nSyscall: ${e.erroredSysCall}\nType: ${e.type}\n\n${e.stack}`,
						)
					}
				}
				//if e instance of LLMError, rethrow
				if (e instanceof LLMError) {
					throw e
				}
				throw new Error(e.message)
			}
		}
		return withExponentialBackoff<Response>(() => customFetch(url, init) as any, 5, 0.5)
	}

	protected async *_streamFim(
		prefix: string,
		suffix: string,
		signal: AbortSignal,
		options: CompletionOptions,
	): AsyncGenerator<string> {
		// console.log(prefix, suffix, options.model)
		const endpoint = new URL("fim/completions", this.apiBase)
		const resp = await this.fetch(endpoint, {
			method: "POST",
			body: JSON.stringify({
				model: options.model,
				prompt: prefix,
				suffix,
				max_tokens: options.maxTokens,
				temperature: options.temperature,
				top_p: options.topP,
				frequency_penalty: options.frequencyPenalty,
				presence_penalty: options.presencePenalty,
				stop: options.stop,
				stream: true,
			}),
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				"x-api-key": this.apiKey ?? "",
				Authorization: `Bearer ${this.apiKey}`,
			},
			signal,
		})
		for await (const chunk of streamSse(resp)) {
			yield chunk.choices[0].delta.content
		}
	}

	private _parseCompletionOptions(options: LLMFullCompletionOptions) {
		const log = options.log ?? true
		const raw = options.raw ?? false
		options.log = undefined

		const completionOptions: CompletionOptions = mergeJson(this.completionOptions, options)

		return { completionOptions, logEnabled: log, raw }
	}
	protected useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = []

	private shouldUseOpenAIAdapter(requestType: LlmApiRequestType) {
		return this.useOpenAIAdapterFor.includes(requestType) || this.useOpenAIAdapterFor.includes("*")
	}

	async *streamFim(
		prefix: string,
		suffix: string,
		signal: AbortSignal,
		options: LLMFullCompletionOptions = {},
	): AsyncGenerator<string> {
		const { completionOptions, logEnabled } = this._parseCompletionOptions(options)

		const fimLog = `Prefix: ${prefix}\nSuffix: ${suffix}`

		let completion = ""

		// if (this.shouldUseOpenAIAdapter("streamFim") && this.openaiAdapter) {
		// 	const stream = this.openaiAdapter.fimStream(toFimBody(prefix, suffix, completionOptions), signal)
		// 	for await (const chunk of stream) {
		// 		const result = fromChatCompletionChunk(chunk)
		// 		if (result) {
		// 			const content = renderChatMessage(result)
		// 			completion += content
		// 			yield content
		// 		}
		// 	}
		// } else {
		for await (const chunk of this._streamFim(prefix, suffix, signal, completionOptions)) {
			completion += chunk
			yield chunk
		}
		// }

		// this._logTokensGenerated(completionOptions.model, fimLog, completion)

		// if (logEnabled && this.writeLog) {
		// 	await this.writeLog(`Completion:\n${completion}\n\n`)
		// }

		return {
			prompt: fimLog,
			completion,
			completionOptions,
		}
	}
}

export default Mistral
