import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, cursorDefaultModelId, cursorModels, CursorModelId } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"
import { convertToCursorMessages, CursorMessage } from "../transform/cursor-format"
import { CursorTokenManager, CursorTokenError } from "./cursor/CursorTokenManager"
import { CursorEnvelopeHandler, EnvelopeFlag, CursorEnvelopeError } from "./cursor/CursorEnvelopeHandler"
import { ExtensionContext } from "vscode"
import { CursorConfig } from "../../shared/config/cursor"

interface MessageContent {
	text: string
}

interface RequestBody {
	query: string
	currentFile: {
		contents: string
		languageId: string
		relativeWorkspacePath: string
		selection: {
			startPosition: { line: number; character: number }
			endPosition: { line: number; character: number }
		}
		cursorPosition: { line: number; character: number }
	}
	modelDetails: {
		modelName: string
		enableGhostMode: boolean
		apiKey: undefined
	}
	workspaceRootPath: string
	explicitContext: Record<string, unknown>
	requestId: string
	conversation: CursorMessage[]
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

		if (options.cursorAccessToken && options.cursorRefreshToken) {
			this.tokenManager.setTokens(options.cursorAccessToken, options.cursorRefreshToken).catch(() => {})
		}
	}

	private async getValidAccessToken(): Promise<string> {
		if (!this.tokenManager.isAuthenticated()) {
			throw new Error("Cursor access token is required. Please sign in with your Cursor account.")
		}

		try {
			return await this.tokenManager.getAccessToken()
		} catch (error) {
			if (error instanceof CursorTokenError && error.shouldLogout) {
				this.options.cursorAccessToken = undefined
				this.options.cursorRefreshToken = undefined
			}
			throw error
		}
	}

	private createRequestBody(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): RequestBody {
		const cursorMessages = convertToCursorMessages(systemPrompt, messages)
		return {
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
	}

	private createRequestEnvelope(requestBody: RequestBody): Uint8Array {
		const requestEnvelope = this.envelopeHandler.encodeEnvelope(requestBody)
		const endMarker = this.envelopeHandler.encodeEnvelope(new Uint8Array(0), EnvelopeFlag.END_STREAM)

		const fullRequestBody = new Uint8Array(requestEnvelope.length + endMarker.length)
		fullRequestBody.set(requestEnvelope)
		fullRequestBody.set(endMarker, requestEnvelope.length)
		return fullRequestBody
	}

	private async makeRequest(accessToken: string, requestBody: Uint8Array): Promise<Response> {
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
			body: requestBody,
		})

		if (!response.ok) {
			throw await this.handleRequestError(response)
		}

		return response
	}

	private async handleRequestError(response: Response): Promise<Error> {
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
			// Use default error message if JSON parsing fails
		}

		return new Error(errorMessage)
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

	private async *processResponseStream(reader: ReadableStreamDefaultReader<Uint8Array>): ApiStream {
		let buffer = new Uint8Array(0)

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer = await this.appendToBuffer(buffer, value)
			yield* this.processBuffer(buffer)
		}
	}

	private async appendToBuffer(buffer: Uint8Array, chunk: Uint8Array): Promise<Uint8Array> {
		const newBuffer = new Uint8Array(buffer.length + chunk.length)
		newBuffer.set(buffer)
		newBuffer.set(chunk, buffer.length)
		return newBuffer
	}

	private async *processBuffer(buffer: Uint8Array): ApiStream {
		while (buffer.length >= 5) {
			const { isComplete, totalLength } = this.envelopeHandler.validateEnvelope(buffer)
			if (!isComplete) break

			const completeMessage = buffer.slice(0, totalLength)
			buffer = buffer.slice(totalLength)

			try {
				yield* this.processMessage(completeMessage)
			} catch (error) {
				throw error
			}
		}
	}

	private async *processMessage(message: Uint8Array): ApiStream {
		const { flag, data } = this.envelopeHandler.decodeEnvelope(message)

		if (flag === EnvelopeFlag.END_STREAM) {
			if (data.length > 0) {
				const errorMessage = this.envelopeHandler.parseErrorMessage(data)
				if (errorMessage !== "{}") {
					throw new Error(errorMessage)
				}
			}
			return
		}

		if (flag === EnvelopeFlag.ERROR) {
			throw new Error(this.envelopeHandler.parseErrorMessage(data))
		}

		if (flag === EnvelopeFlag.NORMAL) {
			const messageText = new TextDecoder().decode(data)
			if (messageText.length === 0) return

			try {
				const content = this.parseMessageContent(messageText)
				if (content) {
					yield {
						type: "text",
						text: content.text,
					}
				}
			} catch (error) {
				throw new Error(`Failed to parse message: ${error}`)
			}
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const accessToken = await this.getValidAccessToken()
		const requestBody = this.createRequestBody(systemPrompt, messages)
		const envelope = this.createRequestEnvelope(requestBody)
		const response = await this.makeRequest(accessToken, envelope)

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error("Failed to get response reader")
		}

		try {
			yield* this.processResponseStream(reader)
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
