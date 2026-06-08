import { getClineEnvironmentConfig } from "@cline/shared";
import type { ModelInfo } from "./types";

export interface ClineRecommendedModelEntry {
	id: string;
	name?: string;
	description?: string;
}

export interface ClineRecommendedModelsPayload {
	clinePass?: ClineRecommendedModelEntry[];
}

type ModelCapabilities = Pick<
	ModelInfo,
	"contextWindow" | "maxInputTokens" | "maxTokens" | "capabilities" | "pricing"
>;

const CLINE_PASS_PROVIDER_ID = "cline-pass";

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
	if (!openRouterModels || !entry.name) {
		return CLINE_PASS_MODEL_DEFAULTS;
	}

	return openRouterModels[entry.name] || CLINE_PASS_MODEL_DEFAULTS;
}

// Cline-Pass models have only the model name (and not the lab),
// so we need to look-up using glm-5.1 instead of zai/glm-5.1
function buildModelsNameMap(
	openrouterModels: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	const nameMap: Record<string, ModelInfo> = {};

	for (const model of Object.values(openrouterModels)) {
		const parts = model.name?.split("/");
		const shortName = parts?.at(-1);

		if (model.name) {
			nameMap[shortName || model.name] = model;
		}
	}

	return nameMap;
}

export function normalizeClineRecommendedProviderModels(
	payload: ClineRecommendedModelsPayload,
	openRouterModels: Record<string, ModelInfo>,
): Record<string, Record<string, ModelInfo>> {
	const clinePass = payload.clinePass ?? [];
	if (clinePass.length === 0) {
		return {};
	}

	const models: Record<string, ModelInfo> = {};
	const openRouterModelsByName = buildModelsNameMap(openRouterModels);

	clinePass.forEach((entry) => {
		const capabilities = findORModelCapabilities(entry, openRouterModelsByName);

		models[entry.id] = {
			...capabilities,
			id: entry.id,
			name: entry.name,
			description: entry.description,
		};
	});

	if (Object.keys(models).length === 0) {
		return {};
	}

	return { [CLINE_PASS_PROVIDER_ID]: models };
}

export async function fetchClineRecommendedProviderModels(
	fetcher: typeof fetch = fetch,
	openRouterModels: Record<string, ModelInfo>,
): Promise<Record<string, Record<string, ModelInfo>>> {
	const url = `${getClineEnvironmentConfig().apiBaseUrl}/api/v1/ai/cline/recommended-models`;
	const response = await fetcher(url);
	if (!response.ok) {
		throw new Error(
			`Failed to load Cline recommended models from ${url}: HTTP ${response.status}`,
		);
	}

	const payload = (await response.json()) as ClineRecommendedModelsPayload;
	return normalizeClineRecommendedProviderModels(payload, openRouterModels);
}
