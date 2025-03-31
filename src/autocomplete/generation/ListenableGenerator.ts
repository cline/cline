export class ListenableGenerator<T> {
	private _source: AsyncGenerator<T>
	private _buffer: T[] = []
	private _listeners: Set<(value: T) => void> = new Set()
	private _isEnded = false
	private _abortController: AbortController

	constructor(
		source: AsyncGenerator<T>,
		private readonly onError: (e: any) => void,
		abortController: AbortController,
	) {
		this._source = source
		this._abortController = abortController
		this._start()
	}

	public cancel() {
		this._abortController.abort()
		this._isEnded = true
	}

	private async _start() {
		try {
			for await (const value of this._source) {
				if (this._isEnded) {
					break
				}
				this._buffer.push(value)
				for (const listener of this._listeners) {
					listener(value)
				}
			}
		} catch (e) {
			this.onError(e)
		} finally {
			this._isEnded = true
			for (const listener of this._listeners) {
				listener(null as any)
			}
		}
	}

	listen(listener: (value: T) => void) {
		this._listeners.add(listener)
		for (const value of this._buffer) {
			listener(value)
		}
		if (this._isEnded) {
			listener(null as any)
		}
	}

	async *tee(): AsyncGenerator<T> {
		try {
			let i = 0
			while (i < this._buffer.length) {
				yield this._buffer[i++]
			}
			while (!this._isEnded) {
				let resolve: (value: any) => void
				const promise = new Promise<T>((res) => {
					resolve = res
					this._listeners.add(resolve!)
				})
				await promise
				this._listeners.delete(resolve!)

				// Possible timing caused something to slip in between
				// timers so we iterate over the buffer
				while (i < this._buffer.length) {
					yield this._buffer[i++]
				}
			}
		} finally {
			// this._listeners.delete(resolve!);
		}
	}
}
