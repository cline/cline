import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "../"
import { ApiHandlerOptions, cursorDefaultModelId, cursorModels } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"

export class CursorHandler implements ApiHandler {
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		if (!this.options.cursorAccessToken) {
			throw new Error("Cursor access token is required. Please sign in with your Cursor account.")
		}

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
				conversation: [{ role: "system", content: systemPrompt }, ...messages],
			}),
		})

		if (!response.ok) {
			if (response.status === 401) {
				throw new Error("Authentication failed. Please sign in again.")
			}
			throw new Error(`Cursor API request failed: ${response.statusText}`)
		}

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error("Failed to get response reader")
		}

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				// Parse the envelope format
				const flag = value[0]
				const length = (value[1] << 24) | (value[2] << 16) | (value[3] << 8) | value[4]
				const data = value.slice(5, 5 + length)

				if (flag === 0x02) {
					// End of stream
					break
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
