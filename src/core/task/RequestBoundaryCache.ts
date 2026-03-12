type RequestBoundaryCacheOptions<T> = {
	load: () => Promise<T>
	ttlMs?: number
	getTtlMs?: () => number
	getNow?: () => number
}

export class RequestBoundaryCache<T> {
	private value: T | undefined
	private expiresAt = 0
	private inFlight: Promise<T> | undefined
	private readonly load: () => Promise<T>
	private readonly getNow: () => number
	private readonly getTtlMs: () => number

	constructor(options: RequestBoundaryCacheOptions<T>) {
		this.load = options.load
		this.getNow = options.getNow ?? (() => Date.now())
		this.getTtlMs = options.getTtlMs ?? (() => options.ttlMs ?? 0)
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
					this.expiresAt = this.getNow() + this.getTtlMs()
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
