import { trimTrailingSlashes } from "./url";

/** A model entry as reported by an OpenAI-compatible /models endpoint. */
export interface OpenAICompatibleModelEntry {
	id: string;
	contextWindow?: number;
}

interface OpenAICompatibleModelCacheEntry {
	at: number;
	models: OpenAICompatibleModelEntry[];
}

/** Re-query the live catalog after this long (per-process cache). */
const MODEL_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
/** Hard ceiling for a single catalog fetch. */
const MODEL_CATALOG_FETCH_TIMEOUT_MS = 5_000;

const modelCatalogCaches = new Map<string, OpenAICompatibleModelCacheEntry>();
const inFlightCatalogFetches = new Map<
	string,
	Promise<OpenAICompatibleModelEntry[]>
>();

/**
 * Normalize an OpenAI-style models-list payload. vLLM (and most
 * OpenAI-compatible servers) report the context window as
 * `max_model_len` on each model entry; other servers may omit it, in which
 * case no context window is inferred.
 */
export function normalizeModelCatalog(
	payload: unknown,
): OpenAICompatibleModelEntry[] {
	const data =
		payload && typeof payload === "object" && !Array.isArray(payload)
			? (payload as { data?: unknown }).data
			: Array.isArray(payload)
				? (payload as unknown[])
				: undefined;
	if (!Array.isArray(data)) {
		return [];
	}
	const models: OpenAICompatibleModelEntry[] = [];
	for (const raw of data) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			continue;
		}
		const entry = raw as { id?: unknown; max_model_len?: unknown };
		if (typeof entry.id !== "string" || entry.id.length === 0) {
			continue;
		}
		const contextWindow =
			typeof entry.max_model_len === "number" &&
			Number.isFinite(entry.max_model_len) &&
			entry.max_model_len > 0
				? Math.floor(entry.max_model_len)
				: undefined;
		models.push({ id: entry.id, contextWindow });
	}
	return models;
}

/**
 * Query `<baseUrl>/models` on an OpenAI-compatible endpoint (vLLM, LM Studio,
 * LiteLLM, ...) and cache the parsed catalog per base URL. Concurrent calls
 * share one in-flight fetch; results stay fresh for `MODEL_CATALOG_CACHE_TTL_MS`.
 */
export async function fetchOpenAICompatibleModels(
	baseUrl: string,
	fetchImpl: typeof fetch,
	signal?: AbortSignal,
): Promise<OpenAICompatibleModelEntry[]> {
	const cacheKey = trimTrailingSlashes(baseUrl);
	const pending = inFlightCatalogFetches.get(cacheKey);
	if (pending) {
		return pending;
	}

	const promise = (async () => {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(new Error("Model catalog fetch timed out")),
			MODEL_CATALOG_FETCH_TIMEOUT_MS,
		);
		if (signal) {
			if (signal.aborted) {
				controller.abort(signal.reason);
			} else {
				signal.addEventListener(
					"abort",
					() => controller.abort(signal.reason),
					{ once: true },
				);
			}
		}

		try {
			const response = await fetchImpl(`${cacheKey}/models`, {
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(
					`Model catalog request failed: HTTP ${response.status}`,
				);
			}
			const text = await response.text();
			let payload: unknown;
			try {
				payload = text ? (JSON.parse(text) as unknown) : undefined;
			} catch {
				return [];
			}
			const models = normalizeModelCatalog(payload);
			modelCatalogCaches.set(cacheKey, { at: Date.now(), models });
			return models;
		} finally {
			clearTimeout(timeout);
			inFlightCatalogFetches.delete(cacheKey);
		}
	})();

	inFlightCatalogFetches.set(cacheKey, promise);
	return promise;
}

/**
 * Resolve the context window for a single model id. Serves a cached catalog
 * while it is fresh; otherwise (re)fetches. Returns `undefined` when the
 * endpoint is down or does not report `max_model_len`.
 */
export async function resolveOpenAICompatibleContextWindow(
	baseUrl: string | undefined,
	modelId: string,
	fetchImpl: typeof fetch,
	signal?: AbortSignal,
): Promise<number | undefined> {
	if (!baseUrl || !modelId) {
		return undefined;
	}
	const cached = modelCatalogCaches.get(trimTrailingSlashes(baseUrl));
	const fresh = cached && Date.now() - cached.at < MODEL_CATALOG_CACHE_TTL_MS;
	let models: OpenAICompatibleModelEntry[];
	if (fresh && cached) {
		models = cached.models;
	} else {
		try {
			models = await fetchOpenAICompatibleModels(baseUrl, fetchImpl, signal);
		} catch {
			// The endpoint may be unreachable (server not up yet) or return
			// an unexpected payload. Treat detection as best-effort.
			return undefined;
		}
	}
	const match = models.find((model) => model.id === modelId);
	return match?.contextWindow;
}

/** Synchronous cache lookup for the gateway registry. */
export function getOpenAICompatibleModelFromCache(
	baseUrl: string | undefined,
	modelId: string,
): OpenAICompatibleModelEntry | undefined {
	if (!baseUrl || !modelId) {
		return undefined;
	}
	const cached = modelCatalogCaches.get(trimTrailingSlashes(baseUrl));
	if (!cached) {
		return undefined;
	}
	return cached.models.find((model) => model.id === modelId);
}

/** Test helper: clear the module-level caches. */
export function resetOpenAICompatibleModelCacheForTests(): void {
	modelCatalogCaches.clear();
	inFlightCatalogFetches.clear();
}
