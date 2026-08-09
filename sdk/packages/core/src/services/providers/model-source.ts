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

export interface FetchModelIdsOptions {
	/** Sent as `Authorization: Bearer <apiKey>` unless headers already set one. */
	apiKey?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
}

/**
 * Keep model-source fetches well under the hub's 30s command timeout so a
 * stalled local server (e.g. LM Studio) fails fast instead of wedging hub
 * commands that resolve provider models.
 */
const DEFAULT_MODEL_SOURCE_TIMEOUT_MS = 10_000;

/**
 * Resolve an API key from the provider's registered environment variables
 * (e.g. `LMSTUDIO_API_KEY`), mirroring the chat-request path's env fallback.
 */
export function resolveApiKeyFromEnv(
	envKeys: readonly string[] | undefined,
): string | undefined {
	const env = globalThis.process?.env;
	if (!env || !envKeys) {
		return undefined;
	}
	for (const key of envKeys) {
		const value = env[key]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}

function buildModelSourceHeaders(
	options: FetchModelIdsOptions,
): Record<string, string> | undefined {
	const headers: Record<string, string> = { ...options.headers };
	const hasAuthHeader = Object.keys(headers).some(
		(key) => key.toLowerCase() === "authorization",
	);
	const apiKey = options.apiKey?.trim();
	if (apiKey && !hasAuthHeader) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	return Object.keys(headers).length > 0 ? headers : undefined;
}

export async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
	options: FetchModelIdsOptions = {},
): Promise<string[]> {
	const headers = buildModelSourceHeaders(options);
	const timeoutMs = options.timeoutMs ?? DEFAULT_MODEL_SOURCE_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(
		() =>
			controller.abort(
				new Error(
					`failed to fetch models from ${url}: timed out after ${timeoutMs}ms`,
				),
			),
		timeoutMs,
	);
	try {
		const response = await fetch(url, {
			method: "GET",
			...(headers ? { headers } : {}),
			signal: controller.signal,
		});
		if (!response.ok) {
			const authHint =
				response.status === 401 || response.status === 403
					? ` (authentication failed — configure an API key for "${providerId}")`
					: "";
			throw new Error(
				`failed to fetch models from ${url}: HTTP ${response.status}${authHint}`,
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
