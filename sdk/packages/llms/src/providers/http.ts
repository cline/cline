import type { GatewayProviderSettings } from "@cline/shared";

export function ensureFetch(fetchImpl?: typeof fetch): typeof fetch {
	const resolved = fetchImpl ?? globalThis.fetch;
	if (!resolved) {
		throw new Error(
			"No fetch implementation is available. Pass one in the gateway or provider config.",
		);
	}
	return resolved;
}

type FetchWithOptionalPreconnect = typeof fetch & {
	preconnect?: (...args: unknown[]) => unknown;
};

function isBunRuntime(): boolean {
	return typeof globalThis.process?.versions?.bun === "string";
}

/**
 * Turn off the runtime's built-in fetch idle timeout for model requests.
 *
 * Bun's `fetch` aborts with `TimeoutError: The operation timed out.` after 5
 * minutes without socket activity, before headers or mid-body. Long-thinking
 * models legitimately stay silent for longer than that (Google documents read
 * timeouts of 15 to 20 minutes for Gemini long decode), so the runtime limit
 * kills healthy requests. Callers must bound stalls themselves: text streams
 * use {@link withResponseStartTimeout} until the response opens and the
 * stream timeout passed to `streamText` after that (see
 * `resolveModelStreamTimeout`). Cancellation still flows through the
 * request's abort signal.
 *
 * `timeout` is a Bun-only `RequestInit` extension, so other runtimes keep
 * their fetch untouched. The base fetch is resolved per call so a global
 * `fetch` replaced after construction is still honored.
 */
export function withoutFetchIdleTimeout(
	fetchImpl: typeof fetch | undefined,
	enabled: boolean = isBunRuntime(),
): typeof fetch | undefined {
	if (!enabled) {
		return fetchImpl;
	}
	const resolveDelegate = () => fetchImpl ?? globalThis.fetch;
	const wrapped = ((input, init) =>
		resolveDelegate()(input, {
			...init,
			timeout: false,
		} as RequestInit)) as FetchWithOptionalPreconnect;
	const delegate = resolveDelegate() as FetchWithOptionalPreconnect | undefined;
	if (typeof delegate?.preconnect === "function") {
		wrapped.preconnect = delegate.preconnect.bind(delegate);
	}
	return wrapped;
}

/**
 * Bound the wait for response headers. The stream timeout passed to
 * `streamText` only starts once a response opens, so without this a server
 * that accepts a request and never answers would hang once the runtime's own
 * idle timeout is off. The timer is cleared as soon as headers arrive; the
 * body is bounded by the stream's chunk timeouts. Raises a native
 * `TimeoutError`, which the turn retry treats as transient.
 *
 * Applied only where {@link withoutFetchIdleTimeout} removed the runtime's
 * limit (Bun); other runtimes keep their own header timeout and an untouched
 * fetch.
 */
export function withResponseStartTimeout(
	fetchImpl: typeof fetch | undefined,
	timeoutMs: number,
	enabled: boolean = isBunRuntime(),
): typeof fetch | undefined {
	if (!enabled) {
		return fetchImpl;
	}
	const wrapped = (async (input, init) => {
		const timeoutController = new AbortController();
		const timer = setTimeout(
			() =>
				timeoutController.abort(
					new DOMException(
						`Model request timed out: no response within ${timeoutMs}ms`,
						"TimeoutError",
					),
				),
			timeoutMs,
		);
		const upstreamSignal = init?.signal;
		const signal = upstreamSignal
			? AbortSignal.any([upstreamSignal, timeoutController.signal])
			: timeoutController.signal;
		try {
			return await ensureFetch(fetchImpl)(input, { ...init, signal });
		} finally {
			clearTimeout(timer);
		}
	}) as FetchWithOptionalPreconnect;
	const delegate = (fetchImpl ?? globalThis.fetch) as
		| FetchWithOptionalPreconnect
		| undefined;
	if (typeof delegate?.preconnect === "function") {
		wrapped.preconnect = delegate.preconnect.bind(delegate);
	}
	return wrapped;
}

/** Default limit on model-stream silence before a request is abandoned. */
export const DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS = 20 * 60_000;

/** Overrides the model-stream idle limit in milliseconds; `0` disables it. */
export const MODEL_STREAM_IDLE_TIMEOUT_ENV =
	"CLINE_MODEL_STREAM_IDLE_TIMEOUT_MS";

/**
 * Stall limits for a model stream: how long to wait for the first content
 * chunk, and for each chunk after it. Together with
 * {@link withResponseStartTimeout} this replaces the runtime fetch idle
 * timeout disabled by {@link withoutFetchIdleTimeout}, so a dead connection
 * still ends the request. Returns `undefined` when disabled.
 */
export function resolveModelStreamTimeout():
	| { firstChunkMs: number; chunkMs: number }
	| undefined {
	const raw = readEnv(MODEL_STREAM_IDLE_TIMEOUT_ENV);
	const parsed = raw === undefined ? Number.NaN : Number(raw);
	const idleMs =
		Number.isFinite(parsed) && parsed >= 0
			? Math.floor(parsed)
			: DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS;
	return idleMs > 0 ? { firstChunkMs: idleMs, chunkMs: idleMs } : undefined;
}

export async function resolveApiKey(
	settings: GatewayProviderSettings,
): Promise<string | undefined> {
	const explicitApiKey = settings.apiKey?.trim();
	if (explicitApiKey) {
		return explicitApiKey;
	}

	const resolvedApiKey = await settings.apiKeyResolver?.();
	const trimmedResolvedApiKey = resolvedApiKey?.trim();
	if (trimmedResolvedApiKey) {
		return trimmedResolvedApiKey;
	}

	for (const key of settings.apiKeyEnv ?? []) {
		const value = readEnv(key);
		if (value) {
			return value;
		}
	}

	return undefined;
}

export async function fetchJson(
	url: string,
	init: RequestInit,
	options: {
		fetch: typeof fetch;
		timeoutMs?: number;
		signal?: AbortSignal;
	},
): Promise<unknown> {
	const controller = new AbortController();
	const signal = mergeSignals(options.signal, controller.signal);
	const timeoutMs = options.timeoutMs ?? 30_000;
	const timeout =
		timeoutMs > 0
			? setTimeout(
					() => controller.abort(new Error("Request timed out")),
					timeoutMs,
				)
			: undefined;

	try {
		const response = await options.fetch(url, { ...init, signal });
		const text = await response.text();
		const payload = text ? (JSON.parse(text) as unknown) : undefined;

		if (!response.ok) {
			const message =
				typeof payload === "object" && payload && "error" in payload
					? JSON.stringify((payload as { error: unknown }).error)
					: text || `${response.status} ${response.statusText}`;
			throw new Error(`Gateway request failed: ${message}`);
		}

		return payload;
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

function mergeSignals(
	first: AbortSignal | undefined,
	second: AbortSignal,
): AbortSignal {
	if (!first) {
		return second;
	}

	if (first.aborted) {
		second.throwIfAborted?.();
		return first;
	}

	const controller = new AbortController();
	const abort = (event?: Event) => {
		const target = event?.target as AbortSignal | null;
		controller.abort(target?.reason);
	};

	first.addEventListener("abort", abort, { once: true });
	second.addEventListener("abort", abort, { once: true });
	return controller.signal;
}

export function compactObject<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}

function readEnv(key: string): string | undefined {
	const env = globalThis.process?.env;
	if (!env) {
		return undefined;
	}

	const value = env[key];
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
