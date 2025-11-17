import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ModelInfo } from "../../../shared/api"
import { ApiHandler } from "../index"
import { ApiStream } from "../transform/stream"

interface DifyHandlerOptions {
	difyApiKey?: string
	difyBaseUrl?: string
}

// Dify API Response Types
export interface DifyFileResponse {
	id: string
	name: string
	size: number
	extension: string
	mime_type: string
	created_by: string
	created_at: number
}

export interface DifyMessage {
	id: string
	conversation_id: string
	inputs: Record<string, any>
	query: string
	message_files: Array<{
		id: string
		type: string
		url: string
		belongs_to: string
	}>
	answer: string
	created_at: number
	feedback?: {
		rating: string
	}
	retriever_resources?: any[]
}

interface DifyHistoryResponse {
	data: DifyMessage[]
	has_more: boolean
	limit: number
}

interface DifyConversation {
	id: string
	name: string
	inputs: Record<string, any>
	status: string
	introduction: string
	created_at: number
	updated_at: number
}

interface DifyConversationsResponse {
	data: DifyConversation[]
	has_more: boolean
	limit: number
}

interface DifyConversationResponse {
	id: string
	name: string
	inputs: Record<string, any>
	status: string
	introduction: string
	created_at: number
	updated_at: number
}

export class DifyHandler implements ApiHandler {
	private options: DifyHandlerOptions
	private baseUrl: string
	private apiKey: string
	private conversationId: string | null = null
	private currentTaskId: string | null = null
	private abortController: AbortController | null = null

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
		let hasYieldedContent = false
		const processedEvents: string[] = []
		let lastEventTime = Date.now()

