interface DiscoveredModel {
	id: string;
	contextWindow?: number;
}

function withContextWindow(id: string, value: unknown): DiscoveredModel {
	if (!value || typeof value !== "object") return { id };
	const model = value as Record<string, unknown>;
	const meta =
		model.meta && typeof model.meta === "object"
			? (model.meta as Record<string, unknown>)
			: undefined;
	const contextWindow = [
		model.contextWindow,
		model.context_length,
		model.max_model_len,
		meta?.n_ctx,
	].find(
		(limit): limit is number =>
			typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0,
	);
	return contextWindow === undefined ? { id } : { id, contextWindow };
}

function parseModelList(input: unknown): DiscoveredModel[] {
	if (!Array.isArray(input)) return [];
	return input.flatMap((item) => {
		if (typeof item === "string") {
			const id = item.trim();
			return id ? [{ id }] : [];
		}
		if (!item || typeof item !== "object") return [];
		const entry = item as { id?: unknown; name?: unknown; model?: unknown };
		const id = [entry.id, entry.name, entry.model].find(
			(value): value is string =>
				typeof value === "string" && value.trim().length > 0,
		);
		return id ? [withContextWindow(id.trim(), item)] : [];
	});
}

function extractModelsFromPayload(
	payload: unknown,
	providerId: string,
): DiscoveredModel[] {
	const rootArray = parseModelList(payload);
	if (rootArray.length > 0) return rootArray;
	if (!payload || typeof payload !== "object") return [];

	const data = payload as {
		data?: unknown;
		models?: unknown;
		providers?: Record<string, unknown>;
	};

	const direct = parseModelList(data.data ?? data.models);
	if (direct.length > 0) return direct;

	if (
		data.models &&
		typeof data.models === "object" &&
		!Array.isArray(data.models)
	) {
		const models = Object.entries(data.models)
			.filter(([id]) => id.trim().length > 0)
			.map(([id, value]) => withContextWindow(id, value));
		if (models.length > 0) return models;
	}

	const scoped = data.providers?.[providerId];
	return scoped && typeof scoped === "object"
		? parseModelList((scoped as { models?: unknown }).models ?? scoped)
		: [];
}

export function extractModelIdsFromPayload(
	payload: unknown,
	providerId: string,
): string[] {
	return extractModelsFromPayload(payload, providerId).map(({ id }) => id);
}

export interface ModelSourceAuth {
	baseUrl?: string;
	apiKey?: string;
	headers?: Record<string, string>;
}

export async function fetchModelsFromSource(
	url: string,
	providerId: string,
	auth: ModelSourceAuth = {},
): Promise<DiscoveredModel[]> {
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
	return extractModelsFromPayload(
		(await response.json()) as unknown,
		providerId,
	);
}

export async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
	auth: ModelSourceAuth = {},
): Promise<string[]> {
	return (await fetchModelsFromSource(url, providerId, auth)).map(
		({ id }) => id,
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
