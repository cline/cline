import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, llamaCppModelInfoSaneDefaults, ModelInfo, openAiModelInfoSaneDefaults } from "../../shared/api"
import { convertToClineToolCalls, convertToOpenAiMessages, convertToOpenAiTools } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

type LlamaCppProps = {
	default_generation_settings: {
		n_ctx: number
		params: {
			n_predict: number
		}
	}
	total_slots: number
	model_path: string
	chat_template: string
	chat_template_tool_use?: string
	build_info: string
	bos_token: string
	eos_token: string
}

export class LlamaCppHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private props?: Promise<LlamaCppProps> | LlamaCppProps
	private baseUrl: string
	private formattedToolCallsCache = new Map<string, string>()
	private lastModelId?: string

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.baseUrl = this.options.llamaCppBaseUrl || "http://localhost:8080"
		this.client = new OpenAI({
			baseURL: this.baseUrl + "/v1",
			apiKey: this.options.llamaCppApiKey ?? "",
		})

		this.props = fetch(this.baseUrl + "/props").then((res) => (this.props = res.json().then((props) => (this.props = props))))
		this.formatToolCalls = this.formatToolCalls.bind(this)
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], tools?: Anthropic.Tool[]): ApiStream {
		const response = await this.client.chat.completions.create({
			model: this.getModel().id,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			tools: tools && convertToOpenAiTools(tools),
		})
		const message = response.choices[0]?.message
		const texts: string[] = []
		if ("reasoning_content" in message) {
			texts.push(`<thinking>${message["reasoning_content"]}</thinking>`)
		}
		if (message.content !== null && message.content !== "") {
			texts.push(message.content)
		}
		if (message.tool_calls) {
			texts.push(...convertToClineToolCalls(message.tool_calls))
		}
		yield {
			type: "text",
			text: texts.join("\n"),
		}
		yield {
			type: "usage",
			inputTokens: response.usage?.prompt_tokens || 0,
			outputTokens: response.usage?.completion_tokens || 0,
		}
	}

	// Formats tool calls using llama-server's /apply-template endpoint
	async formatToolCalls(toolCalls: { name: string; args: unknown }[]): Promise<string> {
		const key = JSON.stringify(toolCalls)
		const cached = this.formattedToolCallsCache.get(key)
		if (cached) {
			return cached
		}
		const props = await this.props!

		const userMsg = {
			role: "user",
			content: "hey",
		}
		const assistantMsg = {
			role: "assistant",
			content: null,
			tool_calls: toolCalls.map(({ name, args }) => ({
				// Dummy id... that doesn't make Mistral Nemo's template to explode.
				id: "0123456789",
				type: "function",
				function: {
					name,
					arguments: JSON.stringify(args),
				},
			})),
		}
		const tools = [
			{
				type: "function",
				function: {
					description: "phony",
					name: "phony",
					parameters: {
						type: "object",
						properties: {},
					},
				},
			},
		]
		const method = "POST"
		const headers = new Headers([["Authorization", `Bearer ${this.options.llamaCppApiKey ?? ""}`]])
		const [{ prompt: prefix }, { prompt: full }] = await Promise.all(
			(
				await Promise.all([
					fetch(
						new Request(this.baseUrl + "/apply-template", {
							headers,
							method,
							body: JSON.stringify({ tools, messages: [userMsg] }),
						}),
					),
					fetch(
						new Request(this.baseUrl + "/apply-template", {
							headers,
							method,
							body: JSON.stringify({ tools, messages: [userMsg, assistantMsg], add_generation_prompt: false }),
						}),
					),
				])
			).map((res) => res.json()),
		)

		let toolCallsStr = full.slice(prefix.length).trim()
		if (toolCallsStr.endsWith(props.eos_token)) {
			toolCallsStr = toolCallsStr.slice(0, -props.eos_token.length).trim()
		}
		this.formattedToolCallsCache.set(key, toolCallsStr)
		return toolCallsStr
	}

	getModel(): { id: string; info: ModelInfo } {
		let id = "undefined"
		let n_ctx = 128 * 1024
		let n_predict = -1
		if (this.props instanceof Promise) {
			console.warn("getModel() called before props are loaded. Returning default values.")
		} else if (this.props) {
			id = this.props.model_path.split("/").pop() ?? "undefined"
			n_ctx = this.props.default_generation_settings.n_ctx
			n_predict = this.props.default_generation_settings.params.n_predict
		}
		if (this.lastModelId !== id) {
			// If the model has changed, clear the cache.
			this.formattedToolCallsCache.clear()
			this.lastModelId = id
		}
		return {
			id,
			info: {
				...llamaCppModelInfoSaneDefaults,
				maxTokens: n_predict,
				contextWindow: n_ctx,
			},
		}
	}
}
