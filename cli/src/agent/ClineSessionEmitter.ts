/**
 * Typed EventEmitter for per-session ACP events.
 *
 * This class provides a type-safe wrapper around Node's EventEmitter
 * for emitting and subscribing to session-specific ACP events.
 *
 * @module acp
 */

import { EventEmitter } from "events"
import type { ClineSessionEvents } from "./types.js"

/**
 * Type-safe EventEmitter for ClineAgent session events.
 *
 * Each session has its own emitter instance, allowing consumers to
 * subscribe to events for specific sessions without filtering.
 *
 * @example
 * ```typescript
 * const agent = new ClineAgent({ version: "1.0.0" })
 * const session = await agent.newSession({ cwd: "/path/to/project" })
 *
 * // Subscribe to session events
 * agent.session(session.sessionId).on("agent_message_chunk", (content) => {
 *   console.log("Agent says:", content.text)
 * })
 *
 * agent.session(session.sessionId).on("tool_call", (toolCall) => {
 *   console.log("Tool called:", toolCall.toolName)
 * })
 * ```
 */
export class ClineSessionEmitter {
	private readonly emitter: EventEmitter

	constructor() {
		this.emitter = new EventEmitter()
		// Increase max listeners since we may have many event types
		this.emitter.setMaxListeners(20)
	}

	/**
	 * Subscribe to a session event.
	 *
	 * @param event - The event name to subscribe to
	 * @param listener - The callback function to invoke when the event is emitted
	 * @returns This emitter instance for chaining
	 */
	on<K extends keyof ClineSessionEvents>(event: K, listener: ClineSessionEvents[K]): this {
		this.emitter.on(event, listener as (...args: unknown[]) => void)
		return this
	}

	/**
	 * Subscribe to a session event for a single invocation.
	 *
	 * @param event - The event name to subscribe to
	 * @param listener - The callback function to invoke when the event is emitted
	 * @returns This emitter instance for chaining
	 */
	once<K extends keyof ClineSessionEvents>(event: K, listener: ClineSessionEvents[K]): this {
		this.emitter.once(event, listener as (...args: unknown[]) => void)
		return this
	}

	/**
	 * Unsubscribe from a session event.
	 *
	 * @param event - The event name to unsubscribe from
	 * @param listener - The callback function to remove
	 * @returns This emitter instance for chaining
	 */
	off<K extends keyof ClineSessionEvents>(event: K, listener: ClineSessionEvents[K]): this {
		this.emitter.off(event, listener as (...args: unknown[]) => void)
		return this
	}

	/**
	 * Emit a session event.
	 *
	 * @param event - The event name to emit
	 * @param args - The arguments to pass to the event listeners
	 * @returns True if the event had listeners, false otherwise
	 */
	emit<K extends keyof ClineSessionEvents>(event: K, ...args: Parameters<ClineSessionEvents[K]>): boolean {
		return this.emitter.emit(event, ...args)
	}

	/**
	 * Remove all listeners for a specific event or all events.
	 *
	 * @param event - Optional event name to remove listeners for
	 * @returns This emitter instance for chaining
	 */
	removeAllListeners<K extends keyof ClineSessionEvents>(event?: K): this {
		if (event) {
			this.emitter.removeAllListeners(event)
		} else {
			this.emitter.removeAllListeners()
		}
		return this
	}

	/**
	 * Get the number of listeners for a specific event.
	 *
	 * @param event - The event name to count listeners for
	 * @returns The number of listeners
	 */
	listenerCount<K extends keyof ClineSessionEvents>(event: K): number {
		return this.emitter.listenerCount(event)
	}
}
