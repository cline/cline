import type { AgentEvent } from "@cline/shared";

/** Observed execution progress, not an idle/busy state or a retention decision. */
export class SessionActivity {
	private timer?: ReturnType<typeof setTimeout>;
	private writes = Promise.resolve();
	private persistedAt: number | null;

	constructor(
		public lastObservedAt: number | null,
		private readonly persist: (at: number) => Promise<void>,
		private readonly onError: (error: unknown) => void,
	) {
		this.persistedAt = lastObservedAt;
	}

	observe(event: AgentEvent): void {
		if (
			event.type === "iteration_start" ||
			event.type === "content_start" ||
			event.type === "content_update" ||
			event.type === "content_end"
		) {
			this.lastObservedAt = Math.max(this.lastObservedAt ?? 0, Date.now());
			this.timer ??= setTimeout(() => void this.flush(), 60_000);
			this.timer.unref();
		}
		if (event.type === "done" || event.type === "error") void this.flush();
	}

	flush(): Promise<void> {
		clearTimeout(this.timer);
		this.timer = undefined;
		const at = this.lastObservedAt;
		if (at === null) return this.writes;
		// Capture observation time before asynchronous persistence; never stamp flush time.
		this.writes = this.writes
			.then(async () => {
				if (at <= (this.persistedAt ?? -1)) return;
				await this.persist(at);
				this.persistedAt = at;
			})
			.catch(this.onError);
		return this.writes;
	}
}
