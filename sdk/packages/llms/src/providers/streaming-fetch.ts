/** Transport deadlines for self-hosted OpenAI/Ollama inference streams. */
export const DEFAULT_INFERENCE_TIMEOUT_MS = 30 * 60_000;

export function readInferenceTimeoutMs(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 1
		? Math.floor(value)
		: DEFAULT_INFERENCE_TIMEOUT_MS;
}

/**
 * Bound response startup and subsequent inactivity, rather than the total
 * generation time. Count raw bytes so SSE comments also keep a stream alive.
 * Bun's native five-minute socket deadline must not silently cap this budget.
 */
export function withInferenceTimeout(
	baseFetch: typeof fetch,
	timeoutMs: number,
	label: string,
): typeof fetch {
	const wrapped = (async (input, init) => {
		const controller = new AbortController();
		const upstream =
			init?.signal ?? (input instanceof Request ? input.signal : undefined);
		const signal = upstream
			? AbortSignal.any([upstream, controller.signal])
			: controller.signal;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const clearTimer = () => {
			if (timer !== undefined) clearTimeout(timer);
		};
		const arm = (phase: string) => {
			clearTimer();
			timer = setTimeout(
				() =>
					controller.abort(
						new Error(
							`${label} timed out waiting for ${phase} after ${timeoutMs / 1000} seconds`,
						),
					),
				timeoutMs,
			);
		};
		signal.throwIfAborted();
		arm("response headers");
		let response: Response;
		try {
			// `timeout: false` is a Bun fetch extension; Node/browser fetch ignore
			// it. Keep our explicit deadlines and the caller's cancellation live.
			const requestInit: RequestInit & { timeout: false } = {
				...init,
				signal,
				timeout: false,
			};
			response = await baseFetch(input, requestInit);
		} catch (error) {
			clearTimer();
			throw error;
		}
		clearTimer();
		if (!response.body) return response;
		const reader = response.body.getReader();
		let closed = false;
		let onAbort: () => void;
		const cleanup = () => {
			closed = true;
			clearTimer();
			signal.removeEventListener("abort", onAbort);
		};
		const body = new ReadableStream<Uint8Array>({
			start(stream) {
				onAbort = () => {
					if (closed) return;
					cleanup();
					stream.error(signal.reason);
					void reader.cancel(signal.reason).catch(() => {});
				};
				signal.addEventListener("abort", onAbort, { once: true });
				if (signal.aborted) onAbort();
			},
			async pull(stream) {
				if (closed) return;
				arm("response data");
				try {
					const next = await reader.read();
					clearTimer();
					if (closed) return;
					if (next.done) {
						cleanup();
						stream.close();
					} else stream.enqueue(next.value);
				} catch (error) {
					if (!closed) {
						cleanup();
						stream.error(error);
					}
				}
			},
			cancel(reason) {
				cleanup();
				controller.abort(reason);
				return reader.cancel(reason);
			},
		});
		const result = new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
		Object.defineProperty(result, "url", { value: response.url });
		return result;
	}) as typeof fetch;
	const delegate = baseFetch as typeof fetch & {
		preconnect?: (...args: unknown[]) => unknown;
	};
	if (delegate.preconnect)
		Object.assign(wrapped, { preconnect: delegate.preconnect.bind(baseFetch) });
	return wrapped;
}
