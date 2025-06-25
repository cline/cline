/**
 * Gemini CLI Provider - OAuth-based API Handler
 *
 * This implementation provides access to Google's Gemini models through OAuth authentication,
 * leveraging the same authentication mechanism as the official Gemini CLI tool.
 *
 * Attribution: This implementation is inspired by and uses concepts from the Google Gemini CLI,
 * which is licensed under the Apache License 2.0.
 * Original project: https://github.com/google-gemini/gemini-cli
 *
 * Copyright 2025 Google LLC
 * Licensed under the Apache License, Version 2.0
 *
 * Key features:
 * - OAuth2 authentication (no API keys required)
 * - Auto-discovery of Google Cloud project IDs
 * - Real-time streaming via Server-Sent Events
 * - Free tier access through Google's Code Assist API
 * - Compatible with personal Google accounts only
 */

import type { Anthropic } from "@anthropic-ai/sdk"
import { OAuth2Client } from "google-auth-library"
import fs from "fs/promises"
import path from "path"
import os from "os"
import * as readline from "readline"
import { Readable } from "stream"
import { ApiHandler } from "../"
import { ApiHandlerOptions, GeminiCliModelId, geminiCliModels, ModelInfo, geminiCliDefaultModelId } from "@shared/api"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"

// OAuth configuration
const OAUTH_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
// Change this line in setup.js:
const OAUTH_CLIENT_SECRET = "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"

const OAUTH_REDIRECT_URI = "http://localhost:45289"

interface OAuthCredentials {
	access_token: string
	refresh_token: string
	scope: string
	token_type: string
	expiry_date: number
}

interface GeminiCliHandlerOptions extends ApiHandlerOptions {
	geminiCliOAuthPath?: string
	geminiCliProjectId?: string
}

/**
 * Handler for Google's Gemini API via OAuth (Gemini CLI style).
 *
 * This provider uses OAuth authentication instead of API keys, making it suitable
 * for users who have already authenticated with the Gemini CLI tool.
 * It automatically discovers project IDs and works with the free tier.
 */
export class GeminiCliHandler implements ApiHandler {
	private options: GeminiCliHandlerOptions
	private authClient: OAuth2Client
	private projectId: string | null = null
	private authInitialized: boolean = false

