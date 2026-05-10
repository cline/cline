import { ApiStream, ApiStreamChunk, ApiStreamUsageChunk } from "@core/api/transform/stream"
import { Logger } from "@/shared/services/Logger"

/*
This coordinator splits stream handling into two paths:

1) usage chunks:
   - processed immediately via onUsageChunk
   - used to keep token/cost state current while the request is still active

2) non-usage chunks (text/reasoning/tool_calls):
   - queued and consumed by the normal Task flow
   - that flow may await tool execution or ask prompts, which can block for user input

Without this split, usage updates can be delayed behind awaited UI/tool work.
*/
export type NonUsageApiStreamChunk = Exclude<ApiStreamChunk, { type: "usage" }>

/**
 * Thrown by the pump when no chunk is received from the underlying stream
 * within `idleTimeoutMs`. Treated as a generic recoverable error so it flows
 * through the existing retry path in `attemptApiRequest()` (3x exponential
 * backoff) rather than being classified as an auth/balance/quota failure.
 */
export class StreamIdleTimeoutError extends Error {
	constructor(idleMs: number) {
		super(`Stream idle timeout: no data received for ${idleMs}ms`)
		this.name = "StreamIdleTimeoutError"
	}
}

type StreamChunkCoordinatorOptions = {
	onUsageChunk: (chunk: ApiStreamUsageChunk) => void
	idleTimeoutMs?: number
}

export class StreamChunkCoordinator {
	private iterator: AsyncGenerator<ApiStreamChunk>
	private queue: NonUsageApiStreamChunk[] = []
	private readError: unknown
	private completed = false
	private stopRequested = false
	private waiterResolve: (() => void) | undefined
	private pumpPromise: Promise<void>

	constructor(
		stream: ApiStream,
		private readonly options: StreamChunkCoordinatorOptions,
	) {
		this.iterator = stream[Symbol.asyncIterator]()
		this.pumpPromise = this.startPump()
	}

	private notifyWaiter() {
		if (this.waiterResolve) {
			this.waiterResolve()
			this.waiterResolve = undefined
		}
	}

	private async waitForData() {
		if (this.queue.length > 0 || this.completed || this.readError) {
			return
		}
		await new Promise<void>((resolve) => {
			this.waiterResolve = resolve
		})
	}

	private async closeIterator() {
		if (typeof this.iterator.return !== "function") {
			return
		}
		try {
			await this.iterator.return(undefined)
		} catch (error) {
			Logger.debug(`[StreamChunkCoordinator] Failed to close stream iterator: ${error}`)
		}
	}

	/**
	 * Races `promise` against a per-call idle timeout. Used by the pump to
	 * detect TCP "half-open" situations where the connection is still alive
	 * but no data is being delivered (e.g. upstream LLM service freezes).
	 *
	 * Implementation notes:
	 * - Uses `Promise.race` to avoid wrapping the iterator itself; the timer is
	 *   armed fresh for every chunk so a slow-but-steady stream never trips it.
	 * - `clearTimeout` runs in `finally` so that both success and failure paths
	 *   release the pending timer immediately, preventing node event-loop leaks
	 *   and keeping `stop()` able to return promptly.
	 */
	private async withIdleTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => reject(new StreamIdleTimeoutError(timeoutMs)), timeoutMs)
		})
		try {
			return await Promise.race([promise, timeoutPromise])
		} finally {
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId)
			}
		}
	}

	private startPump(): Promise<void> {
		return (async () => {
			try {
				while (!this.stopRequested) {
					const nextResult = this.options.idleTimeoutMs
						? await this.withIdleTimeout(this.iterator.next(), this.options.idleTimeoutMs)
						: await this.iterator.next()
					const { value: chunk, done } = nextResult
					if (done || !chunk) {
						break
					}
					if (chunk.type === "usage") {
						this.options.onUsageChunk(chunk)
						continue
					}
					this.queue.push(chunk)
					this.notifyWaiter()
				}
			} catch (error) {
				this.readError = error
			} finally {
				this.completed = true
				this.notifyWaiter()
			}
		})()
	}

	async nextChunk(): Promise<NonUsageApiStreamChunk | undefined> {
		while (true) {
			if (this.readError) {
				throw this.readError
			}
			const chunk = this.queue.shift()
			if (chunk) {
				return chunk
			}
			if (this.completed) {
				return undefined
			}
			await this.waitForData()
		}
	}

	async stop(): Promise<void> {
		this.stopRequested = true
		await this.closeIterator()
		await this.pumpPromise.catch(() => {})
	}

	async waitForCompletion(): Promise<void> {
		await this.pumpPromise
		if (this.readError) {
			throw this.readError
		}
	}
}
