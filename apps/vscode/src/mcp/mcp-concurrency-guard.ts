/**
 * Concurrency guard to serialize manual UI operations and external MCP tool calls per workspace.
 */
export class McpConcurrencyGuard {
	private isLocked = false
	private readonly queue: Array<() => void> = []

	/**
	 * Acquires an exclusive lock. If locked, waits in queue until released.
	 * Returns a release function to unlock.
	 */
	public async acquire(): Promise<() => void> {
		if (this.isLocked) {
			await new Promise<void>((resolve) => {
				this.queue.push(resolve)
			})
		}
		this.isLocked = true

		let released = false
		return () => {
			if (released) {
				return
			}
			released = true

			const next = this.queue.shift()
			if (next) {
				next()
			} else {
				this.isLocked = false
			}
		}
	}

	/**
	 * Runs an async task within the concurrency lock.
	 */
	public async runExclusive<T>(task: () => Promise<T>): Promise<T> {
		const release = await this.acquire()
		try {
			return await task()
		} finally {
			release()
		}
	}

	public get locked(): boolean {
		return this.isLocked
	}

	public get queueLength(): number {
		return this.queue.length
	}
}
