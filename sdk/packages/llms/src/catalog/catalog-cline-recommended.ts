import { getClineEnvironmentConfig } from "@cline/shared";
import { buildClineClientHeaders } from "../providers/cline-client-headers";
import type { ModelInfo } from "./types";

export interface ClineRecommendedModelEntry {
	id: string;
	name?: string;
	description?: string;
	tags?: string[];
}

export interface ClineRecommendedModelsPayload {
	recommended?: ClineRecommendedModelEntry[];
	clinePass?: ClineRecommendedModelEntry[];
	free?: ClineRecommendedModelEntry[];
	clineCloud?: ClineRecommendedModelEntry[];
}

type ModelCapabilities = Pick<
	ModelInfo,
	| "contextWindow"
	| "maxInputTokens"
	| "maxTokens"
	| "capabilities"
	| "reasoningOptions"
	| "pricing"
>;

export type ClineModelLimits = Pick<
	ModelInfo,
	"contextWindow" | "maxInputTokens" | "maxTokens"
>;

const CLINE_PASS_PROVIDER_ID = "cline-pass";
const CLINE_PROVIDER_ID = "cline";

const CLINE_PASS_MODEL_DEFAULTS = {
	contextWindow: 128_000,
	maxInputTokens: 128_000,
	maxTokens: 8_192,
	capabilities: ["tools", "reasoning", "temperature"],
	pricing: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
} as const satisfies ModelCapabilities;

function findORModelCapabilities(
	entry: ClineRecommendedModelEntry,
	openRouterModels: Record<string, ModelInfo>,
	clineModelLimits: Record<string, ClineModelLimits>,
): ModelCapabilities {
	const modelSlug = entry.id.split("/").at(-1) ?? entry.id;

	return (
		openRouterModels[modelSlug] ?? {
			...CLINE_PASS_MODEL_DEFAULTS,
			...(clineModelLimits[entry.id] ?? clineModelLimits[modelSlug]),
		}
	);
}

// Cline-Pass models have only the model name (and not the lab),
// so we need to look-up using glm-5.2 instead of cline-pass/glm-5.2
function buildModelsNameMap(
	openrouterModels: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	const nameMap: Record<string, ModelInfo> = {};

	for (const model of Object.values(openrouterModels)) {
		const modelSlugWithoutProvider = model.id.split("/").at(-1) ?? model.id;

		nameMap[modelSlugWithoutProvider] = model;
	}

	return nameMap;
}

