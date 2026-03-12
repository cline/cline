type RequestBoundaryCacheOptions<T> = {
	load: () => Promise<T>
	ttlMs: number
	getNow?: () => number
}

export class RequestBoundaryCache<T> {
	private value: T | undefined
	private expiresAt = 0
	private inFlight: Promise<T> | undefined
	private readonly load: () => Promise<T>
	private readonly ttlMs: number
	private readonly getNow: () => number

	constructor(options: RequestBoundaryCacheOptions<T>) {
		this.load = options.load
		this.ttlMs = options.ttlMs
		this.getNow = options.getNow ?? (() => Date.now())
	}

	async get(): Promise<T> {
		const now = this.getNow()
		if (this.value !== undefined && now < this.expiresAt) {
			return this.value
		}

		if (!this.inFlight) {
			this.inFlight = this.load()
				.then((value) => {
					this.value = value
					this.expiresAt = this.getNow() + this.ttlMs
					return value
				})
				.finally(() => {
					this.inFlight = undefined
				})
		}

		return this.inFlight
	}

	clear(): void {
		this.value = undefined
		this.expiresAt = 0
	}
}
