import { CopilotClient } from "@github/copilot-sdk"
import { ParseEntry, parse } from "shell-quote"
import { ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import {
	BeadsmithAssistantToolUseBlock,
	BeadsmithContent,
	BeadsmithPromptInputContent,
	BeadsmithStorageMessage,
	BeadsmithUserToolResultContentBlock,
} from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { ApiStream, ApiStreamChunk, ApiStreamUsageChunk } from "../transform/stream"

interface CopilotSdkHandlerOptions extends CommonApiHandlerOptions {
	copilotCliPath?: string
	copilotCliArgs?: string
	copilotCliUrl?: string
	copilotGithubToken?: string
	copilotUseLoggedInUser?: boolean
	apiModelId?: string
	reasoningEffort?: string
	requestTimeoutMs?: number
}

type CopilotUsageEvent = {
	inputTokens?: number
	outputTokens?: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
	cost?: number
}

const DEFAULT_MODEL_ID = "copilot-sdk"
const DEFAULT_LOG_LEVEL = "error"

function parseCliArgs(rawArgs?: string): string[] | undefined {
	if (!rawArgs || !rawArgs.trim()) {
		return undefined
	}

	try {
		const parsed = parse(rawArgs)
		const args = parsed.filter((entry): entry is string => typeof entry === "string")
		const hasUnsupported = parsed.some((entry: ParseEntry) => typeof entry !== "string")

		if (hasUnsupported) {
			Logger.warn("Copilot SDK: Ignoring unsupported CLI args entries.")
		}

		return args.length > 0 ? args : undefined
	} catch (error) {
		Logger.warn("Copilot SDK: Failed to parse CLI args.", error)
		return undefined
	}
}

function formatToolResultContent(content?: BeadsmithPromptInputContent | BeadsmithContent[]): string {
	if (!content) {
		return ""
	}

	if (typeof content === "string") {
		return content
	}

	const parts: string[] = []
	for (const part of content) {
		if (part.type === "text") {
			parts.push(part.text)
		} else {
			parts.push("[Non-text content omitted]")
		}
	}

	return parts.join("\n")
}

function formatToolResult(block: BeadsmithUserToolResultContentBlock): string {
	const header = block.tool_use_id ? `Tool result (${block.tool_use_id})` : "Tool result"
	const body = formatToolResultContent(block.content)
	return body ? `${header}:\n${body}` : header
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value)
	} catch {
		return "[Unserializable arguments]"
	}
}

function formatToolCall(block: BeadsmithAssistantToolUseBlock): string {
	const args = block.input ? safeStringify(block.input) : ""
	return args ? `Tool call: ${block.name} ${args}` : `Tool call: ${block.name}`
}

function formatMessageContent(content: BeadsmithPromptInputContent | BeadsmithContent[]): string {
	if (typeof content === "string") {
		return content
	}

	const parts: string[] = []
	for (const block of content) {
		switch (block.type) {
			case "text":
				parts.push(block.text)
				break
			case "tool_result":
				parts.push(formatToolResult(block))
				break
			case "tool_use":
				parts.push(formatToolCall(block))
				break
			case "image":
			case "document":
				parts.push("[Non-text content omitted]")
				break
			case "thinking":
			case "redacted_thinking":
				break
			default:
				break
		}
	}

	return parts.filter(Boolean).join("\n")
}

function formatCopilotPrompt(messages: BeadsmithStorageMessage[]): string {
	return messages
		.map((message) => {
			const roleLabel = message.role === "assistant" ? "Assistant" : "User"
			const body = formatMessageContent(message.content).trim()
			return body ? `${roleLabel}:\n${body}` : `${roleLabel}:`
		})
		.join("\n\n")
}

function toUsageChunk(usage?: CopilotUsageEvent): ApiStreamUsageChunk | undefined {
	if (!usage) {
		return undefined
	}

	return {
		type: "usage",
		inputTokens: usage.inputTokens ?? 0,
		outputTokens: usage.outputTokens ?? 0,
		cacheReadTokens: usage.cacheReadTokens,
		cacheWriteTokens: usage.cacheWriteTokens,
		totalCost: usage.cost,
	}
}

