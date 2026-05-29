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

type StreamChunkCoordinatorOptions = {
	onUsageChunk: (chunk: ApiStreamUsageChunk) => void
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

	private startPump(): Promise<void> {
		return (async () => {
			try {
				while (!this.stopRequested) {
					const { value: chunk, done } = await this.iterator.next()
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
