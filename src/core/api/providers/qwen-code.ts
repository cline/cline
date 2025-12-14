import { promises as fs } from "node:fs"
import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, QwenCodeModelId, qwenCodeDefaultModelId, qwenCodeModels } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import * as os from "os"
import * as path from "path"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

// --- Constants for Qwen OAuth2 ---
const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai"
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56"
const QWEN_DIR = ".qwen"
const QWEN_CREDENTIAL_FILENAME = "oauth_creds.json"

interface QwenOAuthCredentials {
	access_token: string
	refresh_token: string
	token_type: string
	expiry_date: number
	resource_url?: string
}

interface QwenCodeHandlerOptions extends CommonApiHandlerOptions {
	qwenCodeOauthPath?: string
	apiModelId?: string
}

function getQwenCachedCredentialPath(customPath?: string): string {
	if (customPath) {
		// Support custom path that starts with ~/ or is absolute
		if (customPath.startsWith("~/")) {
			return path.join(os.homedir(), customPath.slice(2))
		}
		return path.resolve(customPath)
	}
	return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME)
}

function objectToUrlEncoded(data: Record<string, string>): string {
	return Object.keys(data)
		.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
		.join("&")
}

export class QwenCodeHandler implements ApiHandler {
	private options: QwenCodeHandlerOptions
	private credentials: QwenOAuthCredentials | null = null
	private client: OpenAI | undefined

	constructor(options: QwenCodeHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			// Create the client instance with dummy key initially
			// The API key will be updated dynamically via ensureAuthenticated
			this.client = new OpenAI({
				apiKey: "dummy-key-will-be-replaced",
				baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			})
		}
		return this.client
	}

	private async loadCachedQwenCredentials(): Promise<QwenOAuthCredentials> {
		try {
			const keyFile = getQwenCachedCredentialPath(this.options.qwenCodeOauthPath)
			const credsStr = await fs.readFile(keyFile, "utf-8")
			return JSON.parse(credsStr)
		} catch (error) {
			console.error(
				`Error reading or parsing credentials file at ${getQwenCachedCredentialPath(this.options.qwenCodeOauthPath)}`,
			)
			throw new Error(`Failed to load Qwen OAuth credentials: ${error}`)
		}
	}

	private async refreshAccessToken(credentials: QwenOAuthCredentials): Promise<QwenOAuthCredentials> {
		if (!credentials.refresh_token) {
			throw new Error("No refresh token available in credentials.")
		}

		const bodyData = {
			grant_type: "refresh_token",
			refresh_token: credentials.refresh_token,
			client_id: QWEN_OAUTH_CLIENT_ID,
		}

		const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: objectToUrlEncoded(bodyData),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Token refresh failed: ${response.status} ${response.statusText}. Response: ${errorText}`)
		}

		const tokenData = await response.json()

		if (tokenData.error) {
			throw new Error(`Token refresh failed: ${tokenData.error} - ${tokenData.error_description}`)
		}

		const newCredentials = {
			...credentials,
			access_token: tokenData.access_token,
			token_type: tokenData.token_type,
			refresh_token: tokenData.refresh_token || credentials.refresh_token,
			expiry_date: Date.now() + tokenData.expires_in * 1000,
		}

		const filePath = getQwenCachedCredentialPath(this.options.qwenCodeOauthPath)
		await fs.writeFile(filePath, JSON.stringify(newCredentials, null, 2))

		return newCredentials
	}

	private isTokenValid(credentials: QwenOAuthCredentials): boolean {
		const TOKEN_REFRESH_BUFFER_MS = 30 * 1000 // 30s buffer
		if (!credentials.expiry_date) {
			return false
		}
		return Date.now() < credentials.expiry_date - TOKEN_REFRESH_BUFFER_MS
	}

	private async ensureAuthenticated(): Promise<void> {
		if (!this.credentials) {
			this.credentials = await this.loadCachedQwenCredentials()
		}

		if (!this.isTokenValid(this.credentials)) {
			this.credentials = await this.refreshAccessToken(this.credentials)
		}

		// After authentication, update the apiKey and baseURL on the existing client
		const client = this.ensureClient()
		client.apiKey = this.credentials.access_token
		client.baseURL = this.getBaseUrl(this.credentials)
	}

	private getBaseUrl(creds: QwenOAuthCredentials): string {
		let baseUrl = creds.resource_url || "https://dashscope.aliyuncs.com/compatible-mode/v1"
		if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
			baseUrl = `https://${baseUrl}`
		}
		return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`
	}

	private async callApiWithRetry<T>(apiCall: () => Promise<T>): Promise<T> {
		try {
			return await apiCall()
		} catch (error: any) {
			if (error.status === 401) {
				// Token expired, refresh and retry
				this.credentials = await this.refreshAccessToken(this.credentials!)
				const client = this.ensureClient()
				client.apiKey = this.credentials.access_token
				client.baseURL = this.getBaseUrl(this.credentials)
				return await apiCall()
			} else {
				throw error
			}
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[], tools?: OpenAITool[]): ApiStream {
		await this.ensureAuthenticated()
		const client = this.ensureClient()
		const model = this.getModel()

		const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}

		const convertedMessages = [systemMessage, ...convertToOpenAiMessages(messages)]

		const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: model.id,
			temperature: 0,
			messages: convertedMessages,
			stream: true,
			stream_options: { include_usage: true },
			max_completion_tokens: model.info.maxTokens,
			...getOpenAIToolParams(tools),
		}

		const stream = await this.callApiWithRetry(() => client.chat.completions.create(requestOptions))

		const toolCallProcessor = new ToolCallProcessor()
		let fullContent = ""

		for await (const apiChunk of stream) {
			const delta = apiChunk.choices[0]?.delta ?? {}

			if (delta.content) {
				let newText = delta.content
				if (newText.startsWith(fullContent)) {
					newText = newText.substring(fullContent.length)
				}
				fullContent = delta.content

				if (newText) {
					// Check for thinking blocks
					if (newText.includes("<think>") || newText.includes("</think>")) {
						// Simple parsing for thinking blocks
						const parts = newText.split(/<\/?think>/g)
						for (let i = 0; i < parts.length; i++) {
							if (parts[i]) {
								if (i % 2 === 0) {
									// Outside thinking block
									yield {
										type: "text",
										text: parts[i],
									}
								} else {
									// Inside thinking block
									yield {
										type: "reasoning",
										reasoning: parts[i],
									}
								}
							}
						}
					} else {
						yield {
							type: "text",
							text: newText,
						}
					}
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			// Handle reasoning content (o1-style)
			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					reasoning: (delta.reasoning_content as string | undefined) || "",
				}
			}

			if (apiChunk.usage) {
				yield {
					type: "usage",
					inputTokens: apiChunk.usage.prompt_tokens || 0,
					outputTokens: apiChunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: QwenCodeModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in qwenCodeModels) {
			const id = modelId as QwenCodeModelId
			return { id, info: qwenCodeModels[id] }
		}
		return {
			id: qwenCodeDefaultModelId,
			info: qwenCodeModels[qwenCodeDefaultModelId],
		}
	}
}
