import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, cursorDefaultModelId, cursorModels, CursorModelId } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import { convertToCursorMessages } from "../transform/cursor-format"
import { CursorTokenManager, CursorTokenError } from "./cursor/CursorTokenManager"
import { CursorEnvelopeHandler, EnvelopeFlag, CursorEnvelopeError } from "./cursor/CursorEnvelopeHandler"
import { ExtensionContext } from "vscode"
import { CursorConfig } from "../../shared/config/cursor"
import * as vscode from "vscode"
import * as path from "path"

interface MessageContent {
	text: string
}

export class CursorHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private sessionId: string
	private tokenManager: CursorTokenManager
	private envelopeHandler: CursorEnvelopeHandler

	constructor(options: ApiHandlerOptions, context: ExtensionContext) {
		this.options = options
		this.sessionId = crypto.randomUUID()
		this.tokenManager = new CursorTokenManager(context)
		this.envelopeHandler = new CursorEnvelopeHandler()

		// Initialize token manager if we have tokens
		if (options.cursorAccessToken && options.cursorRefreshToken) {
			this.tokenManager.setTokens(options.cursorAccessToken, options.cursorRefreshToken).catch(() => {})
		}
	}

	private async processMessageChunk(chunk: Uint8Array): Promise<Uint8Array> {
		return chunk
	}

	private parseMessageContent(data: string): MessageContent | null {
		try {
			const content = JSON.parse(data)
			if (content && typeof content.text === "string") {
				return content as MessageContent
			}
			return null
		} catch {
			return null
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		if (!this.tokenManager.isAuthenticated()) {
			throw new Error("Cursor access token is required. Please sign in with your Cursor account.")
		}

		let accessToken: string
		try {
			accessToken = await this.tokenManager.getAccessToken()
		} catch (error) {
			if (error instanceof CursorTokenError && error.shouldLogout) {
				// Clear tokens from options to trigger re-auth
				this.options.cursorAccessToken = undefined
				this.options.cursorRefreshToken = undefined
			}
			throw error
		}

		const cursorMessages = convertToCursorMessages(systemPrompt, messages)

		const editor = vscode.window.activeTextEditor
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""

		const requestBody = {
			currentFile: {
				contents: editor?.document.getText() || "",
				languageId: editor?.document.languageId || "",
				relativeWorkspacePath: editor ? path.relative(workspaceRoot, editor.document.uri.fsPath) : "",
				selection: {
					startPosition: {
						line: editor?.selection.start.line || 0,
						column: editor?.selection.start.character || 0,
					},
					endPosition: {
						line: editor?.selection.end.line || 0,
						column: editor?.selection.end.character || 0,
					},
				},
				cursorPosition: {
					line: editor?.selection.active.line || 0,
					column: editor?.selection.active.character || 0,
				},
			},
			modelDetails: {
				modelName: this.getModel().id,
				enableGhostMode: true,
				apiKey: undefined,
			},
			rootPath: workspaceRoot,
			context: {},
			requestId: crypto.randomUUID(),
			conversation: cursorMessages,
		}

		const requestEnvelope = this.envelopeHandler.encodeEnvelope(requestBody)
		const endMarker = this.envelopeHandler.encodeEnvelope(new Uint8Array(0), EnvelopeFlag.END_STREAM)

		// Combine envelopes exactly like Rust
		const fullRequestBody = new Uint8Array(requestEnvelope.length + endMarker.length)
		fullRequestBody.set(requestEnvelope)
		fullRequestBody.set(endMarker, requestEnvelope.length)

		const response = await fetch(CursorConfig.API_ENDPOINT, {
			method: "POST",
			headers: {
				Accept: "*/*",
				"Content-Type": "application/connect+json",
				Authorization: `Bearer ${accessToken}`,
				"User-Agent": CursorConfig.USER_AGENT,
				"x-cursor-client-key": CursorConfig.CLIENT_KEY,
				"x-cursor-checksum": CursorConfig.CLIENT_CHECKSUM,
				"x-cursor-client-version": CursorConfig.CLIENT_VERSION,
				"x-cursor-timezone": "Europe/Amsterdam",
				"x-ghost-mode": "false",
				"x-session-id": this.sessionId,
			},
			body: fullRequestBody,
		})

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = `Server returned status code ${response.status}`

			try {
				const errorJson = JSON.parse(errorText)
				if (errorJson.error?.message) {
					errorMessage = errorJson.error.message
				} else if (errorJson.error?.code && errorJson.error?.message) {
					errorMessage = `${errorJson.error.code}: ${errorJson.error.message}`
				}
			} catch {
				// Use the default error message if JSON parsing fails
			}

			throw new CursorEnvelopeError(errorMessage, "request_error", { status: response.status, body: errorText })
		}

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error("Failed to get response reader")
		}

		try {
			let buffer = new Uint8Array(0)
			let sawEndMarker = false

			while (true) {
				const { done, value } = await reader.read()
				if (done) {
					break
				}

				const processedChunk = await this.processMessageChunk(value)

				// Append new data to buffer
				const newBuffer = new Uint8Array(buffer.length + processedChunk.length)
				newBuffer.set(buffer)
				newBuffer.set(processedChunk, buffer.length)
				buffer = newBuffer

				// Process complete messages
				while (buffer.length >= 5) {
					const { isComplete, totalLength } = this.envelopeHandler.validateEnvelope(buffer)
					if (!isComplete) {
						break
					}

					// Extract and decode the complete message
					const completeMessage = buffer.slice(0, totalLength)
					buffer = buffer.slice(totalLength)

					try {
						const { flag, data } = this.envelopeHandler.decodeEnvelope(completeMessage)

						if (flag === EnvelopeFlag.END_STREAM) {
							if (data.length > 0) {
								const errorMessage = this.envelopeHandler.parseErrorMessage(data)
								if (errorMessage !== "{}") {
									throw new CursorEnvelopeError(errorMessage, "end_stream_error", { data })
								}
							}
							sawEndMarker = true
							return
						}

						if (flag === EnvelopeFlag.ERROR) {
							const errorMessage = this.envelopeHandler.parseErrorMessage(data)
							throw new CursorEnvelopeError(errorMessage, "envelope_error", { data })
						}

						if (flag === EnvelopeFlag.NORMAL) {
							const messageText = new TextDecoder().decode(data)

							// Skip empty messages like Rust
							if (messageText.length === 0) {
								continue
							}

							try {
								const content = this.parseMessageContent(messageText)
								if (content) {
									// Convert to Anthropic format for our history
									yield {
										type: "text",
										text: content.text,
									}
								}
							} catch (error) {
								throw new CursorEnvelopeError(
									`Failed to parse message: ${error instanceof Error ? error.message : String(error)}`,
									"parse_error",
									{ messageText },
								)
							}
						}
					} catch (error) {
						throw error
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}

	getModel() {
		const modelId = this.options.apiModelId
		if (modelId && modelId in cursorModels) {
			const id = modelId as CursorModelId
			return { id, info: cursorModels[id] }
		}
		return {
			id: cursorDefaultModelId,
			info: cursorModels[cursorDefaultModelId],
		}
	}

	public async dispose() {
		try {
			await this.tokenManager.clearTokens()
		} catch {
			// Ignore disposal errors
		}
	}
}
