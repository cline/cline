export interface TrialOptions {
	dryRun: boolean;
	/** Epoch milliseconds after which the trial counts as timed out. */
	deadline: number;
	/** Ctrl-C. */
	signal: AbortSignal;
	/**
	 * Reviewer pool sizes for the scoped card. Unset: the pool a card filed
	 * with no workflow gets (no plan reviewer, one final reviewer).
	 */
	reviewPool?: { planReviewers: number; reviewers: number };
}

export type Ended<T> =
	| { status: "settled"; value: T }
	| { status: "timeout" | "aborted"; value?: undefined };

/** Waits for `work`, or until the trial's deadline or Ctrl-C. */
export function race<T>(
	work: Promise<T>,
	options: TrialOptions,
): Promise<Ended<T>> {
	return new Promise((resolve, reject) => {
		const finish = (ended: Ended<T>) => {
			clearTimeout(timer);
			options.signal.removeEventListener("abort", onAbort);
			resolve(ended);
		};
		const onAbort = () => finish({ status: "aborted" });
		const timer = setTimeout(
			() => finish({ status: "timeout" }),
			Math.max(0, options.deadline - Date.now()),
		);
		if (options.signal.aborted) return onAbort();
		options.signal.addEventListener("abort", onAbort, { once: true });
		work.then(
			(value) => finish({ status: "settled", value }),
			(error) => {
				clearTimeout(timer);
				options.signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

/** Polls until `check` returns a value, or until the deadline or Ctrl-C. */
export async function settle<T>(
	check: () => Promise<T | undefined>,
	options: TrialOptions,
	intervalMs = 500,
): Promise<Ended<T>> {
	const poll = async (): Promise<T> => {
		for (;;) {
			const value = await check();
			if (value !== undefined) return value;
			if (options.signal.aborted || Date.now() >= options.deadline)
				return new Promise<T>(() => {});
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}
	};
	return race(poll(), options);
}
