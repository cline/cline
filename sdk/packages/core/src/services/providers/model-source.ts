export interface ModelSourceEntry {
	id: string;
	/**
	 * `context_length` reported by the source payload, when present. Model
	 * catalogs built from these entries would otherwise fall back to the
	 * 128K default input budget, and auto-compaction would trigger far below
	 * what the backend actually accepts.
	 */
	contextLength?: number;
	/** `max_completion_tokens` reported by the source payload, when present. */
	maxCompletionTokens?: number;
}

function parseOptionalCount(value: unknown): number | undefined {
	if (typeof value !== "number" && typeof value !== "string") {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Collapse entries that share an id, keeping the first position and the first
 * defined limit per field. Sources occasionally repeat an id (a bare entry
 * after a full record, or a provider overlap); a repeat without limits must
 * not erase a budget the same payload already reported.
 */
export function mergeModelEntries(
	entries: ModelSourceEntry[],
): ModelSourceEntry[] {
	const byId = new Map<string, ModelSourceEntry>();
	for (const entry of entries) {
		const existing = byId.get(entry.id);
		byId.set(
			entry.id,
			existing
				? {
						id: entry.id,
						contextLength: existing.contextLength ?? entry.contextLength,
						maxCompletionTokens:
							existing.maxCompletionTokens ?? entry.maxCompletionTokens,
					}
				: entry,
		);
	}
	return [...byId.values()];
}

function parseModelRecordMap(
	input: Record<string, unknown>,
): ModelSourceEntry[] {
	return Object.entries(input)
		.filter(([key]) => key.trim().length > 0)
		.map(([key, value]) => {
			const record =
				value && typeof value === "object" && !Array.isArray(value)
					? (value as {
							context_length?: unknown;
							max_completion_tokens?: unknown;
						})
					: undefined;
			return {
				id: key.trim(),
				contextLength: parseOptionalCount(record?.context_length),
				maxCompletionTokens: parseOptionalCount(record?.max_completion_tokens),
			};
		});
}

function parseModelIdList(input: unknown): ModelSourceEntry[] {
	if (!Array.isArray(input)) return [];
	return input
		.map((item) => {
			if (typeof item === "string") return { id: item.trim() };
			if (item && typeof item === "object") {
				const entry = item as {
					id?: unknown;
					name?: unknown;
					model?: unknown;
					context_length?: unknown;
					max_completion_tokens?: unknown;
				};
				for (const value of [entry.id, entry.name, entry.model]) {
					if (typeof value === "string" && value.trim()) {
						return {
							id: value.trim(),
							contextLength: parseOptionalCount(entry.context_length),
							maxCompletionTokens: parseOptionalCount(
								entry.max_completion_tokens,
							),
						};
					}
				}
			}
			return { id: "" };
		})
		.filter((entry) => entry.id.length > 0);
}

export function extractModelEntriesFromPayload(
	payload: unknown,
	providerId: string,
): ModelSourceEntry[] {
	const rootArray = parseModelIdList(payload);
	if (rootArray.length > 0) return rootArray;
	if (!payload || typeof payload !== "object") return [];

	const data = payload as {
		data?: unknown;
		models?: unknown;
		providers?: Record<string, unknown>;
	};

	const direct = parseModelIdList(data.data ?? data.models);
	if (direct.length > 0) return direct;

	if (
		data.models &&
		typeof data.models === "object" &&
		!Array.isArray(data.models)
	) {
		const entries = parseModelRecordMap(data.models as Record<string, unknown>);
		if (entries.length > 0) return entries;
	}

	const scoped = data.providers?.[providerId];
	if (scoped && typeof scoped === "object") {
		// The scoped entry itself can be a bare array of ids.
		if (Array.isArray(scoped)) {
			const list = parseModelIdList(scoped);
			if (list.length > 0) return list;
		} else {
			const nested = scoped as { models?: unknown };
			if (Array.isArray(nested.models)) {
				const list = parseModelIdList(nested.models);
				if (list.length > 0) return list;
			}
			if (
				nested.models &&
				typeof nested.models === "object" &&
				!Array.isArray(nested.models)
			) {
				const entries = parseModelRecordMap(
					nested.models as Record<string, unknown>,
				);
				if (entries.length > 0) return entries;
			}
		}
	}

	return [];
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
