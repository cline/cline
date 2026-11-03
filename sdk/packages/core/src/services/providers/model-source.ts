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

export async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
	auth: ModelSourceAuth = {},
): Promise<string[]> {
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
	return extractModelIdsFromPayload(
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

/** Ollama tags contain names only; query each model's declared capabilities. */
export async function enrichOllamaModelCapabilities<
	T extends {
		supportsVision?: boolean;
		supportsAttachments?: boolean;
		supportsReasoning?: boolean;
	},
>(
	models: Record<string, T>,
	providerId: string,
	sourceUrl?: string,
	auth: ModelSourceAuth = {},
): Promise<Record<string, T>> {
	if (providerId !== "ollama" || !sourceUrl) return models;
	let url: URL;
	try {
		url = new URL(sourceUrl);
	} catch {
		return models;
	}
	if (!url.pathname.endsWith("/api/tags")) return models;
	url.pathname = url.pathname.replace(/\/tags$/, "/show");
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	try {
		if (auth.baseUrl && new URL(auth.baseUrl).origin === url.origin) {
			if (auth.apiKey?.trim())
				headers.Authorization = `Bearer ${auth.apiKey.trim()}`;
			Object.assign(headers, auth.headers);
		}
	} catch {}
	const entries = Object.entries(models);
	// Bound discovery concurrency for large local catalogs.
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(4, entries.length) }, async () => {
			while (next < entries.length) {
				const [id, model] = entries[next++];
				try {
					const response = await fetch(url.toString(), {
						method: "POST",
						headers,
						redirect: "error",
						body: JSON.stringify({ model: id }),
						signal: AbortSignal.timeout(5_000),
					});
					if (!response.ok) continue;
					const payload = (await response.json()) as { capabilities?: unknown };
					if (
						!Array.isArray(payload.capabilities) ||
						!payload.capabilities.every((c) => typeof c === "string")
					)
						continue;
					const vision = payload.capabilities.includes("vision");
					models[id] = {
						...model,
						supportsVision: vision,
						supportsAttachments: vision,
						supportsReasoning: payload.capabilities.includes("thinking"),
					};
				} catch {
					// Older or unavailable servers must not prevent model discovery.
				}
			}
		}),
	);
	return models;
}
