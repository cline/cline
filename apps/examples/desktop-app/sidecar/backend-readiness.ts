const MAX_AUTOMATIC_ATTEMPTS = 4;

/** The desktop transport is independent of this local session-service lifecycle. */
export type BackendReadiness = {
	state: "starting" | "ready" | "failed";
	attempt: number;
	message?: string;
};

export class BackendReadinessError extends Error {
	readonly code = "SESSION_SERVICE_NOT_READY";
	constructor(readonly readiness: BackendReadiness) {
		super(readiness.message ?? "Starting session service…");
	}
}

export class BackendInitialization {
	state: BackendReadiness = { state: "starting", attempt: 0 };
	private pending?: Promise<void>;
	private queuedRetry?: Promise<void>;
	private controller?: AbortController;
	private stopped = false;
	private retryAt = 0;
	private retryTimer?: ReturnType<typeof setTimeout>;

	constructor(
		private readonly initialize: (signal: AbortSignal) => Promise<void>,
		private readonly publish: (state: BackendReadiness) => void,
		private readonly timeoutMs = 30_000,
	) {}

	private update(state: BackendReadiness): void {
		this.state = state;
		this.publish(state);
	}

	start(): Promise<void> {
		if (this.stopped || this.state.state === "ready") return Promise.resolve();
		if (this.queuedRetry) return this.queuedRetry;
		if (this.pending) {
			if (this.state.state !== "failed") return this.pending;
			// A timeout can publish failure before partial-client cleanup settles.
			// Remember the user's retry without overlapping initialization attempts.
			this.queuedRetry = this.pending.then(() => {
				this.queuedRetry = undefined;
				return this.start();
			});
			return this.queuedRetry;
		}
		clearTimeout(this.retryTimer);
		this.retryTimer = undefined;
		const controller = new AbortController();
		this.controller = controller;
		const attempt = this.state.attempt + 1;
		this.update({ state: "starting", attempt });
		this.pending = (async () => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const delay = Math.max(0, this.retryAt - Date.now());
				if (delay)
					await new Promise<void>((resolve, reject) => {
						const abort = () => {
							clearTimeout(wait);
							reject(controller.signal.reason);
						};
						const wait = setTimeout(() => {
							controller.signal.removeEventListener("abort", abort);
							resolve();
						}, delay);
						controller.signal.addEventListener("abort", abort, { once: true });
					});
				controller.signal.throwIfAborted();
				timer = setTimeout(() => {
					controller.abort(
						new Error("Session service startup timed out. Retry to reconnect."),
					);
					if (!this.stopped)
						this.update({
							state: "failed",
							attempt,
							message:
								attempt < MAX_AUTOMATIC_ATTEMPTS
									? "Session service startup timed out. Retrying automatically..."
									: "Session service startup timed out. Retry to reconnect.",
						});
				}, this.timeoutMs);
				await this.initialize(controller.signal);
				controller.signal.throwIfAborted();
				if (!this.stopped) this.update({ state: "ready", attempt });
			} catch {
				// Bootstrap errors can contain authenticated URLs or provider secrets.
				// Publish a fixed actionable message rather than arbitrary error text.
				if (!this.stopped && this.state.state !== "failed")
					this.update({
						state: "failed",
						attempt,
						message:
							attempt < MAX_AUTOMATIC_ATTEMPTS
								? "Unable to start the session service. Retrying automatically..."
								: "Unable to start the session service. Retry to reconnect; export diagnostics if the problem persists.",
					});
				this.retryAt =
					Date.now() + Math.min(1_000 * 2 ** Math.min(attempt - 1, 5), 30_000);
			} finally {
				clearTimeout(timer);
			}
		})().finally(() => {
			this.pending = undefined;
			if (
				!this.stopped &&
				!this.queuedRetry &&
				this.state.state === "failed" &&
				attempt < MAX_AUTOMATIC_ATTEMPTS
			) {
				this.retryTimer = setTimeout(
					() => {
						this.retryTimer = undefined;
						void this.start();
					},
					Math.max(0, this.retryAt - Date.now()),
				);
			}
		});
		return this.pending;
	}

	stop(): void {
		this.stopped = true;
		clearTimeout(this.retryTimer);
		this.retryTimer = undefined;
		this.controller?.abort(new Error("Desktop sidecar is shutting down"));
	}
}
