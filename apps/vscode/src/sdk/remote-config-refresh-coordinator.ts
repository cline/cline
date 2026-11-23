export class RemoteConfigRefreshCoordinator<Result = void> {
	private generation = 0
	private inFlight?: { identity: string; promise: Promise<Result> }

	constructor(private readonly performRefresh: (isCurrent: () => boolean) => Promise<Result>) {}

	refresh(identity: string, options: { force?: boolean } = {}): Promise<Result> {
		// force: callers that just mutated refresh inputs (toggles, opt-out) must
		// not coalesce onto an in-flight run that already sampled the old values.
		if (!options.force && this.inFlight?.identity === identity) {
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

	/**
	 * Marks any in-flight refresh stale without starting a new one. Used by
	 * authoritative local clears (sign-out) so a refresh that already fetched
	 * under the old identity cannot republish the state being cleared.
	 */
	invalidate(): void {
		this.generation += 1
		this.inFlight = undefined
	}
}
