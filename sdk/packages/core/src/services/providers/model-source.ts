/**
 * A model advertised by a provider's model-list endpoint. Provider catalogs
 * commonly include limits next to the id (OpenAI `context_length`, vLLM,
 * LM Studio, etc.); keeping them avoids dropping back to a 128K default.
 */
export interface ModelSourceEntry {
	id: string;
	name?: string;
	contextWindow?: number;
	maxInputTokens?: number;
	maxTokens?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function firstPositiveInteger(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			return Math.trunc(value);
		}
	}
	return undefined;
}

function toModelSourceEntry(item: unknown): ModelSourceEntry | undefined {
	if (typeof item === "string") {
		const id = item.trim();
		return id ? { id } : undefined;
	}
	const entry = asRecord(item);
	if (!entry) return undefined;
	const id = firstString(entry.id, entry.name, entry.model);
	if (!id) return undefined;
	const contextWindow = firstPositiveInteger(
		entry.context_length,
		entry.context_window,
		entry.max_context_length,
		entry.contextLength,
		entry.contextWindow,
		entry.maxContextLength,
	);
	return {
		id,
		name: firstString(entry.name),
		contextWindow,
		maxInputTokens:
			firstPositiveInteger(entry.max_input_tokens, entry.maxInputTokens) ??
			contextWindow,
		maxTokens: firstPositiveInteger(
			entry.max_output_tokens,
			entry.max_completion_tokens,
			entry.maxOutputTokens,
			entry.maxCompletionTokens,
		),
	};
}

function parseModelEntryList(input: unknown): ModelSourceEntry[] {
	if (!Array.isArray(input)) return [];
	return input.flatMap((item) => {
		const entry = toModelSourceEntry(item);
		return entry ? [entry] : [];
	});
}

/** Map-shaped catalogs (`{ "model-id": { ...metadata } }`) keyed by model id. */
function parseModelEntryMap(input: unknown): ModelSourceEntry[] {
	const map = asRecord(input);
	if (!map) return [];
	return Object.entries(map).flatMap(([id, value]) => {
		const trimmedId = id.trim();
		if (!trimmedId) return [];
		const entry = toModelSourceEntry({ ...asRecord(value), id: trimmedId });
		return entry ? [entry] : [];
	});
}

export function extractModelEntriesFromPayload(
	payload: unknown,
	providerId: string,
): ModelSourceEntry[] {
	const rootArray = parseModelEntryList(payload);
	if (rootArray.length > 0) return rootArray;
	if (!payload || typeof payload !== "object") return [];

	const data = payload as {
		data?: unknown;
		models?: unknown;
		providers?: Record<string, unknown>;
	};

	const direct = parseModelEntryList(data.data ?? data.models);
	if (direct.length > 0) return direct;

	const models = parseModelEntryMap(data.models);
	if (models.length > 0) return models;

	const scoped = data.providers?.[providerId];
	if (scoped && typeof scoped === "object") {
		const nested = (scoped as { models?: unknown }).models ?? scoped;
		const list = Array.isArray(nested)
			? parseModelEntryList(nested)
			: parseModelEntryMap(nested);
		if (list.length > 0) return list;
	}

	return [];
}

export function extractModelIdsFromPayload(
	payload: unknown,
	providerId: string,
): string[] {
	return extractModelEntriesFromPayload(payload, providerId).map(
		(entry) => entry.id,
	);
}

export interface ModelSourceAuth {
	baseUrl?: string;
	apiKey?: string;
	headers?: Record<string, string>;
}

export async function fetchModelEntriesFromSource(
	url: string,
	providerId: string,
	auth: ModelSourceAuth = {},
): Promise<ModelSourceEntry[]> {
	// A model source may be a third-party public catalog. Only send provider
	// credentials to its own origin, and do not follow authenticated redirects.
	const headers = new Headers();
	let sameOrigin = false;
	try {
		sameOrigin =
			!!auth.baseUrl && new URL(url).origin === new URL(auth.baseUrl).origin;
	} catch {
		// An invalid API endpoint cannot establish trust, but should not prevent
		// an independent public catalog from loading without credentials.
	}
	if (sameOrigin) {
		if (auth.apiKey?.trim()) {
			headers.set("Authorization", `Bearer ${auth.apiKey.trim()}`);
		}
		for (const [name, value] of Object.entries(auth.headers ?? {})) {
			headers.set(name, value);
		}
	}
	let hasHeaders = false;
	headers.forEach(() => {
		hasHeaders = true;
	});
	const response = await fetch(url, {
		method: "GET",
		...(hasHeaders ? { headers, redirect: "error" as const } : {}),
		signal: AbortSignal.timeout(5_000),
	});
	if (!response.ok) {
		throw new Error(
			`failed to fetch models from ${url}: HTTP ${response.status}`,
		);
	}
	return extractModelEntriesFromPayload(
		(await response.json()) as unknown,
		providerId,
	);
}

export async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
	auth: ModelSourceAuth = {},
): Promise<string[]> {
	const entries = await fetchModelEntriesFromSource(url, providerId, auth);
	return entries.map((entry) => entry.id);
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

export function resolveModelsSourceUrl(
	baseUrl: string | undefined,
	defaultBaseUrl: string | undefined,
	modelsSourceUrl: string | undefined,
): string | undefined {
	const source = modelsSourceUrl?.trim();
	if (!source) return undefined;
	const configuredBase = baseUrl?.trim();
	if (!configuredBase || !defaultBaseUrl?.trim()) return source;

	try {
		const sourceUrl = new URL(source);
		const defaultBase = new URL(defaultBaseUrl);
		const configured = new URL(configuredBase);
		if (sourceUrl.origin !== defaultBase.origin) return source;

		const defaultPath = trimTrailingSlash(defaultBase.pathname);
		const configuredPath = trimTrailingSlash(configured.pathname);
		if (defaultPath && sourceUrl.pathname.startsWith(`${defaultPath}/`)) {
			const suffix = sourceUrl.pathname.slice(defaultPath.length);
			configured.pathname = `${configuredPath}${suffix}`;
		} else {
			configured.pathname = sourceUrl.pathname;
		}
		configured.search = sourceUrl.search;
		configured.hash = sourceUrl.hash;
		return configured.toString();
	} catch {
		return source;
	}
}
