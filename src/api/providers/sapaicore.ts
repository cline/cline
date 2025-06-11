import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, sapAiCoreDefaultModelId, SapAiCoreModelId, sapAiCoreModels } from "../../shared/api"
import { convertAnthropicMessagesToBedrock } from "../transform/bedrock-format"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface Deployment {
	id: string
	name: string
}
interface Token {
	access_token: string
	expires_in: number
	scope: string
	jti: string
	token_type: string
	exipres_at: number
}
export class SapAiCoreHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private token?: Token
	private deployments?: Deployment[]

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	private async authenticate(): Promise<Token> {
		const payload = {
			grant_type: "client_credentials",
			client_id: this.options.sapAiCoreClientId || "",
			client_secret: this.options.sapAiCoreClientSecret || "",
		}

		const response = await axios.post(this.options.sapAiCoreTokenUrl || "", payload, {
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
		})
		const token = response.data as Token
		token.exipres_at = Date.now() + token.expires_in * 1000
		return token
	}

	private async getToken(): Promise<string> {
		if (!this.token || this.token.exipres_at < Date.now()) {
			this.token = await this.authenticate()
		}
		return this.token.access_token
	}

	private async getAiCoreDeployments(): Promise<Deployment[]> {
		if (this.options.sapAiCoreClientSecret === "") {
			return [{ id: "notconfigured", name: "ai-core-not-configured" }]
		}

		const token = await this.getToken()
		const headers = {
			Authorization: `Bearer ${token}`,
			"AI-Resource-Group": this.options.sapAiResourceGroup || "default",
			"Content-Type": "application/json",
		}

		const url = `${this.options.sapAiCoreBaseUrl}/lm/deployments?$top=10000&$skip=0`

		try {
			const response = await axios.get(url, { headers })
			const deployments = response.data.resources

			return deployments
				.filter((deployment: any) => deployment.targetStatus === "RUNNING")
				.map((deployment: any) => {
					const model = deployment.details?.resources?.backend_details?.model
					if (!model?.name || !model?.version) {
						return null // Skip this row
					}
					return {
						id: deployment.id,
						name: `${model.name}:${model.version}`,
					}
				})
				.filter((deployment: any) => deployment !== null)
		} catch (error) {
			console.error("Error fetching deployments:", error)
			throw new Error("Failed to fetch deployments")
		}
	}

	private async getDeploymentForModel(modelId: string): Promise<string> {
		// If deployments are not fetched yet or the model is not found in the fetched deployments, fetch deployments
		if (!this.deployments || !this.hasDeploymentForModel(modelId)) {
			this.deployments = await this.getAiCoreDeployments()
		}

		const deployment = this.deployments.find((d) => {
			const deploymentBaseName = d.name.split(":")[0].toLowerCase()
			const modelBaseName = modelId.split(":")[0].toLowerCase()
			return deploymentBaseName === modelBaseName
		})

		if (!deployment) {
			throw new Error(`No running deployment found for model ${modelId}`)
		}

		return deployment.id
	}

	private hasDeploymentForModel(modelId: string): boolean {
		return this.deployments?.some((d) => d.name.split(":")[0].toLowerCase() === modelId.split(":")[0].toLowerCase()) ?? false
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const token = await this.getToken()
		const headers = {
			Authorization: `Bearer ${token}`,
			"AI-Resource-Group": this.options.sapAiResourceGroup || "default",
			"Content-Type": "application/json",
		}

		const model = this.getModel()
		const deploymentId = await this.getDeploymentForModel(model.id)

		const anthropicModels = [
			"anthropic--claude-3.7-sonnet",
			"anthropic--claude-3.5-sonnet",
			"anthropic--claude-3-sonnet",
			"anthropic--claude-3-haiku",
			"anthropic--claude-3-opus",
		]

		const openAIModels = ["gpt-4o", "gpt-4", "gpt-4o-mini", "o1", "gpt-4.1", "gpt-4.1-nano", "o3-mini", "o3", "o4-mini"]

		let url: string
		let payload: any

		if (anthropicModels.includes(model.id)) {
			url = `${this.options.sapAiCoreBaseUrl}/inference/deployments/${deploymentId}/invoke-with-response-stream`

			if (model.id === "anthropic--claude-3.7-sonnet") {
				url = `${this.options.sapAiCoreBaseUrl}/inference/deployments/${deploymentId}/converse-stream`
				payload = {
					inferenceConfig: {
						maxTokens: model.info.maxTokens,
						temperature: 0.0,
					},
					system: systemPrompt ? [{ text: systemPrompt }] : undefined,
					messages: convertAnthropicMessagesToBedrock(messages),
				}
			} else {
				payload = {
					max_tokens: model.info.maxTokens,
					system: systemPrompt,
					messages,
					anthropic_version: "bedrock-2023-05-31",
				}
			}
		} else if (openAIModels.includes(model.id)) {
			let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				...convertToOpenAiMessages(messages),
			]

			url = `${this.options.sapAiCoreBaseUrl}/inference/deployments/${deploymentId}/chat/completions?api-version=2024-12-01-preview`
			payload = {
				stream: true,
				messages: openAiMessages,
				max_tokens: model.info.maxTokens,
				temperature: 0.0,
				frequency_penalty: 0,
				presence_penalty: 0,
				stop: null,
				stream_options: { include_usage: true },
			}

			if (["o1", "o3-mini", "o3", "o4-mini"].includes(model.id)) {
				delete payload.max_tokens
				delete payload.temperature
			}

			if (model.id === "o3-mini") {
				delete payload.stream
				delete payload.stream_options
			}
		} else {
			throw new Error(`Unsupported model: ${model.id}`)
		}

		try {
			const response = await axios.post(url, JSON.stringify(payload, null, 2), {
				headers,
				responseType: "stream",
			})

			if (model.id === "o3-mini") {
				const response = await axios.post(url, JSON.stringify(payload, null, 2), { headers })

				// Yield the usage information
				if (response.data.usage) {
					yield {
						type: "usage",
						inputTokens: response.data.usage.prompt_tokens,
						outputTokens: response.data.usage.completion_tokens,
					}
				}

				// Yield the content
				if (response.data.choices && response.data.choices.length > 0) {
					yield {
						type: "text",
						text: response.data.choices[0].message.content,
					}
				}

				// Final usage yield
				if (response.data.usage) {
					yield {
						type: "usage",
						inputTokens: response.data.usage.prompt_tokens,
						outputTokens: response.data.usage.completion_tokens,
					}
				}
			} else if (openAIModels.includes(model.id)) {
				yield* this.streamCompletionGPT(response.data, model)
			} else if (model.id === "anthropic--claude-3.7-sonnet") {
				yield* this.streamCompletionSonnet37(response.data, model)
			} else {
				yield* this.streamCompletion(response.data, model)
			}
		} catch (error) {
			if (error.response) {
				// The request was made and the server responded with a status code
				// that falls out of the range of 2xx
				console.error("Error status:", error.response.status)
				console.error("Error data:", error.response.data)
				console.error("Error headers:", error.response.headers)

				if (error.response.status === 404) {
					console.error("404 Error reason:", error.response.data)
					throw new Error(`404 Not Found: ${error.response.data}`)
				}
			} else if (error.request) {
				// The request was made but no response was received
				console.error("Error request:", error.request)
				throw new Error("No response received from server")
			} else {
				// Something happened in setting up the request that triggered an Error
				console.error("Error message:", error.message)
				throw new Error(`Error setting up request: ${error.message}`)
			}

			throw new Error("Failed to create message")
		}
	}

	private async *streamCompletion(
		stream: any,
		model: { id: SapAiCoreModelId; info: ModelInfo },
	): AsyncGenerator<any, void, unknown> {
		let usage = { input_tokens: 0, output_tokens: 0 }

		try {
			for await (const chunk of stream) {
				const lines = chunk.toString().split("\n").filter(Boolean)
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const jsonData = line.slice(6)
						try {
							const data = JSON.parse(jsonData)
							console.log("Received data:", data)
							if (data.type === "message_start") {
								usage.input_tokens = data.message.usage.input_tokens
								yield {
									type: "usage",
									inputTokens: usage.input_tokens,
									outputTokens: usage.output_tokens,
								}
							} else if (data.type === "content_block_start" || data.type === "content_block_delta") {
								const contentBlock = data.type === "content_block_start" ? data.content_block : data.delta

								if (contentBlock.type === "text" || contentBlock.type === "text_delta") {
									yield {
										type: "text",
										text: contentBlock.text || "",
									}
								}
							} else if (data.type === "message_delta") {
								if (data.usage) {
									usage.output_tokens = data.usage.output_tokens
									yield {
										type: "usage",
										inputTokens: 0,
										outputTokens: data.usage.output_tokens,
									}
								}
							}
						} catch (error) {
							console.error("Failed to parse JSON data:", error)
						}
					}
				}
			}
		} catch (error) {
			console.error("Error streaming completion:", error)
			throw error
		}
	}

	private async *streamCompletionSonnet37(
		stream: any,
		model: { id: SapAiCoreModelId; info: ModelInfo },
	): AsyncGenerator<any, void, unknown> {
		function toStrictJson(str: string): string {
			// Wrap it in parentheses so JS will treat it as an expression
			const obj = new Function("return " + str)()
			return JSON.stringify(obj)
		}

		let usage = { input_tokens: 0, output_tokens: 0 }

		try {
			// Iterate over the stream and process each chunk
			for await (const chunk of stream) {
				const lines = chunk.toString().split("\n").filter(Boolean)

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const jsonData = line.slice(6)

						try {
							// Parse the incoming JSON data from the stream
							const data = JSON.parse(toStrictJson(jsonData))
							console.log("Received data:", data)

							// Handle metadata (token usage)
							if (data.metadata?.usage) {
								const inputTokens = data.metadata.usage.inputTokens || 0
								const outputTokens = data.metadata.usage.outputTokens || 0

								yield {
									type: "usage",
									inputTokens,
									outputTokens,
								}
							}

							// Handle content block delta (text generation)
							if (data.contentBlockDelta) {
								if (data.contentBlockDelta?.delta?.text) {
									yield {
										type: "text",
										text: data.contentBlockDelta.delta.text,
									}
								}

								// Handle reasoning content if present
								if (data.contentBlockDelta?.delta?.reasoningContent?.text) {
									yield {
										type: "reasoning",
										reasoning: data.contentBlockDelta.delta.reasoningContent.text,
									}
								}
							}
						} catch (error) {
							console.error("Failed to parse JSON data:", error)
							yield {
								type: "text",
								text: `[ERROR] Failed to parse response data: ${error instanceof Error ? error.message : String(error)}`,
							}
						}
					}
				}
			}
		} catch (error) {
			console.error("Error streaming completion:", error)
			yield {
				type: "text",
				text: `[ERROR] Failed to process stream: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	private async *streamCompletionGPT(
		stream: any,
		model: { id: SapAiCoreModelId; info: ModelInfo },
	): AsyncGenerator<any, void, unknown> {
		let currentContent = ""
		let inputTokens = 0
		let outputTokens = 0

		try {
			for await (const chunk of stream) {
				const lines = chunk.toString().split("\n").filter(Boolean)
				for (const line of lines) {
					if (line.trim() === "data: [DONE]") {
						// End of stream, yield final usage
						yield {
							type: "usage",
							inputTokens,
							outputTokens,
						}
						return
					}

					if (line.startsWith("data: ")) {
						const jsonData = line.slice(6)
						try {
							const data = JSON.parse(jsonData)
							console.log("Received GPT data:", data)

							if (data.choices && data.choices.length > 0) {
								const choice = data.choices[0]
								if (choice.delta && choice.delta.content) {
									yield {
										type: "text",
										text: choice.delta.content,
									}
									currentContent += choice.delta.content
								}
							}

							// Handle usage information
							if (data.usage) {
								inputTokens = data.usage.prompt_tokens || inputTokens
								outputTokens = data.usage.completion_tokens || outputTokens
								yield {
									type: "usage",
									inputTokens,
									outputTokens,
								}
							}

							if (data.choices && data.choices[0].finish_reason === "stop") {
								// Final usage yield, if not already provided
								if (!data.usage) {
									yield {
										type: "usage",
										inputTokens,
										outputTokens,
									}
								}
							}
						} catch (error) {
							console.error("Failed to parse GPT JSON data:", error)
						}
					}
				}
			}
		} catch (error) {
			console.error("Error streaming GPT completion:", error)
			throw error
		}
	}

	createUserReadableRequest(
		userContent: Array<
			Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam
		>,
	): any {
		return {
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			system: "(see SYSTEM_PROMPT in src/ClaudeDev.ts)",
			messages: [{ conversation_history: "..." }, { role: "user", content: userContent }],
			tools: "(see tools in src/ClaudeDev.ts)",
			tool_choice: { type: "auto" },
		}
	}

	getModel(): { id: SapAiCoreModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in sapAiCoreModels) {
			const id = modelId as SapAiCoreModelId
			return { id, info: sapAiCoreModels[id] }
		}
		return { id: sapAiCoreDefaultModelId, info: sapAiCoreModels[sapAiCoreDefaultModelId] }
	}
}
