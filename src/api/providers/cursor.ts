import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, cursorDefaultModelId, cursorModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import * as vscode from "vscode"

interface CursorMessage {
	messageType: "user" | "bot"
	text: string
	attachedCodeChunks?: Array<{
		relativeWorkspacePath: string
		startLine: number
		lines: string[]
	}>
}

export class CursorHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private refreshPromise: Promise<void> | null = null
	private lastTokenRefresh: number = 0
	private readonly TOKEN_REFRESH_INTERVAL = 3300000 // 55 minutes in milliseconds
	private readonly TOKEN_EXPIRY = 3600000 // 1 hour in milliseconds
	private onTokensRefreshed?: (accessToken: string, refreshToken: string) => Promise<void>

	constructor(options: ApiHandlerOptions, onTokensRefreshed?: (accessToken: string, refreshToken: string) => Promise<void>) {
		this.options = options
		this.lastTokenRefresh = Date.now()
		this.onTokensRefreshed = onTokensRefreshed
	}

	private async refreshToken(): Promise<void> {
		if (!this.options.cursorRefreshToken) {
			throw new Error("No refresh token available")
		}

		if (this.refreshPromise) {
			return this.refreshPromise
		}

		this.refreshPromise = (async () => {
			try {
				const response = await fetch("https://api2.cursor.sh/auth/refresh", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						refresh_token: this.options.cursorRefreshToken,
					}),
				})

				if (!response.ok) {
					throw new Error(`Token refresh failed: ${response.statusText}`)
				}

				const data = await response.json()
				if (!data.accessToken || !data.refreshToken) {
					throw new Error("Invalid response from refresh endpoint")
				}

				// Update tokens in options
				this.options.cursorAccessToken = data.accessToken
				this.options.cursorRefreshToken = data.refreshToken
				this.lastTokenRefresh = Date.now()

				// Store new tokens securely using the callback
				if (this.onTokensRefreshed) {
					await this.onTokensRefreshed(data.accessToken, data.refreshToken)
				}
			} finally {
				this.refreshPromise = null
			}
		})()

		return this.refreshPromise
	}

	private async validateAndRefreshToken(): Promise<void> {
		const now = Date.now()
		const timeSinceLastRefresh = now - this.lastTokenRefresh

		// Check if token has expired
		if (timeSinceLastRefresh >= this.TOKEN_EXPIRY) {
			throw new Error("Access token has expired. Please sign in again.")
		}

		// Proactively refresh token before it expires
		if (timeSinceLastRefresh >= this.TOKEN_REFRESH_INTERVAL) {
			await this.refreshToken()
		}
	}

	private convertAnthropicToCursorMessages(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): CursorMessage[] {
		const cursorMessages: CursorMessage[] = [
			{
				messageType: "user",
				text: systemPrompt,
			},
		]

		for (const message of messages) {
			const cursorMessage: CursorMessage = {
				messageType: message.role === "assistant" ? "bot" : "user",
				text:
					typeof message.content === "string"
						? message.content
						: message.content
								.map((block) => {
									if (block.type === "text") return block.text
									// Handle other block types if needed
									return ""
								})
								.join("\n"),
			}
			cursorMessages.push(cursorMessage)
		}

		return cursorMessages
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		if (!this.options.cursorAccessToken) {
			throw new Error("Cursor access token is required. Please sign in with your Cursor account.")
		}

		// Validate and refresh token if needed before making the API call
		await this.validateAndRefreshToken()

		const cursorMessages = this.convertAnthropicToCursorMessages(systemPrompt, messages)

		const response = await fetch("https://api2.cursor.sh/aiserver.v1.AiService/StreamChat", {
			method: "POST",
			headers: {
				Accept: "*/*",
				"Content-Type": "application/connect+json",
				Authorization: `Bearer ${this.options.cursorAccessToken}`,
				"User-Agent": "Cline/1.0.0",
			},
			body: JSON.stringify({
				currentFile: {
					content: "",
					languageId: "typescript",
					relativeWorkspacePath: "",
					selection: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 0 },
					},
					cursor: { line: 0, character: 0 },
				},
				modelDetails: {
					modelName: this.getModel().id,
					enableGhostMode: false,
				},
				workspaceRootPath: "",
				explicitContext: {},
				requestId: crypto.randomUUID(),
				conversation: cursorMessages,
			}),
		})

		if (!response.ok) {
			if (response.status === 401) {
				// Try to refresh token on unauthorized error
				try {
					await this.refreshToken()
					// Retry the request with new token
					return this.createMessage(systemPrompt, messages)
				} catch (error) {
					throw new Error("Authentication failed. Please sign in again.")
				}
			}
			throw new Error(`Cursor API request failed: ${response.statusText}`)
		}

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error("Failed to get response reader")
		}

		try {
			let buffer = new Uint8Array(0)

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				// Combine with any leftover buffer
				const newBuffer = new Uint8Array(buffer.length + value.length)
				newBuffer.set(buffer)
				newBuffer.set(value, buffer.length)
				buffer = newBuffer

				// Process complete messages
				while (buffer.length >= 5) {
					// Minimum message size (1 byte flag + 4 bytes length)
					const flag = buffer[0]
					const length = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4]
					const totalLength = length + 5

					if (buffer.length < totalLength) {
						// Wait for more data
						break
					}

					const data = buffer.slice(5, totalLength)
					buffer = buffer.slice(totalLength)

					if (flag === 0x02) {
						// End of stream
						return
					}

					if (flag === 0x04) {
						// Error message
						const errorText = new TextDecoder().decode(data)
						throw new Error(`Cursor API error: ${errorText}`)
					}

					// Normal message
					const message = JSON.parse(new TextDecoder().decode(data))
					if (message.text) {
						yield {
							type: "text",
							text: message.text,
						}
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}

	getModel() {
		return {
			id: this.options.apiModelId || cursorDefaultModelId,
			info: cursorModels[cursorDefaultModelId],
		}
	}
}
