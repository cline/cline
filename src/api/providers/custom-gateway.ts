import { Anthropic } from "@anthropic-ai/sdk"
import axios, { AxiosInstance } from "axios"
import { ApiHandler } from "../"
import { ApiHandlerOptions, CustomGatewayConfig, CustomGatewayModel, HealthCheckConfig, ModelInfo } from "../../shared/api"
import { convertMessages, validateMessageFormat } from "../transform/custom-gateway-format"
import { ApiStream, ApiStreamChunk } from "../transform/stream"

interface HealthCheckRequest {
	type: "ping"
	timestamp?: number
}

interface HealthCheckResponse {
	type: "pong"
	status: "healthy" | "degraded" | "unhealthy"
	timestamp?: number
	message?: string
}

interface HealthStatusMessage {
	type: "customGatewayHealthStatus"
	healthStatus: {
		status: "healthy" | "degraded" | "unhealthy"
		message?: string
		timestamp?: number
	}
}

export class CustomGatewayHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private config: CustomGatewayConfig
	private client: AxiosInstance
	private modelListCache?: CustomGatewayModel[]
	private modelListLastFetched?: number
	private cachedModel?: { id: string; info: ModelInfo }

	private debugLog(message: string, data?: any) {
		if (this.config.debug) {
			const timestamp = new Date().toISOString()
			const logMessage = `[Custom Gateway Debug] ${timestamp} - ${message}`
			this.options.outputChannel?.appendLine(logMessage)
			if (data) {
				this.options.outputChannel?.appendLine(JSON.stringify(data, null, 2))
			}
			console.log(logMessage, data)
		}
	}

	constructor(options: ApiHandlerOptions) {
		if (!options.customGatewayConfig) {
			throw new Error("Custom gateway configuration is required")
		}

		this.options = options
		this.config = options.customGatewayConfig

		// Validate required configuration
		if (!this.config.baseUrl) {
			throw new Error("Base URL is required")
		}
		if (!this.config.compatibilityMode) {
			throw new Error("Compatibility mode is required")
		}

		// Create axios client with base configuration
		this.client = axios.create({
			baseURL: this.getFullBaseUrl(),
			headers: this.buildHeaders(),
		})
	}

	private getFullBaseUrl(): string {
		const baseUrl = this.config.baseUrl.endsWith("/") ? this.config.baseUrl.slice(0, -1) : this.config.baseUrl
		const pathPrefix = this.config.pathPrefix
			? this.config.pathPrefix.startsWith("/")
				? this.config.pathPrefix
				: `/${this.config.pathPrefix}`
			: ""
		return `${baseUrl}${pathPrefix}`
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}
		for (const header of this.config.headers) {
			headers[header.key] = header.value
		}
		return headers
	}

	private sendHealthStatus(response: HealthCheckResponse) {
		// Send health status to webview
		this.options.webview?.postMessage({
			type: "customGatewayHealthStatus",
			healthStatus: {
				status: response.status,
				message: response.message,
				timestamp: response.timestamp,
			},
		} as HealthStatusMessage)
	}

	async performHealthCheck() {
		try {
			const model = await this.getModel()
			const endpoint = "/chat/completions"
			const requestData = {
				model: model.id,
				messages: [
					{
						role: "user",
						content: "If you are working correctly, please respond to this with ONLY PONG!",
					},
				],
			}

			let isValidResponse = false

			try {
				const timeout = this.config.healthCheck?.timeout ?? 10000
				this.debugLog("Sending health check request", {
					endpoint,
					timeout,
					model: model.id,
					requestData,
				})
				const response = await this.client.post(endpoint, requestData, {
					timeout: timeout,
				})
				this.debugLog("Received health check response", {
					status: response.status,
					headers: response.headers,
					data: response.data,
				})

				// Validate response based on compatibility mode
				switch (this.config.compatibilityMode) {
					case "openai":
						// Check for OpenAI response format
						if (
							response.data.choices?.[0]?.message?.role === "assistant" &&
							typeof response.data.choices[0].message.content === "string"
						) {
							isValidResponse = true
						}
						break
					case "anthropic":
						// Check for Anthropic response format
						if (
							response.data.content?.[0]?.text ||
							(response.data.choices?.[0]?.message?.content && !response.data.choices[0].message.role)
						) {
							isValidResponse = true
						}
						break
					case "bedrock":
						// Check for Bedrock response format (which follows AWS Bedrock's format)
						if (
							response.data.completion ||
							response.data.results?.[0]?.outputText ||
							(response.data.choices?.[0]?.message?.content && response.data.requestId)
						) {
							isValidResponse = true
						}
						break
					default: // Fallback for unknown compatibility modes
						// For unknown compatibility modes, check for any reasonable response format
						if (
							response.data.choices?.[0]?.message?.content ||
							response.data.content?.[0]?.text ||
							response.data.response ||
							response.data.output ||
							response.data.generated_text
						) {
							isValidResponse = true
						}
				}
			} catch (requestError) {
				this.debugLog("Request failed", requestError)
				throw requestError
			}

			if (isValidResponse) {
				this.sendHealthStatus({
					type: "pong",
					status: "healthy",
					message: "Connection successful",
					timestamp: Date.now(),
				})
			} else {
				this.sendHealthStatus({
					type: "pong",
					status: "unhealthy",
					message: "Invalid response from model",
					timestamp: Date.now(),
				})
			}
		} catch (error) {
			this.debugLog("Health check failed", error)
			this.sendHealthStatus({
				type: "pong",
				status: "unhealthy",
				message: error instanceof Error ? error.message : String(error),
				timestamp: Date.now(),
			})
		}
	}

	async fetchModelList(): Promise<CustomGatewayModel[]> {
		if (!this.config.modelListSource) {
			if (!this.config.defaultModel) {
				throw new Error("Either modelListSource or defaultModel must be provided")
			}
			return [this.config.defaultModel]
		}

		// Check cache
		const cacheExpiry = 5 * 60 * 1000 // 5 minutes
		if (this.modelListCache && this.modelListLastFetched && Date.now() - this.modelListLastFetched < cacheExpiry) {
			return this.modelListCache
		}

		try {
			const response = await this.client.get(this.config.modelListSource)
			const models = response.data.models as CustomGatewayModel[]
			this.modelListCache = models
			this.modelListLastFetched = Date.now()
			return models
		} catch (error) {
			this.options.outputChannel?.appendLine(
				`Failed to fetch model list: ${error instanceof Error ? error.message : String(error)}`,
			)
			if (this.config.defaultModel) {
				return [this.config.defaultModel]
			}
			throw error
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		this.debugLog("Starting Message Creation")
		const model = await this.getModel()
		const endpoint = "/chat/completions"
		const requestMessages = convertMessages(this.config.compatibilityMode, systemPrompt, messages)
		validateMessageFormat(this.config.compatibilityMode, requestMessages)

		const requestData = {
			model: model.id,
			messages: requestMessages,
			stream: true,
		}

		this.debugLog("Request details", {
			endpoint,
			baseUrl: this.getFullBaseUrl(),
			headers: this.buildHeaders(),
			requestData,
		})

		try {
			this.debugLog("Sending streaming request")
			const response = await this.client.post(endpoint, requestData, {
				responseType: "stream",
			})

			this.debugLog("Received streaming response", {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			})

			for await (const chunk of response.data) {
				const lines = chunk.toString().split("\n")
				for (const line of lines) {
					if (line.startsWith("data: ")) {
						// Skip empty lines or "[DONE]" message
						if (line === "data: " || line === "data: [DONE]") {
							continue
						}

						this.debugLog("Received SSE data", { line })

						let content: string | undefined

						try {
							// Parse the JSON data after the "data: " prefix
							const jsonStr = line.substring(6) // length of "data: "

							// Skip incomplete JSON
							if (!jsonStr.trim() || jsonStr.trim().length < 2) {
								this.debugLog("Skipping empty or incomplete JSON", { jsonStr })
								continue
							}

							try {
								const data = JSON.parse(jsonStr)

								if (data.error) {
									throw new Error(`Gateway API Error: ${data.error.message}`)
								}

								const delta = data.choices?.[0]?.delta
								// Skip if this is just the initial message structure with empty content
								if (delta?.role === "assistant" && !delta.content) {
									continue
								}

								// Only yield when we have actual content
								if (delta?.content) {
									yield {
										type: "text",
										text: delta.content,
									} as ApiStreamChunk
								}
							} catch (parseError) {
								// Log the error but don't throw it - allow the stream to continue
								this.debugLog("JSON parse warning", { error: parseError, jsonStr })
								continue
							}
						} catch (streamError) {
							this.debugLog("Stream processing error", { error: streamError, line })
							throw streamError
						}
					}
				}
			}

			// Final usage info if available
			if (response.headers["x-usage"]) {
				try {
					const usage = JSON.parse(response.headers["x-usage"])
					yield {
						type: "usage",
						inputTokens: usage.prompt_tokens || 0,
						outputTokens: usage.completion_tokens || 0,
						totalCost: usage.total_cost || 0,
					} as ApiStreamChunk
				} catch (error) {
					this.debugLog("Failed to parse usage info", error)
				}
			}
		} catch (error) {
			this.debugLog("Error in message creation", error)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		this.debugLog("Getting model")
		if (!this.cachedModel) {
			// Initialize with default model if available
			if (this.config.defaultModel) {
				this.cachedModel = this.config.defaultModel
			} else {
				throw new Error("No model available. Configure defaultModel or fetch from modelListSource.")
			}

			// Fetch model list in background to update cache
			this.fetchModelList()
				.then((models) => {
					if (models.length > 0) {
						this.cachedModel = models[0]
					}
				})
				.catch((error) => {
					this.debugLog("Failed to update model cache", error)
				})
		}
		return this.cachedModel
	}
}
