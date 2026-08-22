/**
 * A model discovered from a provider's public model source, keeping whatever
 * metadata the payload carried. Local OpenAI-compatible sources (LM Studio)
 * report the loaded model's context length per entry; surfacing it means the
 * chat indicator and auto-compaction budget against the window the server
 * actually applies instead of a generic safe default (#13457).
 */
export interface PublicModelEntry {
	id: string;
	contextWindow?: number;
}

const CONTEXT_WINDOW_KEYS = [
	"max_context_length",
	"max_model_len",
	"context_length",
] as const;

function readEntryContextWindow(entry: object): number | undefined {
	const record = entry as Record<string, unknown>;
	for (const key of CONTEXT_WINDOW_KEYS) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			return Math.floor(value);
		}
	}
	return undefined;
}

function parseModelEntryList(input: unknown): PublicModelEntry[] {
	if (!Array.isArray(input)) return [];
	return input
		.map((item) => {
			if (typeof item === "string") {
				const id = item.trim();
				return id ? { id } : undefined;
			}
			if (item && typeof item === "object") {
				const entry = item as { id?: unknown; name?: unknown; model?: unknown };
				for (const value of [entry.id, entry.name, entry.model]) {
					if (typeof value === "string" && value.trim()) {
						return {
							id: value.trim(),
							contextWindow: readEntryContextWindow(item),
						};
					}
				}
			}
			return undefined;
		})
		.filter((entry): entry is PublicModelEntry => entry !== undefined);
}

export function extractModelEntriesFromPayload(
	payload: unknown,
	providerId: string,
): PublicModelEntry[] {
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

	if (
		data.models &&
		typeof data.models === "object" &&
		!Array.isArray(data.models)
	) {
		const keys = Object.keys(data.models).filter((k) => k.trim().length > 0);
		if (keys.length > 0) {
			return keys.map((id) => ({ id }));
		}
	}

	const scoped = data.providers?.[providerId];
	if (scoped && typeof scoped === "object") {
		const nested = scoped as { models?: unknown };
		const list = parseModelEntryList(nested.models ?? scoped);
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

export async function fetchModelEntriesFromSource(
	url: string,
	providerId: string,
): Promise<PublicModelEntry[]> {
	const response = await fetch(url, { method: "GET" });
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
): Promise<string[]> {
	const entries = await fetchModelEntriesFromSource(url, providerId);
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
