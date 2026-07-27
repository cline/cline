import type { GatewayProviderSettings } from "@cline/shared";

/**
 * Time to wait for a provider's response to start when the provider config
 * does not set an explicit `timeoutMs`. Bounds only the time until response
 * headers arrive — streaming the body is never interrupted.
 *
 * Without this bound, a provider that accepts the connection but never
 * responds leaves the request (and the UI) hanging until runtime socket
 * limits fire, which can take 15+ minutes with silent retries in between.
 */
export const DEFAULT_RESPONSE_START_TIMEOUT_MS = 60_000;

type FetchWithOptionalPreconnect = typeof fetch & {
	preconnect?: (...args: unknown[]) => unknown;
};

/**
 * Read the configured request timeout, falling back to the given default
 * when the config leaves it unset (zero/invalid values also fall back).
 */
export function readResponseStartTimeoutMs(
	settings: GatewayProviderSettings,
	defaultTimeoutMs: number = DEFAULT_RESPONSE_START_TIMEOUT_MS,
): number {
	const timeoutMs = settings.timeoutMs;
	if (
		typeof timeoutMs === "number" &&
		Number.isFinite(timeoutMs) &&
		timeoutMs > 0
	) {
		return Math.floor(timeoutMs);
	}
	return defaultTimeoutMs;
}

/**
 * Wrap a fetch so the *response* must start within `timeoutMs`. Once headers
 * arrive the timer is cleared — streaming the body is never interrupted.
 * Mirrors the legacy Ollama handler, which raced the chat call (stream
 * start) against a timeout rather than bounding the whole generation.
 */
export function withResponseStartTimeout(
	baseFetch: typeof fetch,
	timeoutMs: number,
	label = "Provider",
): typeof fetch {
	const timedFetch = (async (input, init) => {
		const timeoutController = new AbortController();
		const timer = setTimeout(() => {
			const reason = new Error(
				`${label} request timed out after ${timeoutMs / 1000} seconds waiting for the response to start. The provider accepted the request but never responded — check that the endpoint is reachable and healthy.`,
			);
			// "TimeoutError" makes the AI SDK treat the abort as terminal
			// (isAbortError) instead of wrapping it in a retryable network
			// error, so a dead provider fails fast with this message instead
			// of being retried silently.
			reason.name = "TimeoutError";
			timeoutController.abort(reason);
		}, timeoutMs);
		// AbortSignal.any keeps upstream cancellation live for the entire
		// request (including body streaming after the timer is cleared) and
		// cleans up its own listeners — no manual listener management.
		const upstreamSignal = init?.signal;
		const signal = upstreamSignal
			? AbortSignal.any([upstreamSignal, timeoutController.signal])
			: timeoutController.signal;
		try {
			return await baseFetch(input, { ...init, signal });
		} finally {
			clearTimeout(timer);
		}
	}) as FetchWithOptionalPreconnect;
	const baseWithPreconnect = baseFetch as FetchWithOptionalPreconnect;
	if (typeof baseWithPreconnect.preconnect === "function") {
		timedFetch.preconnect = baseWithPreconnect.preconnect.bind(baseFetch);
	}
	return timedFetch;
}

export function ensureFetch(fetchImpl?: typeof fetch): typeof fetch {
	const resolved = fetchImpl ?? globalThis.fetch;
	if (!resolved) {
		throw new Error(
			"No fetch implementation is available. Pass one in the gateway or provider config.",
		);
	}
	return resolved;
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
