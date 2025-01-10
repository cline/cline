import { Anthropic } from "@anthropic-ai/sdk"
import { ApiConfiguration, ApiHandlerOptions, ModelInfo, difyModels } from "../../shared/api"
import { getApiMetrics } from "../../shared/getApiMetrics"
import { ApiHandler } from ".."
import { ApiStream, ApiStreamChunk } from "../transform/stream"

export class DifyHandler implements ApiHandler {
	private readonly baseUrl: string
	private readonly apiKey: string
	private readonly modelInfo: ModelInfo

	constructor(options: ApiHandlerOptions) {
		if (!options.difyBaseUrl) {
			throw new Error("Dify base URL is required")
		}
		if (!options.difyApiKey) {
			throw new Error("Dify API key is required")
		}

		this.baseUrl = options.difyBaseUrl.replace(/\/$/, "") // Remove trailing slash if present
		this.apiKey = options.difyApiKey
		this.modelInfo = difyModels["dify-default"]
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		if (!messages || messages.length === 0) {
			throw new Error("No messages provided")
		}

		const lastMessage = messages[messages.length - 1]
		console.log("Last message:", lastMessage)

		// Convert messages to Dify format
		const query =
			`${systemPrompt}\n\n` +
			"# UserTask" +
			messages
				.map((msg) => {
					if (typeof msg === "string") {
						return msg
					}

					if (msg.content) {
						if (Array.isArray(msg.content)) {
							return msg.content
								.map((part) => {
									if (typeof part === "string") {
										return part
									}
									if (typeof part === "object") {
										switch (part.type) {
											case "text":
												return part.text
											case "image":
												console.warn("Image input not supported by Dify")
												return ""
											case "tool_result":
												return typeof part.content === "string"
													? part.content
													: Array.isArray(part.content)
														? part.content
																.filter((p) => p.type === "text")
																.map((p) => p.text)
																.join("\n")
														: ""
										}
									}
									return ""
								})
								.filter(Boolean)
								.join("\n")
						}
						return typeof msg.content === "string" ? msg.content : ""
					}
					return ""
				})
				.join("\n\n")

		if (!query) {
			throw new Error("Query is required")
		}

		console.log("Sending query to Dify:", query)

		const response = await fetch(`${this.baseUrl}/v1/chat-messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				query,
				user: "vscode-user",
				inputs: {},
				response_mode: "streaming",
				conversation_id: "", // Optional, for continuing previous conversations
				files: [], // Optional, for file inputs
				auto_generate_name: true, // Optional, for auto-generating conversation titles
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			console.error("Dify API error response:", error)
			throw new Error(`Dify API error: ${error}`)
		}

		if (!response.body) {
			throw new Error("No response body")
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""

		try {
			while (true) {
				const { value, done } = await reader.read()
				if (done) {
					break
				}

				const chunk = decoder.decode(value)
				buffer += chunk

				// Split buffer into lines and process each complete line
				const lines = buffer.split("\n")
				// Keep the last potentially incomplete line in the buffer
				buffer = lines.pop() || ""

				for (const line of lines) {
					const trimmedLine = line.trim()
					if (!trimmedLine || !trimmedLine.startsWith("data: ")) {
						continue
					}

					try {
						const jsonStr = trimmedLine.slice(6)
						const data = JSON.parse(jsonStr)

						if (data.event === "message") {
							// Handle message event
							yield {
								type: "text",
								text: data.answer || "",
							} as ApiStreamChunk
						} else if (data.event === "error") {
							// Handle error event
							console.error("Dify streaming error:", data.message)
							throw new Error(`Dify streaming error: ${data.message}`)
						} else if (data.event === "message_end") {
							// Handle message end event - could include token usage if available
							console.log("Dify message end:", data)
						}
					} catch (e) {
						if (e instanceof SyntaxError) {
							console.warn("Invalid JSON in stream:", trimmedLine)
						} else {
							throw e
						}
					}
				}
			}

			// Process any remaining data in the buffer
			if (buffer.trim()) {
				if (buffer.startsWith("data: ")) {
					try {
						const data = JSON.parse(buffer.slice(6))
						if (data.event === "message") {
							yield {
								type: "text",
								text: data.answer || "",
							} as ApiStreamChunk
						}
					} catch (e) {
						console.warn("Error parsing remaining buffer:", e)
					}
				} else {
					// do nothing
				}
			}
		} finally {
			reader.releaseLock()
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "dify-default",
			info: this.modelInfo,
		}
	}
}