export function normalizeClineRecommendedProviderModels(
	payload: ClineRecommendedModelsPayload,
	openRouterModels: Record<string, ModelInfo>,
	options: {
		includeClineCloudModels?: boolean;
		clineModelLimits?: Record<string, ClineModelLimits>;
	} = {},
): Record<string, Record<string, ModelInfo>> {
	const clinePass = payload.clinePass ?? [];
	const models: Record<string, ModelInfo> = {};
	const clineModels: Record<string, ModelInfo> = {};
	const openRouterModelsByName = buildModelsNameMap(openRouterModels);
	// Recommended ids use Cline namespaces (cline-free/..., cline-pass/...), so
	// also index the Cline catalog by slug; exact ids still win.
	const clineModelLimits: Record<string, ClineModelLimits> = {};
	for (const [id, limits] of Object.entries(options.clineModelLimits ?? {})) {
		clineModelLimits[id.split("/").at(-1) ?? id] = limits;
	}
	Object.assign(clineModelLimits, options.clineModelLimits);

	clinePass.forEach((entry) => {
		const capabilities = findORModelCapabilities(
			entry,
			openRouterModelsByName,
			clineModelLimits,
		);

		models[entry.id] = {
			// We should use the OR name, unless there is not one (like when using defaults)
			name: entry.name,
			...capabilities,
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			id: entry.id,
			description: entry.description,
		};
	});

	const addClineModel = (
		entry: ClineRecommendedModelEntry,
		includeInClinePass: boolean,
	) => {
		const capabilities =
			openRouterModels?.[entry.id] ??
			findORModelCapabilities(entry, openRouterModelsByName, clineModelLimits);
		// The recommended-models endpoint only sends slug-like names (e.g.
		// "deepseek-v4-flash"), so prefer the OpenRouter catalog's display name
		// for every free entry. Without this, the free overlay overwrites the
		// nice OpenRouter names in the merged cline/cline-pass catalogs and the
		// pickers end up rendering raw model ids for the Free section.
		const entryName =
			capabilities.name?.trim() || entry.name?.trim() || entry.id;
		// The feed bucket determines free access, regardless of the ID namespace.
		// Keep this visible even when a client has no featured-tier metadata.
		const name =
			!includeInClinePass || /\(free\)$/i.test(entryName)
				? entryName
				: `${entryName} (free)`;

		const modelInfo = {
			...capabilities,
			name,
			id: entry.id,
			description: entry.description,
		};

		clineModels[entry.id] = {
			...modelInfo,
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};

		if (!includeInClinePass || models[entry.id]) {
			return;
		}

		models[entry.id] = {
			...modelInfo,
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
	};

	(payload.free ?? []).forEach((entry) => {
		addClineModel(entry, true);
	});
	if (options.includeClineCloudModels) {
		(payload.clineCloud ?? []).forEach((entry) => {
			addClineModel(entry, false);
		});
	}

	const result: Record<string, Record<string, ModelInfo>> = {};
	if (Object.keys(clineModels).length > 0) {
		result[CLINE_PROVIDER_ID] = clineModels;
	}
	if (clinePass.length > 0) {
		result[CLINE_PASS_PROVIDER_ID] = models;
	}
	return result;
}

export async function fetchClineRecommendedModelsPayload(
	fetcher: typeof fetch = fetch,
): Promise<ClineRecommendedModelsPayload> {
	const url = `${getClineEnvironmentConfig().apiBaseUrl}/api/v1/ai/cline/recommended-models`;
	const response = await fetcher(url, { headers: buildClineClientHeaders() });
	if (!response.ok) {
		throw new Error(
			`Failed to load Cline recommended models from ${url}: HTTP ${response.status}`,
		);
	}

	return (await response.json()) as ClineRecommendedModelsPayload;
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: undefined;
}

/**
 * Token limits from Cline's OpenRouter-compatible model list. Stealth and
 * newly launched models served by Cline are often missing from models.dev.
 */
export async function fetchClineModelLimits(
	fetcher: typeof fetch = fetch,
): Promise<Record<string, ClineModelLimits>> {
	const url = `${getClineEnvironmentConfig().apiBaseUrl}/api/v1/ai/cline/models`;
	const response = await fetcher(url, { headers: buildClineClientHeaders() });
	if (!response.ok) {
		throw new Error(
			`Failed to load Cline models from ${url}: HTTP ${response.status}`,
		);
	}

	const payload = (await response.json()) as {
		data?: {
			id?: unknown;
			context_length?: unknown;
			top_provider?: { max_completion_tokens?: unknown };
		}[];
	};
	const limits: Record<string, ClineModelLimits> = {};
	for (const model of Array.isArray(payload?.data) ? payload.data : []) {
		const contextLength = positiveInteger(model?.context_length);
		if (typeof model?.id !== "string" || !contextLength) {
			continue;
		}
		const maxTokens = positiveInteger(
			model.top_provider?.max_completion_tokens,
		);
		limits[model.id] = {
			contextWindow: contextLength,
			maxInputTokens: contextLength,
			...(maxTokens ? { maxTokens } : {}),
		};
	}
	return limits;
}

export async function fetchClineRecommendedProviderModels(
	fetcher: typeof fetch = fetch,
	openRouterModels: Record<string, ModelInfo>,
): Promise<Record<string, Record<string, ModelInfo>>> {
	const payload = await fetchClineRecommendedModelsPayload(fetcher);
	return normalizeClineRecommendedProviderModels(payload, openRouterModels);
}
