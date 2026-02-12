import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineTool } from "@/shared/tools"
import { ApiHandler } from "."
import { sanitizeApiStream } from "./transform/sanitize-stream"
import { ApiStream } from "./transform/stream"

/**
 * Wraps an API handler to apply consistent stream sanitization.
 * Drops empty text/reasoning chunks at the source before they reach
 * downstream consumers. The canonical throttle lives in
 * subscribeToPartialMessage.ts — no timing is applied here.
 */
export class ThrottledApiHandler implements ApiHandler {
	constructor(private readonly handler: ApiHandler) {}

	async *createMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ClineTool[],
		useResponseApi?: boolean,
	): ApiStream {
		// Provider-agnostic stream hygiene only — no timing/throttling.
		yield* sanitizeApiStream(this.handler.createMessage(systemPrompt, messages, tools, useResponseApi))
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
