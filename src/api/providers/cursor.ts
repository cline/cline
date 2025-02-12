import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, cursorDefaultModelId, cursorModels, CursorModelId } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import { Logger } from "../../services/logging/Logger"
import { convertToCursorMessages } from "../transform/cursor-format"
import { CursorTokenManager, CursorTokenError } from "./cursor/CursorTokenManager"
import { CursorEnvelopeHandler, EnvelopeFlag, CursorEnvelopeError } from "./cursor/CursorEnvelopeHandler"
import { ExtensionContext } from "vscode"

interface MessageContent {
	text: string
}

export class CursorHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private readonly MAX_MESSAGE_SIZE = 4294967296 // 4GB (2^32 bytes) per spec
	private readonly CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB"
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
			this.tokenManager.setTokens(options.cursorAccessToken, options.cursorRefreshToken).catch((error) => {
				this.log(`Failed to initialize token manager: ${error}`)
			})
		}
	}

	private log(message: string) {
		const timestamp = new Date().toISOString()
		Logger.log(`[CURSOR ${timestamp}] ${message}`)
	}

	private async processMessageChunk(chunk: Uint8Array): Promise<Uint8Array> {
		// Log raw chunk for debugging
		this.log(`🔍 Raw chunk:`)
		this.log(`   Size: ${chunk.length} bytes`)
		this.log(
			`   Raw data: ${Array.from(chunk)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join(" ")}`,
		)

		try {
			const text = new TextDecoder().decode(chunk)
			this.log(`   As text: ${text}`)
		} catch (error) {
			this.log(`   Failed to decode as text: ${error}`)
		}

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

		this.log("📤 Sending request with messages:")
		this.log(JSON.stringify(cursorMessages, null, 2))

		const requestBody = {
			query: cursorMessages[cursorMessages.length - 1].text,
			currentFile: {
				contents: "",
				languageId: "typescript",
				relativeWorkspacePath: "",
				selection: {
					startPosition: { line: 0, character: 0 },
					endPosition: { line: 0, character: 0 },
				},
				cursorPosition: { line: 0, character: 0 },
			},
			modelDetails: {
				modelName: this.getModel().id,
				enableGhostMode: false,
				apiKey: undefined,
			},
			workspaceRootPath: "",
			explicitContext: {},
			requestId: crypto.randomUUID(),
			conversation: cursorMessages,
		}

		this.log("📝 Full request body:")
		this.log(JSON.stringify(requestBody, null, 2))

		// Create request envelope like Rust implementation
		const requestEnvelope = this.envelopeHandler.encodeEnvelope(requestBody) // Pass object directly to match Rust's serialization
		const endMarker = this.envelopeHandler.encodeEnvelope(new Uint8Array(0), EnvelopeFlag.END_STREAM) // Empty array for end marker

		// Combine envelopes exactly like Rust
		const fullRequestBody = new Uint8Array(requestEnvelope.length + endMarker.length)
		fullRequestBody.set(requestEnvelope)
		fullRequestBody.set(endMarker, requestEnvelope.length)

		this.log("📦 Encoded request body:")
		this.log(`   Size: ${fullRequestBody.length} bytes`)
		this.log(
			`   Raw data: ${Array.from(fullRequestBody)
				.map((b) => b.toString(16).padStart(2, "0"))
				.join(" ")}`,
		)

		const response = await fetch("https://api2.cursor.sh/aiserver.v1.AiService/StreamChat", {
			method: "POST",
			headers: {
				Accept: "*/*",
				"Content-Type": "application/connect+json",
				Authorization: `Bearer ${accessToken}`,
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/0.45.11 Chrome/128.0.6613.186 Electron/32.2.6 Safari/537.36",
				"x-cursor-client-key": "2a02d8cd9b5af7a8db6e143e201164e47faa7cba6574524e4e4aafe6655f18cf",
				"x-cursor-checksum":
					"LwoMGZe259957470509b69c0a477232e090cae43695725138dedbcc7625a2b36573caa58/deb3cac1988ff56ea6fabce72eefd291235ab451eef8173567d7521126673b73",
				"x-cursor-client-version": "0.45.11",
				"x-cursor-timezone": "Europe/Amsterdam",
				"x-ghost-mode": "false",
				"x-session-id": this.sessionId,
			},
			body: fullRequestBody,
		})

		this.log(`📥 Response status: ${response.status} ${response.statusText}`)
		this.log("📥 Response headers:")
		response.headers.forEach((value, key) => {
			this.log(`   ${key}: ${value}`)
		})

		if (!response.ok) {
			const errorText = await response.text()
			let errorMessage = `Server returned status code ${response.status}`

			try {
				const errorJson = JSON.parse(errorText)
				// Match Rust's error handling order exactly
				if (errorJson.error?.message) {
					errorMessage = errorJson.error.message
				} else if (errorJson.error?.code && errorJson.error?.message) {
					errorMessage = `${errorJson.error.code}: ${errorJson.error.message}`
				}
			} catch {
				// Use the default error message if JSON parsing fails
			}

			throw new Error(errorMessage)
		}

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error("Failed to get response reader")
		}

		try {
			let buffer = new Uint8Array(0)
			let sawEndMarker = false
			this.log("🔄 Starting message processing stream")

			while (true) {
				const { done, value } = await reader.read()
				if (done) {
					this.log("📥 Stream done")
					break
				}

				const processedChunk = await this.processMessageChunk(value)
				this.log(`📦 Received chunk of size: ${processedChunk.length}`)

				// Append new data to buffer
				const newBuffer = new Uint8Array(buffer.length + processedChunk.length)
				newBuffer.set(buffer)
				newBuffer.set(processedChunk, buffer.length)
				buffer = newBuffer
				this.log(`📎 Buffer size after combining: ${buffer.length}`)

				// Process complete messages
				while (buffer.length >= 5) {
					const { isComplete, totalLength } = this.envelopeHandler.validateEnvelope(buffer)
					if (!isComplete) {
						this.log(`⏳ Waiting for more data. Have ${buffer.length}, need ${totalLength}`)
						break
					}

					// Extract and decode the complete message
					const completeMessage = buffer.slice(0, totalLength)
					buffer = buffer.slice(totalLength)

					try {
						const { flag, data } = this.envelopeHandler.decodeEnvelope(completeMessage)
						this.log(`🏷️ Message envelope - Flag: 0x${flag.toString(16)}, Length: ${data.length}`)

						if (flag === EnvelopeFlag.END_STREAM) {
							this.log("🏁 End of stream marker received")
							if (data.length > 0) {
								const errorMessage = this.envelopeHandler.parseErrorMessage(data)
								if (errorMessage !== "{}") {
									// Don't treat empty object as error
									this.log(`❌ Error in end-of-stream marker: ${errorMessage}`)
									throw new Error(errorMessage)
								}
							}
							sawEndMarker = true
							return
						}

						if (flag === EnvelopeFlag.ERROR) {
							const errorMessage = this.envelopeHandler.parseErrorMessage(data)
							this.log(`❌ Error message received: ${errorMessage}`)
							throw new Error(errorMessage)
						}

						if (flag === EnvelopeFlag.NORMAL) {
							const messageText = new TextDecoder().decode(data)
							this.log(`📨 Message text: ${messageText}`)

							// Skip empty messages like Rust
							if (messageText.length === 0) {
								this.log(`📝 Skipping empty message`)
								continue
							}

							try {
								const content = this.parseMessageContent(messageText)
								if (content) {
									this.log(`✏️ Yielding text: ${content.text}`)
									// Convert to Anthropic format for our history
									yield {
										type: "text",
										text: content.text,
									}
								} else {
									this.log(`⚠️ Message had no text property: ${messageText}`)
								}
							} catch (error) {
								this.log(`❌ Failed to parse message: ${error}`)
								throw new Error(`Failed to parse message: ${error}`)
							}
						}
					} catch (error) {
						if (error instanceof CursorEnvelopeError) {
							this.log(`❌ Envelope error: ${error.message} (${error.type})`)
							if (error.details) {
								this.log(`   Details: ${JSON.stringify(error.details)}`)
							}
						}
						this.log(`❌ Error processing message: ${error}`)
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
		} catch (error) {
			this.log(`Error during disposal: ${error}`)
		}
	}
}
