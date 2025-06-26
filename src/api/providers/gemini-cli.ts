import type { Anthropic } from "@anthropic-ai/sdk"
import { OAuth2Client } from "google-auth-library"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import axios from "axios"

import { type ModelInfo, type GeminiCliModelId, geminiCliDefaultModelId, geminiCliModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { t } from "../../i18n"

import { convertAnthropicContentToGemini, convertAnthropicMessageToGemini } from "../transform/gemini-format"
import type { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { BaseProvider } from "./base-provider"

// OAuth2 Configuration (from Cline implementation)
const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const OAUTH_CLIENT_SECRET = "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"
const OAUTH_REDIRECT_URI = "http://localhost:45289"

// Code Assist API Configuration
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"

interface OAuthCredentials {
	access_token: string
	refresh_token: string
	token_type: string
	expiry_date: number
}

export class GeminiCliHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private authClient: OAuth2Client
	private projectId: string | null = null
	private credentials: OAuthCredentials | null = null

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		// Initialize OAuth2 client
		this.authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI)
	}

	private async loadOAuthCredentials(): Promise<void> {
		try {
			const credPath = this.options.geminiCliOAuthPath || path.join(os.homedir(), ".gemini", "oauth_creds.json")
			const credData = await fs.readFile(credPath, "utf-8")
			this.credentials = JSON.parse(credData)

			// Set credentials on the OAuth2 client
			if (this.credentials) {
				this.authClient.setCredentials({
					access_token: this.credentials.access_token,
					refresh_token: this.credentials.refresh_token,
					expiry_date: this.credentials.expiry_date,
				})
			}
		} catch (error) {
			throw new Error(t("common:errors.geminiCli.oauthLoadFailed", { error }))
		}
	}

	private async ensureAuthenticated(): Promise<void> {
		if (!this.credentials) {
			await this.loadOAuthCredentials()
		}

		// Check if token needs refresh
		if (this.credentials && this.credentials.expiry_date < Date.now()) {
			try {
				const { credentials } = await this.authClient.refreshAccessToken()
				if (credentials.access_token) {
					this.credentials = {
						access_token: credentials.access_token!,
						refresh_token: credentials.refresh_token || this.credentials.refresh_token,
						token_type: credentials.token_type || "Bearer",
						expiry_date: credentials.expiry_date || Date.now() + 3600 * 1000,
					}
					// Optionally save refreshed credentials back to file
					const credPath =
						this.options.geminiCliOAuthPath || path.join(os.homedir(), ".gemini", "oauth_creds.json")
					await fs.writeFile(credPath, JSON.stringify(this.credentials, null, 2))
				}
			} catch (error) {
				throw new Error(t("common:errors.geminiCli.tokenRefreshFailed", { error }))
			}
		}
	}

	/**
	 * Call a Code Assist API endpoint
	 */
	private async callEndpoint(method: string, body: any, retryAuth: boolean = true): Promise<any> {
		try {
			const res = await this.authClient.request({
				url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				responseType: "json",
				data: JSON.stringify(body),
			})
			return res.data
		} catch (error: any) {
			console.error(`[GeminiCLI] Error calling ${method}:`, error)
			console.error(`[GeminiCLI] Error response:`, error.response?.data)
			console.error(`[GeminiCLI] Error status:`, error.response?.status)
			console.error(`[GeminiCLI] Error message:`, error.message)

			// If we get a 401 and haven't retried yet, try refreshing auth
			if (error.response?.status === 401 && retryAuth) {
				await this.ensureAuthenticated() // This will refresh the token
				return this.callEndpoint(method, body, false) // Retry without further auth retries
			}

			throw error
		}
	}

	/**
	 * Discover or retrieve the project ID
	 */
	private async discoverProjectId(): Promise<string> {
		// If we already have a project ID, use it
		if (this.options.geminiCliProjectId) {
			this.projectId = this.options.geminiCliProjectId
			return this.projectId
		}

		// If we've already discovered it, return it
		if (this.projectId) {
			return this.projectId
		}

		// Start with a default project ID (can be anything for personal OAuth)
		const initialProjectId = "default"

		// Prepare client metadata
		const clientMetadata = {
			ideType: "IDE_UNSPECIFIED",
			platform: "PLATFORM_UNSPECIFIED",
			pluginType: "GEMINI",
			duetProject: initialProjectId,
		}

		try {
			// Call loadCodeAssist to discover the actual project ID
			const loadRequest = {
				cloudaicompanionProject: initialProjectId,
				metadata: clientMetadata,
			}

			const loadResponse = await this.callEndpoint("loadCodeAssist", loadRequest)

			// Check if we already have a project ID from the response
			if (loadResponse.cloudaicompanionProject) {
				this.projectId = loadResponse.cloudaicompanionProject
				return this.projectId as string
			}

			// If no existing project, we need to onboard
			const defaultTier = loadResponse.allowedTiers?.find((tier: any) => tier.isDefault)
			const tierId = defaultTier?.id || "free-tier"

			const onboardRequest = {
				tierId: tierId,
				cloudaicompanionProject: initialProjectId,
				metadata: clientMetadata,
			}

			let lroResponse = await this.callEndpoint("onboardUser", onboardRequest)

			// Poll until operation is complete with timeout protection
			const MAX_RETRIES = 30 // Maximum number of retries (60 seconds total)
			let retryCount = 0

			while (!lroResponse.done && retryCount < MAX_RETRIES) {
				await new Promise((resolve) => setTimeout(resolve, 2000))
				lroResponse = await this.callEndpoint("onboardUser", onboardRequest)
				retryCount++
			}

			if (!lroResponse.done) {
				throw new Error(t("common:errors.geminiCli.onboardingTimeout"))
			}

			const discoveredProjectId = lroResponse.response?.cloudaicompanionProject?.id || initialProjectId
			this.projectId = discoveredProjectId
			return this.projectId as string
		} catch (error: any) {
			console.error("Failed to discover project ID:", error.response?.data || error.message)
			throw new Error(t("common:errors.geminiCli.projectDiscoveryFailed"))
		}
	}

	/**
	 * Parse Server-Sent Events from a stream
	 */
	private async *parseSSEStream(stream: NodeJS.ReadableStream): AsyncGenerator<any> {
		let buffer = ""

		for await (const chunk of stream) {
			buffer += chunk.toString()
			const lines = buffer.split("\n")
			buffer = lines.pop() || ""

			for (const line of lines) {
				if (line.startsWith("data: ")) {
					const data = line.slice(6).trim()
					if (data === "[DONE]") continue

					try {
						const parsed = JSON.parse(data)
						yield parsed
					} catch (e) {
						console.error("Error parsing SSE data:", e)
					}
				}
			}
		}
	}

	async *createMessage(
		systemInstruction: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await this.ensureAuthenticated()
		const projectId = await this.discoverProjectId()

		const { id: model, info, reasoning: thinkingConfig, maxTokens } = this.getModel()

		// Convert messages to Gemini format
		const contents = messages.map(convertAnthropicMessageToGemini)

		// Prepare request body for Code Assist API - matching Cline's structure
		const requestBody: any = {
			model: model,
			project: projectId,
			request: {
				contents: [
					{
						role: "user",
						parts: [{ text: systemInstruction }],
					},
					...contents,
				],
				generationConfig: {
					temperature: this.options.modelTemperature ?? 0.7,
					maxOutputTokens: this.options.modelMaxTokens ?? maxTokens ?? 8192,
				},
			},
		}

		// Add thinking config if applicable
		if (thinkingConfig) {
			requestBody.request.generationConfig.thinkingConfig = thinkingConfig
		}

		try {
			// Call Code Assist streaming endpoint using OAuth2Client
			const response = await this.authClient.request({
				url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent`,
				method: "POST",
				params: { alt: "sse" },
				headers: {
					"Content-Type": "application/json",
				},
				responseType: "stream",
				data: JSON.stringify(requestBody),
			})

			// Process the SSE stream
			let lastUsageMetadata: any = undefined

			for await (const jsonData of this.parseSSEStream(response.data as NodeJS.ReadableStream)) {
				// Extract content from the response
				const responseData = jsonData.response || jsonData
				const candidate = responseData.candidates?.[0]

				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.text) {
							// Check if this is a thinking/reasoning part
							if (part.thought === true) {
								yield {
									type: "reasoning",
									text: part.text,
								}
							} else {
								yield {
									type: "text",
									text: part.text,
								}
							}
						}
					}
				}

				// Store usage metadata for final reporting
				if (responseData.usageMetadata) {
					lastUsageMetadata = responseData.usageMetadata
				}

				// Check if this is the final chunk
				if (candidate?.finishReason) {
					break
				}
			}

			// Yield final usage information
			if (lastUsageMetadata) {
				const inputTokens = lastUsageMetadata.promptTokenCount ?? 0
				const outputTokens = lastUsageMetadata.candidatesTokenCount ?? 0
				const cacheReadTokens = lastUsageMetadata.cachedContentTokenCount
				const reasoningTokens = lastUsageMetadata.thoughtsTokenCount

				yield {
					type: "usage",
					inputTokens,
					outputTokens,
					cacheReadTokens,
					reasoningTokens,
					totalCost: 0, // Free tier - all costs are 0
				}
			}
		} catch (error: any) {
			console.error("[GeminiCLI] API Error:", error.response?.status, error.response?.statusText)
			console.error("[GeminiCLI] Error Response:", error.response?.data)

			if (error.response?.status === 429) {
				throw new Error(t("common:errors.geminiCli.rateLimitExceeded"))
			}
			if (error.response?.status === 400) {
				throw new Error(
					t("common:errors.geminiCli.badRequest", {
						details: JSON.stringify(error.response?.data) || error.message,
					}),
				)
			}
			throw new Error(t("common:errors.geminiCli.apiError", { error: error.message }))
		}
	}

	override getModel() {
		const modelId = this.options.apiModelId
		// Handle :thinking suffix before checking if model exists
		const baseModelId = modelId?.endsWith(":thinking") ? modelId.replace(":thinking", "") : modelId
		let id =
			baseModelId && baseModelId in geminiCliModels ? (baseModelId as GeminiCliModelId) : geminiCliDefaultModelId
		const info: ModelInfo = geminiCliModels[id]
		const params = getModelParams({ format: "gemini", modelId: id, model: info, settings: this.options })

		// Return the cleaned model ID
		return { id, info, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		await this.ensureAuthenticated()
		const projectId = await this.discoverProjectId()

		try {
			const { id: model } = this.getModel()

			const requestBody = {
				model: model,
				project: projectId,
				request: {
					contents: [{ role: "user", parts: [{ text: prompt }] }],
					generationConfig: {
						temperature: this.options.modelTemperature ?? 0.7,
					},
				},
			}

			const response = await this.authClient.request({
				url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:generateContent`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				data: JSON.stringify(requestBody),
			})

			// Extract text from response
			const responseData = response.data as any
			if (responseData.candidates && responseData.candidates.length > 0) {
				const candidate = responseData.candidates[0]
				if (candidate.content && candidate.content.parts) {
					const textParts = candidate.content.parts
						.filter((part: any) => part.text && !part.thought)
						.map((part: any) => part.text)
						.join("")
					return textParts
				}
			}

			return ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(t("common:errors.geminiCli.completionError", { error: error.message }))
			}
			throw error
		}
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		// For OAuth/free tier, we can't use the token counting API
		// Fall back to the base provider's tiktoken implementation
		return super.countTokens(content)
	}
}
