import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import { OpenRouterErrorResponse } from "./types"
import { withRetry } from "../retry"
import { AuthService } from "@/services/auth/AuthService"

export class ClineHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private clineAccountService = ClineAccountService.getInstance()
	private _authService: AuthService
	// TODO: replace this with a global API Host
	private readonly _baseUrl = "https://api.cline.bot"
	// private readonly _baseUrl = "https://core-api.staging.int.cline.bot"
	// private readonly _baseUrl = "http://localhost:7777"
	lastGenerationId?: string
	private counter = 0

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this._authService = AuthService.getInstance()
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const clineAccountAuthToken = await this._authService.getAuthToken()

		this.lastGenerationId = undefined

		const requestConfig: AxiosRequestConfig = {
			headers: {
				"HTTP-Referer": "https://cline.bot", // Optional, for including your app on cline.bot rankings.
				"X-Title": "Cline", // Optional. Shows in rankings on cline.bot.
				"X-Task-ID": this.options.taskId || "", // Include the task ID in the request headers
				Authorization: `Bearer ${clineAccountAuthToken}`,
			},
			timeout: 15_000, // Set a timeout for requests to avoid hanging
		}

		const me = await this.clineAccountService.fetchMe()
		console.log(
			"SwitchAuthToken: Active Organization",
			me?.organizations.filter((org) => org.active)[0]?.name || "No active organization",
		)

		let didOutputUsage: boolean = false

		const url = `${this._baseUrl}/api/v1/chat/completions`
		try {
			const response = await axios.post(
				url,
				{
					model: this.getModel().id,
					messages: [
						{
							role: "system",
							content: systemPrompt,
						},
						...messages,
					],
					stream: false,
					// reasoning_effort: this.options.reasoningEffort || "low",
					// thinking_budget_tokens: this.options.thinkingBudgetTokens || 0,
					// open_router_provider_sorting: this.options.openRouterProviderSorting || "default",
				},
				requestConfig,
			)

			if (!response.data || !response.data.data) {
				throw new Error(`Request to ${url} failed with status ${response.status}`)
			}

			if (!response.data.data.choices || response.data.data.choices.length === 0) {
				throw new Error(`No choices returned from Cline API: ${JSON.stringify(response.data)}`)
			}

			for (const choice of response.data.data.choices) {
				if (choice.finish_reason === "error") {
					const error = choice.error || { code: "Unknown", message: "No error details provided" }
					console.error(`Cline API Error: ${error.code} - ${error.message}`)
					throw new Error(`Cline API Error: ${error.code} - ${error.message}`)
				}
				if (choice.delta && choice.delta.content) {
					yield {
						type: "text",
						text: choice.delta.content,
					}
				}
				if (choice.delta && choice.delta.reasoning) {
					yield {
						type: "reasoning",
						reasoning: choice.delta.reasoning,
					}
				}
				if (choice.message && choice.message.content) {
					yield {
						type: "text",
						text: choice.message.content,
					}
				}
				if (choice.usage) {
					const totalCost = choice.usage.cost || 0
					yield {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: choice.usage.cached_tokens || 0,
						inputTokens: choice.usage.prompt_tokens || 0,
						outputTokens: choice.usage.completion_tokens || 0,
						totalCost,
					}
				}
			}

			if (response.data.data.usage) {
				didOutputUsage = true
				yield {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: response.data.data.usage.prompt_tokens_details?.cached_tokens || 0,
					inputTokens: response.data.data.usage.prompt_tokens || 0,
					outputTokens: response.data.data.usage.completion_tokens || 0,
					totalCost: response.data.data.usage.cost || 0,
				}
			}

			// for await (const chunk of stream) {
			// 	// openrouter returns an error object instead of the openai sdk throwing an error
			// 	if ("error" in chunk) {
			// 		const error = chunk.error as OpenRouterErrorResponse["error"]
			// 		console.error(`Cline API Error: ${error?.code} - ${error?.message}`)
			// 		// Include metadata in the error message if available
			// 		const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
			// 		throw new Error(`Cline API Error ${error.code}: ${error.message}${metadataStr}`)
			// 	}
			// 	if (!this.lastGenerationId && chunk.id) {
			// 		this.lastGenerationId = chunk.id
			// 	}

			// 	// Check for mid-stream error via finish_reason
			// 	const choice = chunk.choices?.[0]
			// 	// OpenRouter may return finish_reason = "error" with error details
			// 	if ((choice?.finish_reason as string) === "error") {
			// 		const choiceWithError = choice as any
			// 		if (choiceWithError.error) {
			// 			const error = choiceWithError.error
			// 			console.error(`Cline Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
			// 			throw new Error(`Cline Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
			// 		} else {
			// 			throw new Error("Cline Mid-Stream Error: Stream terminated with error status but no error details provided")
			// 		}
			// 	}

			// 	const delta = choice?.delta
			// 	if (delta?.content) {
			// 		yield {
			// 			type: "text",
			// 			text: delta.content,
			// 		}
			// 	}

			// 	// Reasoning tokens are returned separately from the content
			// 	if ("reasoning" in delta && delta.reasoning) {
			// 		yield {
			// 			type: "reasoning",
			// 			// @ts-ignore-next-line
			// 			reasoning: delta.reasoning,
			// 		}
			// 	}

			// 	if (!didOutputUsage && chunk.usage) {
			// 		// @ts-ignore-next-line
			// 		let totalCost = (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0)
			// 		const modelId = this.getModel().id
			// 		const provider = modelId.split("/")[0]

			// 		// If provider is x-ai, set totalCost to 0 (we're doing a promo)
			// 		if (provider === "x-ai") {
			// 			totalCost = 0
			// 		}

			// 		if (modelId.includes("gemini")) {
			// 			yield {
			// 				type: "usage",
			// 				cacheWriteTokens: 0,
			// 				cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
			// 				inputTokens: (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0),
			// 				outputTokens: chunk.usage.completion_tokens || 0,
			// 				// @ts-ignore-next-line
			// 				totalCost,
			// 			}
			// 		} else {
			// 			yield {
			// 				type: "usage",
			// 				cacheWriteTokens: 0,
			// 				cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
			// 				inputTokens: chunk.usage.prompt_tokens || 0,
			// 				outputTokens: chunk.usage.completion_tokens || 0,
			// 				// @ts-ignore-next-line
			// 				totalCost,
			// 			}
			// 		}
			// 		didOutputUsage = true
			// 	}
			// }

			// Fallback to generation endpoint if usage chunk not returned
			if (!didOutputUsage) {
				console.warn("Cline API did not return usage chunk, fetching from generation endpoint")
				// const apiStreamUsage = await this.getApiStreamUsage()
				// if (apiStreamUsage) {
				// 	yield apiStreamUsage
				// }
			}
		} catch (error) {
			console.error("Cline API Error:", error)
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			try {
				// TODO: replace this with firebase auth
				// TODO: use global API Host

				const response = await axios.get(`${this.clineAccountService.baseUrl}/generation?id=${this.lastGenerationId}`, {
					headers: {
						Authorization: `Bearer ${this.options.clineAccountId}`,
					},
					timeout: 15_000, // this request hangs sometimes
				})

				const generation = response.data
				let modelId = this.options.openRouterModelId
				if (modelId && modelId.includes("gemini")) {
					return {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: generation?.native_tokens_cached || 0,
						// openrouter generation endpoint fails often
						inputTokens: (generation?.native_tokens_prompt || 0) - (generation?.native_tokens_cached || 0),
						outputTokens: generation?.native_tokens_completion || 0,
						totalCost: generation?.total_cost || 0,
					}
				} else {
					return {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: generation?.native_tokens_cached || 0,
						// openrouter generation endpoint fails often
						inputTokens: generation?.native_tokens_prompt || 0,
						outputTokens: generation?.native_tokens_completion || 0,
						totalCost: generation?.total_cost || 0,
					}
				}
			} catch (error) {
				// ignore if fails
				console.error("Error fetching cline generation details:", error)
			}
		}
		return undefined
	}

	getModel(): { id: string; info: ModelInfo } {
		let modelId = this.options.openRouterModelId
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
