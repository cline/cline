export class RemoteConfigRefreshCoordinator<Result = void> {
	private generation = 0
	private inFlight?: { identity: string; promise: Promise<Result> }

	constructor(private readonly performRefresh: (isCurrent: () => boolean) => Promise<Result>) {}

	refresh(identity: string): Promise<Result> {
		if (this.inFlight?.identity === identity) {
			return this.inFlight.promise
		}

		const generation = ++this.generation
		const promise = this.performRefresh(() => generation === this.generation).finally(() => {
			if (this.inFlight?.promise === promise) {
				this.inFlight = undefined
			}
		})
		this.inFlight = { identity, promise }
		return promise
	}
}
