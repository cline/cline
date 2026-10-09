/** Stop waiting without leaving an abort listener on a long-lived signal. */
export function waitForAbortable<T>(
	work: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) return work;
	return new Promise<T>((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(signal.reason);
		};
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
		void work.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
	});
}
