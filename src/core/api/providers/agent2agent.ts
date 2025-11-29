import { Message, MessageSendParams, Part, TaskArtifactUpdateEvent, TaskStatusUpdateEvent } from "@a2a-js/sdk"
import { A2AClient } from "@a2a-js/sdk/client"
import { v4 as uuidv4 } from "uuid"
import { ModelInfo } from "@/shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { ApiStream } from "../transform/stream"

export interface A2AHandlerOptions extends CommonApiHandlerOptions {
	a2aAgentCardUrl?: string
	a2aAuthToken?: string
	ulid?: string // for contextId
}

export class A2AHandler implements ApiHandler {
	private options: A2AHandlerOptions
	private client: A2AClient | undefined
	private connectedTaskId: string | undefined
	private previousTaskId: string | undefined

	constructor(options: A2AHandlerOptions) {
		this.options = options
	}

	private async ensureClient(): Promise<A2AClient> {
		if (!this.client) {
			const fetchImpl = this.options.a2aAuthToken
				? async (url: RequestInfo | URL, init?: RequestInit) => {
						const headers = new Headers(init?.headers)
						headers.set("Authorization", `Bearer ${this.options.a2aAuthToken}`)
						return fetch(url, { ...init, headers })
					}
				: undefined

			this.client = await A2AClient.fromCardUrl(
				this.options.a2aAgentCardUrl || "http://localhost:10002/.well-known/agent-card.json",
				{ fetchImpl },
			)
		}
		return this.client
	}

	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const client = await this.ensureClient()
		// Use ULID as the stable context ID for the session
		const contextId = this.options.ulid || uuidv4()
		// If we have a connected task, use it. Otherwise start a new task (undefined taskId)
		const taskId = this.connectedTaskId

		const lastMessage = messages[messages.length - 1]
		if (!lastMessage || lastMessage.role !== "user") {
			throw new Error("No user message found to send to A2A agent.")
		}

		// Function to build parts (extracted to allow rebuilding with history)
		const buildParts = (includeHistory: boolean): Part[] => {
			const parts: Part[] = []
			let textContent = `System Instructions:\n${systemPrompt}\n\n`

			if (includeHistory && messages.length > 1) {
				const historyText = this.constructHistory(messages.slice(0, -1))
				textContent += `Conversation History:\n${historyText}\n\n`
			}

			textContent += "User Request:\n"

			if (typeof lastMessage.content === "string") {
				textContent += lastMessage.content
				parts.push({ kind: "text", text: textContent })
			} else {
				for (const block of lastMessage.content) {
					if (block.type === "text") {
						textContent += block.text
					} else if (block.type === "image") {
						if (textContent) {
							parts.push({ kind: "text", text: textContent })
							textContent = ""
						}
						if (block.source.type === "base64") {
							parts.push({
								kind: "file",
								file: {
									bytes: block.source.data,
									mimeType: block.source.media_type,
									name: "image",
								},
							})
						}
					}
				}
				if (textContent) {
					parts.push({ kind: "text", text: textContent })
				}
			}
			return parts
		}

		const parts = buildParts(false) // Initially try without history (assuming session is active)

		if (parts.length === 0) {
			throw new Error("Empty message content.")
		}

		const messageId = uuidv4()
		const messagePayload: Message = {
			kind: "message",
			messageId,
			role: "user",
			parts,
			taskId, // Undefined if starting new task
			contextId,
			referenceTaskIds: !taskId && this.previousTaskId ? [this.previousTaskId] : undefined,
		}

		const params: MessageSendParams = {
			message: messagePayload,
			configuration: { blocking: false },
		}

