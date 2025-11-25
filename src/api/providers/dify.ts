import { ModelInfo } from "@shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler } from "../../core/api/index"
import { ApiStream } from "../../core/api/transform/stream"

interface DifyHandlerOptions {
	difyApiKey?: string
	difyBaseUrl?: string
}

export class DifyHandler implements ApiHandler {
	private options: DifyHandlerOptions
	private baseUrl: string
	private apiKey: string
	private conversationId: string | null = null

	constructor(options: DifyHandlerOptions) {
		this.options = options
		this.apiKey = options.difyApiKey || ""
		this.baseUrl = options.difyBaseUrl || ""

		console.log("[DIFY DEBUG] Constructor called with:", {
			hasApiKey: !!this.apiKey,
			baseUrl: this.baseUrl,
		})

		if (!this.apiKey) {
			throw new Error("Dify API key is required")
		}
		if (!this.baseUrl) {
			throw new Error("Dify base URL is required")
		}
	}

	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		console.log("[DIFY DEBUG] createMessage called with:", {
			systemPromptLength: systemPrompt?.length || 0,
			messagesCount: messages?.length || 0,
		})

		// Convert messages to Dify format
		const query = this.convertMessagesToQuery(systemPrompt, messages)
		const requestBody = {
			inputs: {},
			query: query,
			response_mode: "streaming",
			conversation_id: this.conversationId || "",
			user: "cline-user", // A unique user identifier
			files: [],
		}

		const fullUrl = `${this.baseUrl}/chat-messages`
		console.log("[DIFY DEBUG] Making request to:", fullUrl)
		console.log("[DIFY DEBUG] Request body:", JSON.stringify(requestBody, null, 2))
		console.log("[DIFY DEBUG] Current process environment variables (for proxy debugging):", process.env)

