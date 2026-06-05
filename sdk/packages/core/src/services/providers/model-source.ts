import { type ModelCapability, ModelCapabilitySchema } from "@cline/shared";

export interface SourceModel {
	id: string;
	capabilities?: ModelCapability[];
}

function toModelCapability(value: unknown): ModelCapability | undefined {
	if (typeof value !== "string") return undefined;
	const normalized =
		value === "structured-output" ? "structured_output" : value;
	const parsed = ModelCapabilitySchema.safeParse(normalized);
	return parsed.success ? parsed.data : undefined;
}

function parseCapabilities(input: unknown): ModelCapability[] | undefined {
	if (!Array.isArray(input)) return undefined;
	const capabilities = [
		...new Set(
			input
				.map(toModelCapability)
				.filter((value): value is ModelCapability => value !== undefined),
		),
	];
	return capabilities.length > 0 ? capabilities : undefined;
}

function parseModelList(input: unknown): SourceModel[] {
	if (!Array.isArray(input)) return [];
	return input
		.map((item): SourceModel | undefined => {
			if (typeof item === "string") {
				const id = item.trim();
				return id ? { id } : undefined;
			}
			if (item && typeof item === "object") {
				const entry = item as {
					id?: unknown;
					name?: unknown;
					model?: unknown;
					capabilities?: unknown;
				};
				for (const value of [entry.id, entry.name, entry.model]) {
					if (typeof value === "string" && value.trim()) {
						return {
							id: value.trim(),
							capabilities: parseCapabilities(entry.capabilities),
						};
					}
				}
			}
			return undefined;
		})
		.filter((model): model is SourceModel => model !== undefined);
}

export function extractModelsFromPayload(
	payload: unknown,
	providerId: string,
): SourceModel[] {
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
		const keys = Object.keys(data.models).filter((k) => k.trim().length > 0);
		if (keys.length > 0) return keys.map((id) => ({ id }));
	}

	const scoped = data.providers?.[providerId];
	if (scoped && typeof scoped === "object") {
		const nested = scoped as { models?: unknown };
		const list = parseModelList(nested.models ?? scoped);
		if (list.length > 0) return list;
	}

	return [];
}

export function extractModelIdsFromPayload(
	payload: unknown,
	providerId: string,
): string[] {
	return extractModelsFromPayload(payload, providerId).map((model) => model.id);
}

export async function fetchModelsFromSource(
	url: string,
	providerId: string,
): Promise<SourceModel[]> {
	const response = await fetch(url, { method: "GET" });
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
): Promise<string[]> {
	return (await fetchModelsFromSource(url, providerId)).map(
		(model) => model.id,
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