export class CopilotSdkHandler implements ApiHandler {
	private options: CopilotSdkHandlerOptions
	private client: CopilotClient | undefined
	private session: { destroy?: () => Promise<void> } | undefined
	private aborted = false
	private abortHandler: (() => void) | undefined

	constructor(options: CopilotSdkHandlerOptions) {
		this.options = options
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: BeadsmithStorageMessage[]): ApiStream {
		if (!this.options.apiModelId) {
			throw new Error("GitHub Copilot SDK requires a model ID. Configure it in settings.")
		}

		const cliUrl = this.options.copilotCliUrl?.trim() || undefined
		const cliArgs = parseCliArgs(this.options.copilotCliArgs)

		const client = new CopilotClient({
			cliUrl,
			cliPath: cliUrl ? undefined : this.options.copilotCliPath?.trim(),
			cliArgs,
			logLevel: DEFAULT_LOG_LEVEL,
			...(cliUrl
				? {}
				: {
						githubToken: this.options.copilotGithubToken,
						useLoggedInUser: this.options.copilotUseLoggedInUser,
					}),
		})

		this.client = client

		const sessionConfig = {
			model: this.options.apiModelId,
			streaming: true,
			availableTools: [],
			systemMessage: systemPrompt ? { content: systemPrompt } : undefined,
			...(this.options.reasoningEffort && { reasoningEffort: this.options.reasoningEffort }),
		}
		const session = await client.createSession(sessionConfig as any)

		this.session = session

		const prompt = formatCopilotPrompt(messages)
		const pending: ApiStreamChunk[] = []
		let sawDelta = false
		let done = false
		let pendingError: Error | undefined
		let notify: (() => void) | undefined

		const wake = () => {
			if (notify) {
				notify()
				notify = undefined
			}
		}

		const push = (chunk: ApiStreamChunk) => {
			pending.push(chunk)
			wake()
		}

		const finish = (error?: Error) => {
			if (done) {
				return
			}
			done = true
			pendingError = error
			wake()
		}

		this.abortHandler = () => finish(new Error("Copilot SDK request aborted."))

		const unsubscribe = session.on((event: any) => {
			if (this.aborted) {
				return
			}

			switch (event.type) {
				case "assistant.message_delta":
					if (event.data?.deltaContent) {
						sawDelta = true
						push({ type: "text", text: event.data.deltaContent })
					}
					break
				case "assistant.message":
					if (!sawDelta && event.data?.content) {
						push({ type: "text", text: event.data.content })
					}
					break
				case "assistant.usage": {
					const usageChunk = toUsageChunk(event.data as CopilotUsageEvent)
					if (usageChunk) {
						push(usageChunk)
					}
					break
				}
				case "session.error": {
					const message = event.data?.message || "Copilot session error"
					finish(new Error(message))
					break
				}
				case "session.idle":
					finish()
					break
			}
		})

		try {
			try {
				await session.send({ prompt })
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)))
			}

			while (!done || pending.length > 0) {
				if (pending.length === 0) {
					await new Promise<void>((resolve) => {
						notify = resolve
						if (done) {
							wake()
						}
					})
				}

				while (pending.length > 0) {
					const chunk = pending.shift()
					if (chunk) {
						yield chunk
					}
				}
			}

			if (pendingError) {
				throw pendingError
			}
		} finally {
			unsubscribe()
			this.abortHandler = undefined
			await this.cleanup()
		}
	}

	abort(): void {
		this.aborted = true
		if (this.abortHandler) {
			this.abortHandler()
		}
		void this.cleanup()
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.apiModelId || DEFAULT_MODEL_ID,
			info: {
				...openAiModelInfoSaneDefaults,
				description: "GitHub Copilot SDK",
			},
		}
	}

	private async cleanup() {
		try {
			if (this.session?.destroy) {
				await this.session.destroy()
			}
		} catch (error) {
			Logger.warn("Copilot SDK: Failed to destroy session.", error)
		}

		try {
			if (this.client) {
				await this.client.stop()
			}
		} catch (error) {
			Logger.warn("Copilot SDK: Failed to stop client.", error)
		} finally {
			this.session = undefined
			this.client = undefined
		}
	}
}
