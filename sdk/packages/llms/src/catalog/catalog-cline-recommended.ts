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
} as const satisfies Pick<
	ModelInfo,
	"contextWindow" | "maxInputTokens" | "maxTokens" | "capabilities" | "pricing"
>;

function normalizeClinePassModel(entry: ClineRecommendedModelEntry): ModelInfo {
	return {
		...CLINE_PASS_MODEL_DEFAULTS,
		id: entry.id,
		name: entry.name || entry.id,
		description: entry.description,
	};
}

export function normalizeClineRecommendedProviderModels(
	payload: ClineRecommendedModelsPayload,
): Record<string, Record<string, ModelInfo>> {
	const clinePass = payload.clinePass ?? [];
	if (clinePass.length === 0) {
		return {};
	}

	const models = Object.fromEntries(
		clinePass
			.filter((entry) => entry.id.trim().length > 0)
			.map((entry) => [entry.id, normalizeClinePassModel(entry)]),
	);

	if (Object.keys(models).length === 0) {
		return {};
	}

	return { [CLINE_PASS_PROVIDER_ID]: models };
}

export async function fetchClineRecommendedProviderModels(
	fetcher: typeof fetch = fetch,
): Promise<Record<string, Record<string, ModelInfo>>> {
	const url = `${getClineEnvironmentConfig().apiBaseUrl}/api/v1/ai/cline/recommended-models`;
	const response = await fetcher(url);
	if (!response.ok) {
		throw new Error(
			`Failed to load Cline recommended models from ${url}: HTTP ${response.status}`,
		);
	}

	const payload = (await response.json()) as ClineRecommendedModelsPayload;
	return normalizeClineRecommendedProviderModels(payload);
}
