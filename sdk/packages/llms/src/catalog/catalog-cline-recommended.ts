import { getClineEnvironmentConfig } from "@cline/shared";
import type { ModelInfo } from "./types";

export interface ClineRecommendedModelEntry {
	id: string;
	name?: string;
	description?: string;
}

export interface ClineRecommendedModelsPayload {
	clinePass?: ClineRecommendedModelEntry[];
	free?: ClineRecommendedModelEntry[];
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
): ModelCapabilities {
	if (!openRouterModels) {
		return CLINE_PASS_MODEL_DEFAULTS;
	}

	const modelSlug = entry.id.split("/").at(-1) ?? entry.id;

	return openRouterModels[modelSlug] || CLINE_PASS_MODEL_DEFAULTS;
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
): Record<string, Record<string, ModelInfo>> {
	const clinePass = payload.clinePass ?? [];
	const models: Record<string, ModelInfo> = {};
	const clineFreeModels: Record<string, ModelInfo> = {};
	const openRouterModelsByName = buildModelsNameMap(openRouterModels);

	clinePass.forEach((entry) => {
		const capabilities = findORModelCapabilities(entry, openRouterModelsByName);

		models[entry.id] = {
			// We should use the OR name, unless there is not one (like when using defaults)
			name: entry.name,
			...capabilities,
			id: entry.id,
			description: entry.description,
		};
	});

	// Cline free models are selectable on the ClinePass provider too (same API
	// underneath; they ride usage billing at $0 instead of the subscription quota).
	// Unlike pass models their ids are full OpenRouter-style ids or cline-free ids,
	// so look up capabilities by full id before falling back to the slug map.
	(payload.free ?? []).forEach((entry) => {
		const capabilities =
			openRouterModels?.[entry.id] ??
			findORModelCapabilities(entry, openRouterModelsByName);
		// The recommended-models endpoint only sends slug-like names (e.g.
		// "deepseek-v4-flash"), so prefer the OpenRouter catalog's display name
		// for every free entry. Without this, the free overlay overwrites the
		// nice OpenRouter names in the merged cline/cline-pass catalogs and the
		// pickers end up rendering raw model ids for the Free section.
		const entryName =
			capabilities.name?.trim() || entry.name?.trim() || entry.id;
		const name = entry.id.startsWith("cline-free/")
			? `${entryName} (free)`
			: entryName;

		const modelInfo = {
			...capabilities,
			name,
			id: entry.id,
			description: entry.description,
		};

		clineFreeModels[entry.id] = {
			...modelInfo,
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};

		if (models[entry.id]) {
			return;
		}

		models[entry.id] = {
			...modelInfo,
			pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
	});

	const result: Record<string, Record<string, ModelInfo>> = {};
	if (Object.keys(clineFreeModels).length > 0) {
		result[CLINE_PROVIDER_ID] = clineFreeModels;
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
	const response = await fetcher(url);
	if (!response.ok) {
		throw new Error(
			`Failed to load Cline recommended models from ${url}: HTTP ${response.status}`,
		);
	}

	return (await response.json()) as ClineRecommendedModelsPayload;
}

export async function fetchClineRecommendedProviderModels(
	fetcher: typeof fetch = fetch,
	openRouterModels: Record<string, ModelInfo>,
): Promise<Record<string, Record<string, ModelInfo>>> {
	const payload = await fetchClineRecommendedModelsPayload(fetcher);
	return normalizeClineRecommendedProviderModels(payload, openRouterModels);
}