	constructor(options: GeminiCliHandlerOptions) {
		this.options = options
		this.authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI)
	}

	/**
	 * Load OAuth credentials from the file system
	 */
	private async loadOAuthCredentials(): Promise<OAuthCredentials> {
		const credPath = this.options.geminiCliOAuthPath || path.join(os.homedir(), ".gemini", "oauth_creds.json")
		try {
			const data = await fs.readFile(credPath, "utf8")
			return JSON.parse(data)
		} catch (err) {
			throw new Error(`Failed to load OAuth credentials from ${credPath}. Please authenticate with 'gemini auth' first.`)
		}
	}

	/**
	 * Call a Code Assist API endpoint
	 */
	private async callEndpoint(method: string, body: any, retryAuth: boolean = true): Promise<any> {
		console.log(`[GeminiCLI] Calling endpoint: ${method}`)
		console.log(`[GeminiCLI] Request body:`, JSON.stringify(body, null, 2))

		try {
			const res = await this.authClient.request({
				url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				responseType: "json",
				body: JSON.stringify(body),
			})
			console.log(`[GeminiCLI] Response status:`, res.status)
			console.log(`[GeminiCLI] Response data:`, JSON.stringify(res.data, null, 2))
			return res.data
		} catch (error: any) {
			console.error(`[GeminiCLI] Error calling ${method}:`, error)
			console.error(`[GeminiCLI] Error response:`, error.response?.data)
			console.error(`[GeminiCLI] Error status:`, error.response?.status)
			console.error(`[GeminiCLI] Error message:`, error.message)

			// If we get a 401 and haven't retried yet, try refreshing auth
			if (error.response?.status === 401 && retryAuth) {
				console.log(`[GeminiCLI] Got 401, attempting to refresh authentication...`)
				await this.initializeAuth(true) // Force refresh
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
			return this.options.geminiCliProjectId
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

			// Poll until operation is complete
			while (!lroResponse.done) {
				await new Promise((resolve) => setTimeout(resolve, 2000))
				lroResponse = await this.callEndpoint("onboardUser", onboardRequest)
			}

			const discoveredProjectId = lroResponse.response?.cloudaicompanionProject?.id || initialProjectId
			this.projectId = discoveredProjectId
			return this.projectId as string
		} catch (error: any) {
			console.error("Failed to discover project ID:", error.response?.data || error.message)
			throw new Error("Could not discover project ID. Make sure you're authenticated with 'gemini auth'.")
		}
	}

	/**
	 * Initialize the OAuth client with credentials
	 */
	private async initializeAuth(forceRefresh: boolean = false): Promise<void> {
		// Check if we need to initialize or refresh
		if (this.authInitialized && !forceRefresh) {
			// Check if token is still valid
			const credentials = this.authClient.credentials
			if (credentials && credentials.expiry_date && Date.now() < credentials.expiry_date) {
				console.log(`[GeminiCLI] Auth already initialized and token still valid`)
				return
			}
		}

		console.log(`[GeminiCLI] Initializing OAuth authentication...`)
		const credentials = await this.loadOAuthCredentials()
		const isExpired = credentials.expiry_date ? Date.now() > credentials.expiry_date : false

		console.log(`[GeminiCLI] Loaded credentials:`, {
			hasAccessToken: !!credentials.access_token,
			hasRefreshToken: !!credentials.refresh_token,
			tokenType: credentials.token_type,
			expiryDate: credentials.expiry_date,
			isExpired: isExpired,
		})

		this.authClient.setCredentials(credentials)

		// If token is expired and we have a refresh token, try to refresh
		if (isExpired && credentials.refresh_token) {
			console.log(`[GeminiCLI] Token expired, attempting to refresh...`)
			try {
				const { credentials: newCredentials } = await this.authClient.refreshAccessToken()
				console.log(`[GeminiCLI] Token refreshed successfully`)
				// Note: In a real implementation, you'd want to save the new credentials back to the file
				// For now, we'll just use them in memory
			} catch (error) {
				console.error(`[GeminiCLI] Failed to refresh token:`, error)
				// Continue with the expired token - the API might still accept it
			}
		}

		this.authInitialized = true
		console.log(`[GeminiCLI] OAuth client configured`)
	}

	/**
	 * Parse Server-Sent Events from a stream
	 */
	private async *parseSSEStream(stream: Readable): AsyncGenerator<any> {
		const rl = readline.createInterface({
			input: stream,
			crlfDelay: Infinity,
		})

		let bufferedLines: string[] = []

		for await (const line of rl) {
			// Blank lines separate JSON objects in the stream
			if (line === "") {
				if (bufferedLines.length === 0) {
					continue
				}

				try {
					const jsonData = JSON.parse(bufferedLines.join("\n"))
					yield jsonData
				} catch (parseError) {
					console.error("Error parsing JSON chunk:", parseError)
				}

				bufferedLines = []
			} else if (line.startsWith("data: ")) {
				bufferedLines.push(line.slice(6).trim())
			}
		}

		// Process any remaining buffered content
		if (bufferedLines.length > 0) {
			try {
				const jsonData = JSON.parse(bufferedLines.join("\n"))
				yield jsonData
			} catch (parseError) {
				console.error("Error parsing final buffered content:", parseError)
			}
		}
	}

	/**
	 * Create a message using the Gemini CLI OAuth API
	 */
	@withRetry({
		maxRetries: 2,
		baseDelay: 2000,
		maxDelay: 10000,
	})
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Initialize auth if not already done
		await this.initializeAuth()
		// Discover project ID if needed
		const projectId = await this.discoverProjectId()

		// Convert messages to Gemini format
		const contents = messages.map(convertAnthropicMessageToGemini)

		// Get the selected model
		const { id: modelId, info: modelInfo } = this.getModel()

		// Build the request
		const streamRequest = {
			model: modelId,
			project: projectId,
			request: {
				contents: [
					{
						role: "user",
						parts: [{ text: systemPrompt }],
					},
					...contents,
				],
				generationConfig: {
					temperature: 0.7,
					maxOutputTokens: modelInfo.maxTokens || 8192,
				},
			},
		}

		let totalContent = ""
		let promptTokens = 0
		let outputTokens = 0
		let lastUsageMetadata: any = null

		try {
			// Make the streaming request
			const response = await this.authClient.request({
				url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent`,
				method: "POST",
				params: { alt: "sse" },
				headers: {
					"Content-Type": "application/json",
				},
				responseType: "stream",
				body: JSON.stringify(streamRequest),
			})

			// Process the SSE stream
			for await (const jsonData of this.parseSSEStream(response.data as Readable)) {
				// Extract content from the response
				const candidate = jsonData.response?.candidates?.[0]
				if (candidate?.content?.parts?.[0]?.text) {
					const content = candidate.content.parts[0].text
					totalContent += content

					// Yield text chunk
					yield {
						type: "text",
						text: content,
					}
				}

				// Store usage metadata for final reporting
				if (jsonData.response?.usageMetadata) {
					lastUsageMetadata = jsonData.response.usageMetadata
					promptTokens = lastUsageMetadata.promptTokenCount || promptTokens
					outputTokens = lastUsageMetadata.candidatesTokenCount || outputTokens
				}

				// Check if this is the final chunk
				if (candidate?.finishReason) {
					break
				}
			}

			// Yield usage information
			if (lastUsageMetadata) {
				yield {
					type: "usage",
					inputTokens: promptTokens,
					outputTokens: outputTokens,
					totalCost: 0, // Free tier
				}
			}
		} catch (error) {
			// Handle rate limit errors similar to the Gemini provider
			if (error instanceof Error) {
				// Check for rate limit patterns in the error message
				const rateLimitPatterns = [
					/got status: 429/i,
					/429 Too Many Requests/i,
					/rate limit exceeded/i,
					/too many requests/i,
					/quota exceeded/i,
					/resource exhausted/i,
					/code 429/i,
				]

				const isRateLimit = rateLimitPatterns.some((pattern) => pattern.test(error.message))

				if (isRateLimit) {
					const rateLimitError = Object.assign(new Error(error.message), {
						...error,
						status: 429,
					})
					throw rateLimitError
				}
			}

			// Re-throw the original error if it's not a rate limit error
			throw error
		}
	}

	/**
	 * Get the model ID and info
	 */
	getModel(): { id: GeminiCliModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId as GeminiCliModelId
		if (modelId && modelId in geminiCliModels) {
			return { id: modelId, info: geminiCliModels[modelId] }
		}
		return {
			id: geminiCliDefaultModelId,
			info: geminiCliModels[geminiCliDefaultModelId],
		}
	}
}
