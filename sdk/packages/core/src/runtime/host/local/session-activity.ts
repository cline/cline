import type { AgentEvent } from "@cline/shared";

/** Observed execution progress, not an idle/busy state or a retention decision. */
export class SessionActivity {
	private timer?: ReturnType<typeof setTimeout>;
	private writes = Promise.resolve();
	private persistedAt: number | null;

	constructor(
		public lastAgentActivityAt: number | null,
		private readonly persist: (at: number) => Promise<void>,
		private readonly onError: (error: unknown) => void,
	) {
		this.persistedAt = lastAgentActivityAt;
	}

	observe(event: AgentEvent): void {
		if (
			event.type === "iteration_start" ||
			event.type === "content_start" ||
			event.type === "content_update" ||
			event.type === "content_end"
		) {
			this.lastAgentActivityAt = Math.max(
				this.lastAgentActivityAt ?? 0,
				Date.now(),
			);
			this.timer ??= setTimeout(() => void this.flush(), 60_000);
			this.timer.unref();
		}
		if (event.type === "done" || event.type === "error") void this.flush();
	}

	flush(): Promise<void> {
		clearTimeout(this.timer);
		this.timer = undefined;
		const at = this.lastAgentActivityAt;
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