		let response: Response
		try {
			response = await fetch(fullUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
			})
		} catch (error: any) {
			console.error("[DIFY DEBUG] Network error during fetch:", error)
			// Log more detailed error information if available (e.g., from undici)
			const cause = error.cause ? ` | Cause: ${error.cause}` : ""
			throw new Error(`Dify API network error: ${error.message}${cause}`)
		}

		console.log("[DIFY DEBUG] Response status:", response.status)
		const headersObj: Record<string, string> = {}
		response.headers.forEach((value, key) => {
			headersObj[key] = value
		})
		console.log("[DIFY DEBUG] Response headers:", headersObj)

		if (!response.ok) {
			const errorText = await response.text()
			console.error("[DIFY DEBUG] Error response:", errorText)
			throw new Error(`Dify API error: ${response.status} ${response.statusText} - ${errorText}`)
		}

		if (!response.body) {
			throw new Error("No response body from Dify API")
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""
		let fullText = ""

		console.log("[DIFY DEBUG] Starting to read streaming response...")

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) {
					console.log("[DIFY DEBUG] Stream ended naturally")
					break
				}

				const chunk = decoder.decode(value, { stream: true })
				console.log("[DIFY DEBUG] Raw chunk received:", JSON.stringify(chunk))

				buffer += chunk
				const lines = buffer.split("\n")

				// Keep the last incomplete line in the buffer
				buffer = lines.pop() || ""

				for (const line of lines) {
					console.log("[DIFY DEBUG] Processing line:", JSON.stringify(line))

					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						console.log("[DIFY DEBUG] Extracted data:", JSON.stringify(data))

						if (data === "[DONE]") {
							console.log("[DIFY DEBUG] Received [DONE] signal")
							return // Explicitly return on [DONE]
						}

						if (data === "") {
							console.log("[DIFY DEBUG] Empty data line, skipping")
							continue
						}

						try {
							const parsed = JSON.parse(data)
							console.log("[DIFY DEBUG] Parsed JSON:", parsed)

							// Capture conversation_id as soon as it's available
							if (parsed.conversation_id && !this.conversationId) {
								this.conversationId = parsed.conversation_id
								console.log("[DIFY DEBUG] Captured conversation_id:", this.conversationId)
							}

							// Handle different Dify event types based on actual Dify API
							if (parsed.event === "message") {
								console.log("[DIFY DEBUG] Message event, answer:", parsed.answer)
								// Dify sends the full text in each "answer" chunk, so we replace.
								if (typeof parsed.answer === "string") {
									fullText = parsed.answer
									console.log("[DIFY DEBUG] Updated fullText length:", fullText.length)
									yield {
										type: "text",
										text: fullText,
									}
								}
							} else if (parsed.event === "message_replace") {
								console.log("[DIFY DEBUG] Replace message event:", parsed)
								if (parsed.answer) {
									fullText = parsed.answer // Replace instead of append
									console.log("[DIFY DEBUG] Replaced fullText length:", fullText.length)
									yield {
										type: "text",
										text: fullText,
									}
								}
							} else if (parsed.event === "message_end") {
								console.log("[DIFY DEBUG] Message end event", parsed)
								// Message completed. Yield final text if we have any.
								if (fullText) {
									yield {
										type: "text",
										text: fullText,
									}
								}
								// Yield usage data if available
								if (parsed.usage) {
									yield {
										type: "usage",
										inputTokens: parsed.usage.prompt_tokens || 0,
										outputTokens: parsed.usage.completion_tokens || parsed.usage.total_tokens || 0,
										totalCost: parsed.usage.total_price || 0,
									}
								}
								return // End of stream
							} else if (parsed.event === "error") {
								console.error("[DIFY DEBUG] Error event:", parsed)
								throw new Error(`Dify API error: ${parsed.message || "Unknown error"}`)
							} else if (parsed.event === "workflow_started" || parsed.event === "workflow_finished") {
								console.log("[DIFY DEBUG] Workflow event:", parsed.event)
								// These are informational events, continue processing
							} else if (parsed.event === "node_started" || parsed.event === "node_finished") {
								console.log("[DIFY DEBUG] Node event:", parsed.event, parsed.data)
								// These are informational events, continue processing
							} else if (parsed.event === "ping") {
								console.log("[DIFY DEBUG] Ping event received, keeping connection alive.")
								// Ping event, do nothing
							} else {
								console.log("[DIFY DEBUG] Unknown event type:", parsed.event, "Full object:", parsed)
								// Try to extract text from other possible fields
								if (parsed.text) {
									fullText += parsed.text
									yield {
										type: "text",
										text: fullText,
									}
								} else if (parsed.content) {
									fullText += parsed.content
									yield {
										type: "text",
										text: fullText,
									}
								}
							}
						} catch (e) {
							console.warn("[DIFY DEBUG] Failed to parse JSON:", data, "Error:", e)
						}
					} else if (line.trim() !== "") {
						console.log(
							"[DIFY DEBUG] Non-data line (not starting with 'data:'), trying to parse as direct JSON:",
							JSON.stringify(line),
						)
						// Try to parse as direct JSON (fallback for non-SSE responses, though Dify uses SSE)
						try {
							const parsed = JSON.parse(line.trim())
							console.log("[DIFY DEBUG] Parsed direct JSON:", parsed)

							// Handle the same event types as above
							if (parsed.event === "message" && parsed.answer) {
								fullText += parsed.answer
								yield {
									type: "text",
									text: fullText,
								}
							} else if (parsed.event === "message_end") {
								if (fullText) {
									yield {
										type: "text",
										text: fullText,
									}
								}
								return
							} else if (parsed.event === "error") {
								console.error("[DIFY DEBUG] Direct JSON Error event:", parsed)
								throw new Error(`Dify API error: ${parsed.message || "Unknown error"}`)
							}
						} catch (e) {
							// Not JSON, continue
							console.log("[DIFY DEBUG] Line is not direct JSON, continuing")
						}
					}
				}
			}
		} finally {
			reader.releaseLock()
			console.log("[DIFY DEBUG] Stream reader released")
		}
	}

	private convertMessagesToQuery(systemPrompt: string, messages: ClineStorageMessage[]): string {
		// Dify's context is managed by `conversation_id`. The `query` should be the last user message.
		// The system prompt is typically configured in the Dify App itself.
		const lastUserMessage = messages.filter((m) => m.role === "user").pop()

		if (!lastUserMessage) {
			return "" // Should not happen in normal flow
		}

		const userQuery = Array.isArray(lastUserMessage.content)
			? lastUserMessage.content.map((c) => ("text" in c ? c.text : "")).join("\n")
			: (lastUserMessage.content as string)

		// Only prepend the system prompt if it's the very first message of a new conversation.
		if (!this.conversationId && systemPrompt) {
			console.log("[DIFY DEBUG] Prepending system prompt for new conversation.")
			return `${systemPrompt}\n\n---\n\n${userQuery}`
		}

		return userQuery
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "dify-workflow",
			info: {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "Dify workflow - model selection is configured in your Dify application",
			},
		}
	}
}
