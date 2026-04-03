/**
 * ClineCore Session Factory
 *
 * Creates SdkSession instances backed by @clinebot/core's ClineCore.
 * Maps ClineCore events to the AgentEvent format used by MessageTranslator.
 *
 * ClineCore API (from createSessionHost):
 *   host.start(config) → starts a session
 *   host.send(sessionId, message) → sends a prompt
 *   host.subscribe(sessionId, callback) → event subscription
 *   host.abort(sessionId) → cancels
 *   host.stop(sessionId) → stops session
 *
 * TODO: Wire to ClineCore once the API is fully understood.
 * For now, returns a stub session that shows an informative error.
 */

import type { SdkSession, SessionFactory } from "./SdkController"
import type { AgentEvent } from "./message-translator"
import { Logger } from "@shared/services/Logger"

// ---------------------------------------------------------------------------
// Stub session — shows informative error until ClineCore is wired
// ---------------------------------------------------------------------------

class StubSession implements SdkSession {
	private eventHandler?: (event: AgentEvent) => void
	private running = false

	async sendPrompt(text: string, _images?: string[]): Promise<void> {
		this.running = true

		const stubMessage = `[SDK Migration] Session factory not yet wired to @clinebot/core.\n\nTask received: "${text.slice(0, 200)}"`

		// Emit events in the correct AgentEvent format that MessageTranslator expects:
		// iteration_start → content_start(text) → content_end(text) → usage → iteration_end → done
		this.emitEvent({ type: "iteration_start", iteration: 1 })

		this.emitEvent({
			type: "content_start",
			contentType: "text" as const,
			text: stubMessage,
			accumulated: stubMessage,
		})

		this.emitEvent({
			type: "content_end",
			contentType: "text" as const,
			text: stubMessage,
		})

		this.emitEvent({
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
			totalInputTokens: 0,
			totalOutputTokens: 0,
			totalCost: 0,
		})

		this.emitEvent({ type: "iteration_end" })

		this.emitEvent({
			type: "done",
			reason: "completed",
			text: stubMessage,
			iterations: 1,
			usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
		})

		this.running = false
	}

	async sendResponse(_text: string): Promise<void> {
		// No-op for stub
	}

	async abort(): Promise<void> {
		this.running = false
	}

	onEvent(handler: (event: AgentEvent) => void): void {
		this.eventHandler = handler
	}

	isRunning(): boolean {
		return this.running
	}

	private emitEvent(event: AgentEvent): void {
		if (this.eventHandler) {
			this.eventHandler(event)
		}
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a SessionFactory.
 *
 * Currently returns stub sessions. Will be replaced with ClineCore-backed
 * sessions once the ClineCore API integration is complete.
 *
 * ClineCore integration plan:
 * 1. createSessionHost({ sessionService, toolPolicies, ... })
 * 2. host.start({ cwd, prompt, ... }) to create sessions
 * 3. host.subscribe(sessionId, callback) for streaming events
 * 4. host.send(sessionId, prompt) for prompts
 * 5. host.abort(sessionId) for cancellation
 */
export function createClineSessionFactory(_options?: {
	clineDir?: string
}): SessionFactory {
	Logger.log("[ClineSessionFactory] Creating stub session factory (ClineCore not yet wired)")

	return async (_config) => {
		return new StubSession()
	}
}
