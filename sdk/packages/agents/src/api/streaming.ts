/**
 * Streaming Support
 *
 * Provides async iterable wrapper for streaming agent events in real-time.
 */

import type { Agent } from "../agent";
import type { AgentEvent, AgentResult } from "../types";

// =============================================================================
// AgentStream
// =============================================================================

/**
 * A stream of agent events that can be iterated asynchronously
 *
 * @example
 * ```typescript
 * const stream = streamRun(agent, "Hello")
 *
 * for await (const event of stream) {
 *   if (event.type === "content_start" && event.contentType === "text") {
 *     process.stdout.write(event.text ?? "")
 *   }
 * }
 *
 * const result = await stream.getResult()
 * ```
 */
export interface AgentStream extends AsyncIterable<AgentEvent> {
	/**
	 * Get the final result after the stream completes
	 *
	 * This promise resolves when the agent finishes (successfully or with error).
	 * Call this after iterating through all events, or if you don't need events
	 * and just want the final result.
	 */
	getResult(): Promise<AgentResult>;

	/**
	 * Abort the stream
	 *
	 * This stops the agent execution and closes the stream.
	 */
	abort(): void;
}

// =============================================================================
// Stream Implementation
// =============================================================================

/**
 * Internal implementation of AgentStream
 */
class AgentStreamImpl implements AgentStream {
	private eventQueue: AgentEvent[] = [];
	private waitingResolvers: Array<(value: IteratorResult<AgentEvent>) => void> =
		[];
	private isDone = false;
	private resultPromise: Promise<AgentResult>;
	private resolveResult!: (result: AgentResult) => void;
	private rejectResult!: (error: Error) => void;
	private abortController: AbortController;
	private unsubscribeEvents: (() => void) | null = null;

	constructor(
		private agent: Agent,
		private message: string,
		private isContinue: boolean,
	) {
		this.abortController = new AbortController();

		// Create result promise
		this.resultPromise = new Promise((resolve, reject) => {
			this.resolveResult = resolve;
			this.rejectResult = reject;
		});

		// Start the run
		this.startRun();
	}

	private async startRun(): Promise<void> {
		this.unsubscribeEvents = this.agent.subscribeEvents((event: AgentEvent) => {
			this.enqueueEvent(event);
		});
		try {
			// Run or continue
			const result = this.isContinue
				? await this.agent.continue(this.message)
				: await this.agent.run(this.message);

			// Mark as done
			this.isDone = true;
			this.flushWaiters();
			this.resolveResult(result);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.isDone = true;
			this.flushWaiters();
			this.rejectResult(err);
		} finally {
			this.unsubscribeEvents?.();
			this.unsubscribeEvents = null;
		}
	}

	private enqueueEvent(event: AgentEvent): void {
		if (this.waitingResolvers.length > 0) {
			// Someone is waiting - resolve immediately
			const resolve = this.waitingResolvers.shift()!;
			resolve({ value: event, done: false });
		} else {
			// Queue the event
			this.eventQueue.push(event);
		}
	}

	private flushWaiters(): void {
		// Resolve any remaining waiters with done
		while (this.waitingResolvers.length > 0) {
			const resolve = this.waitingResolvers.shift()!;
			resolve({ value: undefined as unknown as AgentEvent, done: true });
		}
	}

	[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
		return {
			next: async (): Promise<IteratorResult<AgentEvent>> => {
				// Check if we have queued events
				if (this.eventQueue.length > 0) {
					return { value: this.eventQueue.shift()!, done: false };
				}

				// Check if we're done
				if (this.isDone) {
					return { value: undefined as unknown as AgentEvent, done: true };
				}

				// Wait for next event
				return new Promise((resolve) => {
					this.waitingResolvers.push(resolve);
				});
			},
		};
	}

	getResult(): Promise<AgentResult> {
		return this.resultPromise;
	}

	abort(): void {
		const reason = new Error("Agent stream aborted");
		this.abortController.abort(reason);
		this.agent.abort(reason);
	}
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a streaming agent run
 *
 * This returns an AgentStream that can be iterated to receive events
 * as they happen, with the final result available via getResult().
 *
 * @param agent - The agent to run
 * @param message - The user message to send
 * @returns An AgentStream for real-time event consumption
 *
 * @example
 * ```typescript
 * const stream = streamRun(agent, "Analyze this code")
 *
 * for await (const event of stream) {
 *   switch (event.type) {
 *     case "content_start":
 *       if (event.contentType === "text") {
 *         process.stdout.write(event.text ?? "")
 *       }
 *       break
 *     case "content_end":
 *       if (event.contentType === "tool") {
 *         console.log(`Done (${event.durationMs}ms)`)
 *       }
 *       break
 *   }
 * }
 *
 * const result = await stream.getResult()
 * console.log("\nTotal cost:", result.usage.totalCost)
 * ```
 */
export function streamRun(agent: Agent, message: string): AgentStream {
	return new AgentStreamImpl(agent, message, false);
}

/**
 * Create a streaming agent continuation
 *
 * Like streamRun, but continues an existing conversation.
 *
 * @param agent - The agent to continue
 * @param message - The user message to add
 * @returns An AgentStream for real-time event consumption
 */
export function streamContinue(agent: Agent, message: string): AgentStream {
	return new AgentStreamImpl(agent, message, true);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Collect all events from a stream into an array
 *
 * Useful for testing or when you need all events at once.
 */
export async function collectEvents(
	stream: AgentStream,
): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

/**
 * Filter events by type
 *
 * @example
 * ```typescript
 * for await (const event of filterEvents(stream, "text")) {
 *   console.log(event.text)
 * }
 * ```
 */
export async function* filterEvents<T extends AgentEvent["type"]>(
	stream: AgentStream,
	type: T,
): AsyncGenerator<Extract<AgentEvent, { type: T }>> {
	for await (const event of stream) {
		if (event.type === type) {
			yield event as Extract<AgentEvent, { type: T }>;
		}
	}
}

/**
 * Map events to a different format
 */
export async function* mapEvents<T>(
	stream: AgentStream,
	mapper: (event: AgentEvent) => T,
): AsyncGenerator<T> {
	for await (const event of stream) {
		yield mapper(event);
	}
}

/**
 * Buffer events and yield in batches
 */
export async function* batchEvents(
	stream: AgentStream,
	batchSize: number,
): AsyncGenerator<AgentEvent[]> {
	let batch: AgentEvent[] = [];

	for await (const event of stream) {
		batch.push(event);
		if (batch.length >= batchSize) {
			yield batch;
			batch = [];
		}
	}

	if (batch.length > 0) {
		yield batch;
	}
}

/**
 * Create a simple text accumulator that yields text as it streams
 *
 * @example
 * ```typescript
 * for await (const text of streamText(agent, "Hello")) {
 *   process.stdout.write(text)
 * }
 * ```
 */
export async function* streamText(
	agent: Agent,
	message: string,
): AsyncGenerator<string> {
	const stream = streamRun(agent, message);

	for await (const event of stream) {
		if (event.type === "content_start" && event.contentType === "text") {
			yield event.text ?? "";
		}
	}
}