		try {
			const stream = client.sendMessageStream(params)
			for await (const chunk of this.handleStream(stream)) {
				yield chunk
			}
		} catch (error: any) {
			// Handle "Task Not Found" (-32001) or "Task in Terminal State" (-32600 or message)
			// We check for error codes first, then fallback to message string matching
			const errorCode = error.code || error.errorResponse?.error?.code
			const isTaskError =
				errorCode === -32001 ||
				errorCode === -32600 ||
				(error.message &&
					(error.message.includes("-32001") ||
						(error.message.includes("Task") &&
							(error.message.includes("not found") || error.message.includes("does not exist"))) ||
						error.message.includes("terminal state")))

			if (isTaskError) {
				console.log("A2A Task error (Not Found or Terminal), creating new task with history...")
				// Clear connected task as it is likely invalid/finished
				this.connectedTaskId = undefined

				// Rebuild parts with history
				const newParts = buildParts(true)
				const retryPayload: Message = {
					...messagePayload,
					parts: newParts,
					taskId: undefined, // Clear taskId to create new task
					contextId, // Reuse stable contextId
					referenceTaskIds: this.previousTaskId ? [this.previousTaskId] : undefined,
				}
				const retryParams: MessageSendParams = {
					...params,
					message: retryPayload,
				}

				const retryStream = client.sendMessageStream(retryParams)
				for await (const chunk of this.handleStream(retryStream)) {
					yield chunk
				}
				return
			}
			console.error("A2A API Error:", error)
			throw error
		}
	}

	private constructHistory(messages: ClineStorageMessage[]): string {
		return messages
			.map((m) => {
				const content =
					typeof m.content === "string"
						? m.content
						: m.content
								.map((c) => {
									if (c.type === "text") return c.text
									if (c.type === "image") return "[Image]"
									return ""
								})
								.join("")
				return `${m.role.toUpperCase()}: ${content}`
			})
			.join("\n\n")
	}

	private async *handleStream(stream: AsyncGenerator<any>): ApiStream {
		const yieldedLengths = new Map<string, number>()

		for await (const event of stream) {
			// Capture connected taskId
			if (event.kind === "task" && event.id) {
				this.connectedTaskId = event.id
			} else if (event.kind === "status-update" && event.taskId) {
				this.connectedTaskId = event.taskId
			}

			if (event.kind === "status-update") {
				const update = event as TaskStatusUpdateEvent
				if (update.status.message) {
					const msg = update.status.message
					let fullText = ""
					for (const part of msg.parts) {
						if (part.kind === "text") {
							fullText += part.text
						}
					}

					if (fullText) {
						const lastLen = yieldedLengths.get(msg.messageId) || 0
						if (fullText.length > lastLen) {
							const delta = fullText.substring(lastLen)
							yield {
								type: "text",
								text: delta,
							}
							yieldedLengths.set(msg.messageId, fullText.length)
						}
					}
				}

				if (update.final) {
					const state = update.status.state
					if (state === "completed" || state === "failed" || state === "canceled" || state === "rejected") {
						this.previousTaskId = this.connectedTaskId
						this.connectedTaskId = undefined
					}

					if (state === "failed") {
						let errorMsg = "Agent failed."
						if (update.status.message?.parts) {
							const textParts = update.status.message.parts
								.filter((p: any) => p.kind === "text")
								.map((p: any) => p.text)
								.join(" ")
							if (textParts) errorMsg = textParts
						}
						throw new Error(`A2A Agent Error: ${errorMsg}`)
					}
				}
			} else if (event.kind === "message") {
				const msg = event as Message
				let fullText = ""
				for (const part of msg.parts) {
					if (part.kind === "text") {
						fullText += part.text
					}
				}

				if (fullText) {
					const lastLen = yieldedLengths.get(msg.messageId) || 0
					if (fullText.length > lastLen) {
						const delta = fullText.substring(lastLen)
						yield {
							type: "text",
							text: delta,
						}
						yieldedLengths.set(msg.messageId, fullText.length)
					}
				}
			} else if (event.kind === "artifact-update") {
				const update = event as TaskArtifactUpdateEvent
				if (update.artifact) {
					let artifactText = `\n\n[Artifact Generated: ${update.artifact.name || "Unnamed"}]\n`
					if (update.artifact.description) {
						artifactText += `Description: ${update.artifact.description}\n`
					}
					// Extract text content from artifact if available
					for (const part of update.artifact.parts) {
						if (part.kind === "text") {
							artifactText += `Content: ${part.text}\n`
						} else if (part.kind === "file") {
							artifactText += `File: ${part.file.name || "Unknown file"} (${part.file.mimeType})\n`
							if ("uri" in part.file) {
								artifactText += `URI: ${part.file.uri}\n`
							}
						}
					}
					yield {
						type: "text",
						text: artifactText,
					}
				}
			}
		}

		yield {
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		// A2A doesn't have a fixed "model" concept in the same way, it's an agent.
		// We return a placeholder with good limits.
		return {
			id: "a2a-agent",
			info: {
				maxTokens: -1,
				contextWindow: 1000000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
			},
		}
	}
}