		console.log("[DIFY DEBUG] Starting to read streaming response...")

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) {
					console.log("[DIFY DEBUG] Stream ended naturally")
					console.log(
						"[DIFY DEBUG] Final state - hasYieldedContent:",
						hasYieldedContent,
						"fullText length:",
						fullText.length,
						"processedEvents:",
						processedEvents,
					)
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
							break
						}

						if (data === "") {
							console.log("[DIFY DEBUG] Empty data line, skipping")
							continue
						}

						try {
							const parsed = JSON.parse(data)
							console.log("[DIFY DEBUG] Parsed JSON:", parsed)
							processedEvents.push(parsed.event || "unknown")
							lastEventTime = Date.now()

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
									hasYieldedContent = true
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
									hasYieldedContent = true
								}
							} else if (parsed.event === "message_end") {
								console.log("[DIFY DEBUG] Message end event", parsed)
								// Message completed. Yield final text if we have any.
								if (fullText) {
									yield {
										type: "text",
										text: fullText,
									}
									hasYieldedContent = true
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
									hasYieldedContent = true
								} else if (parsed.content) {
									fullText += parsed.content
									yield {
										type: "text",
										text: fullText,
									}
									hasYieldedContent = true
								} else if (parsed.answer) {
									// Fallback: some events might have answer field even if not "message" type
									fullText += parsed.answer
									yield {
										type: "text",
										text: fullText,
									}
									hasYieldedContent = true
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
							processedEvents.push(parsed.event || "direct-json")

							// Handle the same event types as above
							if (parsed.event === "message" && parsed.answer) {
								fullText += parsed.answer
								yield {
									type: "text",
									text: fullText,
								}
								hasYieldedContent = true
							} else if (parsed.event === "message_end") {
								if (fullText) {
									yield {
										type: "text",
										text: fullText,
									}
									hasYieldedContent = true
								}
								return
							} else if (parsed.event === "error") {
								console.error("[DIFY DEBUG] Direct JSON Error event:", parsed)
								throw new Error(`Dify API error: ${parsed.message || "Unknown error"}`)
							} else if (parsed.answer || parsed.text || parsed.content) {
								// Fallback for any content in direct JSON
								const content = parsed.answer || parsed.text || parsed.content
								fullText += content
								yield {
									type: "text",
									text: fullText,
								}
								hasYieldedContent = true
							}
						} catch (e) {
							// Not JSON, continue
							console.log("[DIFY DEBUG] Line is not direct JSON, continuing")
						}
					}
				}
			}

			// Final check - if we haven't yielded any content, provide diagnostic information
			if (!hasYieldedContent) {
				const diagnosticInfo = {
					processedEvents,
					finalFullTextLength: fullText.length,
					finalFullText: fullText,
					streamDuration: Date.now() - lastEventTime,
					conversationId: this.conversationId,
				}
				console.error("[DIFY DEBUG] No content was yielded! Diagnostic info:", diagnosticInfo)

				// If we have any accumulated text at all, yield it as a fallback
				if (fullText.trim()) {
					console.log("[DIFY DEBUG] Yielding accumulated text as fallback:", fullText)
					yield {
						type: "text",
						text: fullText,
					}
				} else {
					// Provide a more informative error
					throw new Error(
						`Dify API did not provide any assistant messages. ` +
							`Events processed: [${processedEvents.join(", ")}]. ` +
							`Check your Dify application configuration and ensure it's properly set up to return responses. ` +
							`API URL: ${fullUrl}. Conversation ID: ${this.conversationId || "none"}.`,
					)
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

	// Additional Dify API Methods

	/**
	 * Upload a file for use in conversations
	 * @param file File buffer to upload
	 * @param filename Name of the file
	 * @param user User identifier (defaults to "cline-user")
	 * @returns Promise with file upload response
	 */
	async uploadFile(file: Buffer, filename: string, user: string = "cline-user"): Promise<DifyFileResponse> {
		const formData = new FormData()
		formData.append("file", new Blob([new Uint8Array(file)]), filename)
		formData.append("user", user)

		const response = await fetch(`${this.baseUrl}/files/upload`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: formData,
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Dify file upload error: ${response.status} ${response.statusText} - ${errorText}`)
		}

		return response.json()
	}

	/**
	 * Stop generation for a specific task
	 * @param taskId Task ID from streaming response
	 * @param user User identifier (defaults to "cline-user")
	 * @returns Promise that resolves when generation is stopped
	 */
	async stopGeneration(taskId: string, user: string = "cline-user"): Promise<void> {
		const response = await fetch(`${this.baseUrl}/chat-messages/${taskId}/stop`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ user }),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Dify stop generation error: ${response.status} ${response.statusText} - ${errorText}`)
		}
	}

	/**
	 * Get conversation history messages with pagination
	 * @param conversationId Conversation ID
	 * @param user User identifier (defaults to "cline-user")
	 * @param firstId First message ID for pagination (optional)
	 * @param limit Number of messages to return (default: 20)
	 * @returns Promise with conversation history
	 */
	async getConversationHistory(
		conversationId: string,
		user: string = "cline-user",
		firstId?: string,
		limit: number = 20,
	): Promise<DifyHistoryResponse> {
		const params = new URLSearchParams({ user, limit: limit.toString() })
		if (firstId) {
			params.append("first_id", firstId)
		}

		const response = await fetch(`${this.baseUrl}/conversations/${conversationId}/messages?${params}`, {
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
			},
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Dify get conversation history error: ${response.status} ${response.statusText} - ${errorText}`)
		}

		return response.json()
	}

	/**
	 * Get list of conversations for a user
	 * @param user User identifier (defaults to "cline-user")
	 * @param lastId Last conversation ID for pagination (optional)
	 * @param limit Number of conversations to return (default: 20)
	 * @param sortBy Sort field (default: "-updated_at")
	 * @returns Promise with conversations list
	 */
	async getConversations(
		user: string = "cline-user",
		lastId?: string,
		limit: number = 20,
		sortBy: string = "-updated_at",
	): Promise<DifyConversationsResponse> {
		const params = new URLSearchParams({
			user,
			limit: limit.toString(),
			sort_by: sortBy,
		})
		if (lastId) {
			params.append("last_id", lastId)
		}

		const response = await fetch(`${this.baseUrl}/conversations?${params}`, {
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
			},
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Dify get conversations error: ${response.status} ${response.statusText} - ${errorText}`)
		}

		return response.json()
	}

	/**
	 * Delete a conversation
	 * @param conversationId Conversation ID to delete
	 * @param user User identifier (defaults to "cline-user")
	 * @returns Promise that resolves when conversation is deleted
	 */
	async deleteConversation(conversationId: string, user: string = "cline-user"): Promise<void> {
		const response = await fetch(`${this.baseUrl}/conversations/${conversationId}`, {
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ user }),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Dify delete conversation error: ${response.status} ${response.statusText} - ${errorText}`)
		}
	}

	/**
	 * Rename a conversation
	 * @param conversationId Conversation ID to rename
	 * @param user User identifier (defaults to "cline-user")
	 * @param name New conversation name (optional if auto_generate is true)
	 * @param autoGenerate Whether to auto-generate the name (default: false)
	 * @returns Promise with updated conversation details
	 */
	async renameConversation(
		conversationId: string,
		user: string = "cline-user",
		name?: string,
		autoGenerate: boolean = false,
	): Promise<DifyConversationResponse> {
		const body: any = { user, auto_generate: autoGenerate }
		if (name) {
			body.name = name
		}

		const response = await fetch(`${this.baseUrl}/conversations/${conversationId}/name`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Dify rename conversation error: ${response.status} ${response.statusText} - ${errorText}`)
		}

		return response.json()
	}

	/**
	 * Submit feedback for a message
	 * @param messageId Message ID to provide feedback for
	 * @param rating Rating: "like" or "dislike"
	 * @param content Optional feedback content
	 * @param user User identifier (defaults to "cline-user")
	 * @returns Promise that resolves when feedback is submitted
	 */
	async submitMessageFeedback(
		messageId: string,
		rating: "like" | "dislike",
		content?: string,
		user: string = "cline-user",
	): Promise<void> {
		const body: any = { rating, user }
		if (content) {
			body.content = content
		}

		const response = await fetch(`${this.baseUrl}/messages/${messageId}/feedbacks`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Dify submit feedback error: ${response.status} ${response.statusText} - ${errorText}`)
		}
	}

	/**
	 * Get current conversation ID
	 * @returns Current conversation ID or null
	 */
	getCurrentConversationId(): string | null {
		return this.conversationId
	}

	/**
	 * Set conversation ID for continuing existing conversations
	 * @param conversationId Conversation ID to set
	 */
	setConversationId(conversationId: string): void {
		this.conversationId = conversationId
	}

	/**
	 * Reset conversation ID to start a new conversation
	 */
	resetConversation(): void {
		this.conversationId = null
		this.currentTaskId = null
	}
}
