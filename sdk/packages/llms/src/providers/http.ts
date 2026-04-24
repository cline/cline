import type {
	GatewayProviderSettings,
	GatewayResolvedProviderConfig,
} from "@clinebot/shared";
import { normalizeProviderId } from "./ids";

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

/**
 * Error message for OpenAI-compatible and similar providers when no credential
 * can be resolved (matches legacy `OpenAIBaseHandler.ensureClient()` behavior).
 */
export function getMissingApiKeyError(
	providerId: string,
	apiKeyEnv?: readonly string[],
): string {
	const normalized = normalizeProviderId(providerId);
	const keys = apiKeyEnv?.filter((k) => k.trim().length > 0) ?? [];
	const keysMessage =
		keys.length > 0 ? keys.join(", ") : "provider-specific API key env var";
	return `Missing API key for provider "${normalized}". Set apiKey explicitly or one of: ${keysMessage}.`;
}

export function hasAuthorizationHeader(
	headers?: Record<string, string>,
): boolean {
	if (!headers) {
		return false;
	}
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === "authorization" && String(value).trim()) {
			return true;
		}
	}
	return false;
}

/**
 * OpenAI-compatible local servers (LM Studio, Ollama) or explicit
 * Authorization headers may run without `apiKey` / env-based keys.
 */
export function allowsMissingOpenAiCompatibleApiKey(
	providerId: string,
	config: GatewayResolvedProviderConfig,
): boolean {
	if (hasAuthorizationHeader(config.headers)) {
		return true;
	}
	const normalizedProviderId = normalizeProviderId(providerId);
	return (
		normalizedProviderId === "lmstudio" || normalizedProviderId === "ollama"
	);
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
