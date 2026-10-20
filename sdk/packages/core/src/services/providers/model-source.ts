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

export interface ModelSourceAuth {
	baseUrl?: string;
	apiKey?: string;
	headers?: Record<string, string>;
}

/**
 * A model source may be a third-party public catalog. Only send provider
 * credentials to its own origin. Returns `undefined` when there is nothing to
 * send, so callers know not to lock down redirects.
 */
function resolveSourceAuthHeaders(
	url: string,
	auth: ModelSourceAuth,
): Headers | undefined {
	let sameOrigin = false;
	try {
		sameOrigin =
			!!auth.baseUrl && new URL(url).origin === new URL(auth.baseUrl).origin;
	} catch {
		// An invalid API endpoint cannot establish trust, but should not prevent
		// an independent public catalog from loading without credentials.
	}
	if (!sameOrigin) {
		return undefined;
	}
	const headers = new Headers();
	if (auth.apiKey?.trim()) {
		headers.set("Authorization", `Bearer ${auth.apiKey.trim()}`);
	}
	for (const [name, value] of Object.entries(auth.headers ?? {})) {
		headers.set(name, value);
	}
	let hasHeaders = false;
	headers.forEach(() => {
		hasHeaders = true;
	});
	return hasHeaders ? headers : undefined;
}

export async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
	auth: ModelSourceAuth = {},
): Promise<string[]> {
	// Do not follow authenticated redirects.
	const headers = resolveSourceAuthHeaders(url, auth);
	const response = await fetch(url, {
		method: "GET",
		...(headers ? { headers, redirect: "error" as const } : {}),
		signal: AbortSignal.timeout(5_000),
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
}

/**
 * Ask an Ollama server whether a model accepts image input.
 *
 * `/api/tags` (the models source) only lists installed models and says nothing
 * about what they can do; `/api/show` reports each model's capabilities
 * (`"vision"`, `"tools"`, `"thinking"`, ...). Resolves to `undefined` when
 * the server cannot answer (an older Ollama that omits `capabilities`, a
 * request failure, or a custom source URL that is not `.../api/tags`) so the
 * caller keeps its existing default instead of guessing either way. Uses the
 * same credentials as the models source, so it works behind an auth proxy.
 */
export async function fetchOllamaVisionSupport(
	modelsSourceUrl: string,
	modelId: string,
	auth: ModelSourceAuth = {},
): Promise<boolean | undefined> {
	if (!modelsSourceUrl.endsWith("/api/tags")) {
		return undefined;
	}
	const showUrl = `${modelsSourceUrl.slice(0, -"tags".length)}show`;
	const authHeaders = resolveSourceAuthHeaders(showUrl, auth);
	const headers = new Headers(authHeaders);
	headers.set("content-type", "application/json");
	try {
		const response = await fetch(showUrl, {
			method: "POST",
			headers,
			...(authHeaders ? { redirect: "error" as const } : {}),
			body: JSON.stringify({ model: modelId }),
			signal: AbortSignal.timeout(5_000),
		});
		if (!response.ok) {
			return undefined;
		}
		const payload = (await response.json()) as { capabilities?: unknown };
		if (!Array.isArray(payload.capabilities)) {
			return undefined;
		}
		return payload.capabilities.includes("vision");
	} catch {
		return undefined;
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
