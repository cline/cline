import * as Llms from "@cline/llms";

function parseModelIdList(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	return input
		.map((item) => {
			if (typeof item === "string") return item.trim();
			if (item && typeof item === "object") {
				const entry = item as { id?: unknown; name?: unknown; model?: unknown };
				for (const value of [entry.id, entry.name, entry.model]) {
					if (typeof value === "string" && value.trim()) {
						return value.trim();
					}
				}
			}
			return "";
		})
		.filter((id) => id.length > 0);
}

export function extractModelIdsFromPayload(
	payload: unknown,
	providerId: string,
): string[] {
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
		const keys = Object.keys(data.models).filter((k) => k.trim().length > 0);
		if (keys.length > 0) return keys;
	}

	const scoped = data.providers?.[providerId];
	if (scoped && typeof scoped === "object") {
		const nested = scoped as { models?: unknown };
		const list = parseModelIdList(nested.models ?? scoped);
		if (list.length > 0) return list;
	}

	return [];
}

export interface FetchModelIdsFromSourceOptions {
	/** Sent as `Authorization: Bearer <apiKey>` unless headers already set one. */
	apiKey?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
}

/**
 * Resolve the API key to authenticate a models-source request with:
 * the explicitly configured key, falling back to the provider's registered
 * environment variables (e.g. `LMSTUDIO_API_KEY`, `OLLAMA_API_KEY`).
 */
export function resolveModelsSourceApiKey(
	providerId: string,
	explicitApiKey?: string,
): string | undefined {
	const explicit = explicitApiKey?.trim();
	if (explicit) {
		return explicit;
	}
	const envKeys =
		(
			Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId] as
				| Llms.ModelCollection
				| undefined
		)?.provider.env ?? [];
	for (const key of envKeys) {
		const value = globalThis.process?.env?.[key]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}

const DEFAULT_MODELS_SOURCE_TIMEOUT_MS = 10_000;

export async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
	options: FetchModelIdsFromSourceOptions = {},
): Promise<string[]> {
	const headers: Record<string, string> = { ...options.headers };
	const hasAuthorizationHeader = Object.keys(headers).some(
		(key) => key.toLowerCase() === "authorization",
	);
	const apiKey = options.apiKey?.trim();
	if (apiKey && !hasAuthorizationHeader) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	// Fail fast when the model server hangs: this fetch runs inside hub
	// session commands, which enforce their own (longer) timeouts and would
	// otherwise stall on an unresponsive local server.
	const controller = new AbortController();
	const timeoutMs = options.timeoutMs ?? DEFAULT_MODELS_SOURCE_TIMEOUT_MS;
	const timer = setTimeout(
		() => controller.abort(new Error(`fetching models from ${url} timed out`)),
		timeoutMs,
	);
	try {
		const response = await fetch(url, {
			method: "GET",
			...(Object.keys(headers).length > 0 ? { headers } : {}),
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(
				`failed to fetch models from ${url}: HTTP ${response.status}`,
			);
		}
		return extractModelIdsFromPayload(
			(await response.json()) as unknown,
			providerId,
		);
	} finally {
		clearTimeout(timer);
	}
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
