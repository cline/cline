import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineTool } from "@/shared/tools"
import { ApiHandler } from "."
import { sanitizeApiStream } from "./transform/sanitize-stream"
import { ApiStream } from "./transform/stream"
import { throttleReasoningStream } from "./transform/throttle-reasoning"

/**
 * Wraps an API handler to apply consistent reasoning stream throttling
 * This ensures a smooth, readable streaming experience across all providers
 */
export class ThrottledApiHandler implements ApiHandler {
	constructor(private readonly handler: ApiHandler) {}

	async *createMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ClineTool[],
		useResponseApi?: boolean,
	): ApiStream {
		// Shared provider-agnostic stream hygiene first, then reasoning smoothing.
		const sanitizedStream = sanitizeApiStream(this.handler.createMessage(systemPrompt, messages, tools, useResponseApi))
		yield* throttleReasoningStream(sanitizedStream)
	}

	getModel() {
		return this.handler.getModel()
	}

	// Optional methods - use optional chaining since not all handlers implement these
	async getApiStreamUsage() {
		return this.handler.getApiStreamUsage?.()
	}

	abort() {
		return this.handler.abort?.()
	}
}
