import { Anthropic } from "@anthropic-ai/sdk"

export class CursorMessageError extends Error {
	constructor(
		message: string,
		public readonly type: "validation" | "transformation" | "unknown" = "unknown",
		public readonly details?: unknown,
	) {
		super(message)
		this.name = "CursorMessageError"
		Object.setPrototypeOf(this, CursorMessageError.prototype)
	}
}

interface CursorMessage {
	type: "MESSAGE_TYPE_HUMAN" | "MESSAGE_TYPE_AI"
	text: string
	attached_code_chunks: Array<{
		relativeWorkspacePath: string
		startLineNumber: number
		lines: string[]
	}>
}

/**
 * Validates a Cursor message object
 * @param message The message object to validate
 * @throws {CursorMessageError} If validation fails
 */
function validateCursorMessage(message: unknown): asserts message is CursorMessage {
	if (!message || typeof message !== "object") {
		throw new CursorMessageError("Invalid message: must be an object", "validation")
	}

	const msg = message as Partial<CursorMessage>

	if (!msg.type || !["MESSAGE_TYPE_HUMAN", "MESSAGE_TYPE_AI"].includes(msg.type)) {
		throw new CursorMessageError("Invalid message type", "validation", { type: msg.type })
	}

	if (typeof msg.text !== "string") {
		throw new CursorMessageError("Invalid message text: must be a string", "validation", { text: msg.text })
	}

	if (!Array.isArray(msg.attached_code_chunks)) {
		throw new CursorMessageError("Invalid attached_code_chunks: must be an array", "validation")
	}

	for (const chunk of msg.attached_code_chunks) {
		if (typeof chunk !== "object" || chunk === null) {
			throw new CursorMessageError("Invalid code chunk: must be an object", "validation", { chunk })
		}

		if (typeof chunk.relativeWorkspacePath !== "string") {
			throw new CursorMessageError("Invalid code chunk: missing or invalid relativeWorkspacePath", "validation", { chunk })
		}

		if (typeof chunk.startLineNumber !== "number" || chunk.startLineNumber < 1) {
			throw new CursorMessageError("Invalid code chunk: startLineNumber must be a positive number", "validation", { chunk })
		}

		if (!Array.isArray(chunk.lines) || !chunk.lines.every((line) => typeof line === "string")) {
			throw new CursorMessageError("Invalid code chunk: lines must be an array of strings", "validation", { chunk })
		}
	}
}

/**
 * Converts Anthropic messages to Cursor format with validation
 * @param systemPrompt The system prompt to be included as the first message
 * @param messages Array of Anthropic messages to convert
 * @returns Array of validated Cursor messages
 * @throws {CursorMessageError} If message transformation or validation fails
 */
export function convertToCursorMessages(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): CursorMessage[] {
	try {
		const cursorMessages: CursorMessage[] = []

		// Add system prompt as a separate message
		if (systemPrompt) {
			const systemMessage: CursorMessage = {
				type: "MESSAGE_TYPE_AI",
				text: systemPrompt,
				attached_code_chunks: [],
			}
			validateCursorMessage(systemMessage)
			cursorMessages.push(systemMessage)
		}

		// Process each message
		for (const message of messages) {
			let text: string
			if (typeof message.content === "string") {
				text = message.content
			} else {
				// For array content, process each block appropriately
				text = message.content
					.map((block) => {
						if (block.type === "text") {
							return block.text
						}
						// Tool calls are handled as part of the text content
						return ""
					})
					.filter(Boolean)
					.join("\n\n")
			}

			const cursorMessage: CursorMessage = {
				type: message.role === "user" ? "MESSAGE_TYPE_HUMAN" : "MESSAGE_TYPE_AI",
				text,
				attached_code_chunks: [],
			}
			validateCursorMessage(cursorMessage)
			cursorMessages.push(cursorMessage)
		}

		return cursorMessages
	} catch (error) {
		if (error instanceof CursorMessageError) {
			throw error
		}
		throw new CursorMessageError(
			"Failed to convert messages to Cursor format",
			"transformation",
			error instanceof Error ? error.message : error,
		)
	}
}

/**
 * Converts a Cursor message back to Anthropic format with validation
 * @param message The Cursor message to convert
 * @returns Anthropic message format
 * @throws {CursorMessageError} If message transformation or validation fails
 */
export function convertToAnthropicMessage(message: CursorMessage): Anthropic.Messages.MessageParam {
	try {
		validateCursorMessage(message)
		return {
			role: message.type === "MESSAGE_TYPE_HUMAN" ? "user" : "assistant",
			content: [
				{
					type: "text",
					text: message.text,
				},
			],
		}
	} catch (error) {
		if (error instanceof CursorMessageError) {
			throw error
		}
		throw new CursorMessageError(
			"Failed to convert Cursor message to Anthropic format",
			"transformation",
			error instanceof Error ? error.message : error,
		)
	}
}
