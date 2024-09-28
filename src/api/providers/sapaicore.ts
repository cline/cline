import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler, ApiHandlerMessageResponse } from "../"
import {
	ApiHandlerOptions,
	ModelInfo,
	SapAiCoreModelId,
	sapAiCoreModels,
	sapAiCoreDefaultModelId,
} from "../../shared/api"
import axios from "axios"

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
				.map((deployment: any) => ({
					id: deployment.id,
					name: `${deployment.details.resources.backend_details.model.name}:${deployment.details.resources.backend_details.model.version}`,
				}))
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

		const deployment = this.deployments.find((d) => d.name.toLowerCase().includes(modelId.toLowerCase()))
		if (!deployment) {
			throw new Error(`No running deployment found for model ${modelId}`)
		}

		return deployment.id
	}

	private hasDeploymentForModel(modelId: string): boolean {
		return this.deployments?.some((d) => d.name.toLowerCase().includes(modelId.toLowerCase())) ? true : false
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[]
	): Promise<ApiHandlerMessageResponse> {
		const token = await this.getToken()
		const headers = {
			Authorization: `Bearer ${token}`,
			"AI-Resource-Group": this.options.sapAiResourceGroup || "default",
			"Content-Type": "application/json",
		}

		const model = this.getModel()
		const deploymentId = await this.getDeploymentForModel(model.id)

		const payload = {
			max_tokens: model.info.maxTokens,
			system: systemPrompt,
			messages,
			tools,
			tool_choice: { type: "auto" },
			anthropic_version: "bedrock-2023-05-31",
		}

		const url = `${this.options.sapAiCoreBaseUrl}/inference/deployments/${deploymentId}/invoke-with-response-stream`

		try {
			const response = await axios.post(url, JSON.stringify(payload, null, 2), {
				headers,
				responseType: "stream",
			})

			const message = await this.streamCompletion(response.data, model)
			return { message }
		} catch (error) {
			console.error("Error creating message:", error)
			throw new Error("Failed to create message")
		}
	}

	private async streamCompletion(
		stream: any,
		model: { id: SapAiCoreModelId; info: ModelInfo }
	): Promise<Anthropic.Messages.Message> {
		let textContent: string = ""
		let toolCalls: Anthropic.ToolUseBlock[] = []
		let messageId: string | undefined
		let usage: { input_tokens: number; output_tokens: number } = { input_tokens: 0, output_tokens: 0 }
		let currentToolCall: (Anthropic.ToolUseBlock & { input: Record<string, unknown> }) | null = null
		let finishReason: string | null = null

		try {
			for await (const chunk of stream) {
				const lines = chunk.toString().split("\n").filter(Boolean)
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const jsonData = line.slice(6) // Remove ' prefix
						try {
							const data = JSON.parse(jsonData)
							console.log("Received data:", data) // Log the received data for debugging
							if (data.type === "message_start") {
								messageId = data.message.id
								usage.input_tokens = data.message.usage.input_tokens
							} else if (data.type === "content_block_start" || data.type === "content_block_delta") {
								const contentBlock =
									data.type === "content_block_start" ? data.content_block : data.delta

								if (contentBlock.type === "text" || contentBlock.type === "text_delta") {
									textContent += contentBlock.text || ""
								} else if (contentBlock.type === "tool_use") {
									if (data.type === "content_block_start") {
										currentToolCall = {
											type: "tool_use",
											id: contentBlock.id,
											name: contentBlock.name,
											input: contentBlock.input || {},
										}
									}
								} else if (contentBlock.type === "input_json_delta") {
									if (currentToolCall) {
										if (!currentToolCall.input._partial) {
											currentToolCall.input._partial = ""
										}
										currentToolCall.input._partial += contentBlock.partial_json

										// Always try to parse, but don't discard partial data if it fails
										try {
											const parsedJson = JSON.parse(`{${currentToolCall.input._partial}}`)
											// If parsing succeeds, update the input
											Object.assign(currentToolCall.input, parsedJson)
											// Clear the partial data
											delete currentToolCall.input._partial
										} catch (error) {
											// If parsing fails, it's incomplete. We'll keep accumulating.
											console.log("Accumulated partial JSON:", currentToolCall.input._partial)
										}
									}
								}
							} else if (data.type === "content_block_stop") {
								if (currentToolCall) {
									if (currentToolCall.input._partial) {
										try {
											const inputString = `${currentToolCall.input._partial}`
											const finalJson = JSON.parse(inputString)
											Object.assign(currentToolCall.input, finalJson)
											delete currentToolCall.input._partial
										} catch (error) {
											console.error(
												"Failed to parse final JSON for tool call:",
												currentToolCall.input._partial
											)

											currentToolCall.input.unparsedJson = currentToolCall.input._partial
											delete currentToolCall.input._partial
										}
									}
									toolCalls.push(currentToolCall)
									currentToolCall = null
								}
							} else if (data.type === "message_delta") {
								if (data.usage) {
									usage.output_tokens = data.usage.output_tokens
								}
								if (data.stop_reason) {
									finishReason = data.stop_reason
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

		const anthropicMessage: Anthropic.Messages.Message = {
			id: messageId || `sap-ai-core-${Date.now()}`,
			type: "message",
			role: "assistant",
			content: [
				{
					type: "text",
					text: textContent,
				},
				...toolCalls,
			],
			model: model.id,
			stop_reason: this.mapStopReason(finishReason) || (toolCalls.length > 0 ? "tool_use" : "end_turn"),
			stop_sequence: null,
			usage: usage,
		}

		return anthropicMessage
	}

	private mapStopReason(reason: string | null): Anthropic.Messages.Message["stop_reason"] {
		switch (reason) {
			case "max_tokens":
				return "max_tokens"
			case "stop_sequence":
				return "stop_sequence"
			case "tool_use":
				return "tool_use"
			case "end_turn":
			case "stop":
				return "end_turn"
			default:
				return null
		}
	}

	createUserReadableRequest(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
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
