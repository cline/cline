export const TIMED_OUT: unique symbol = Symbol("timed out");

/**
 * Races `work` against `ms`. On the deadline the work's signal aborts and
 * `TIMED_OUT` resolves; the work's late result or failure is ignored.
 */
export async function withDeadline<T>(
	work: (signal: AbortSignal) => Promise<T> | T,
	ms: number,
): Promise<T | typeof TIMED_OUT> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve(TIMED_OUT);
		}, ms);
	});
	const pending = Promise.resolve().then(() => work(controller.signal));
	pending.catch(() => undefined);
	try {
		return await Promise.race([pending, deadline]);
	} finally {
		clearTimeout(timer);
	}
}

/** Resolves with `onTimeout` when the work throws or outlasts the budget. */
export function withinBudget<T>(
	work: () => Promise<T> | T,
	budgetMs: number,
	onTimeout: T,
): Promise<T> {
	return withDeadline(work, budgetMs).then(
		(value) => (value === TIMED_OUT ? onTimeout : value),
		() => onTimeout,
	);
}

/** Rejects, naming `what`, when the work outlasts `ms`. */
export async function rejectAfter<T>(
	work: Promise<T>,
	ms: number,
	what: string,
): Promise<T> {
	const value = await withDeadline(() => work, ms);
	if (value === TIMED_OUT) throw new Error(`${what} took longer than ${ms} ms`);
	return value;
}
