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

function findModelBySlug(
	entry: ClineRecommendedModelEntry,
	modelsByName: Record<string, ModelInfo>,
): ModelInfo | undefined {
	const modelSlug = entry.id.split("/").at(-1) ?? entry.id;

	return modelsByName[modelSlug];
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

/**
 * Builds the cline/cline-pass catalogs from the recommended-models payload,
 * borrowing each entry's capabilities from the models.dev catalog. OpenRouter
 * is the source of truth; Vercel AI Gateway is consulted only for entries
 * OpenRouter doesn't list at all, since Cline's backend also routes
 * Vercel-only models (e.g. free promotions).
 */
export function normalizeClineRecommendedProviderModels(
	payload: ClineRecommendedModelsPayload,
	providerModels: Record<string, Record<string, ModelInfo>>,
	options: { includeClineCloudModels?: boolean } = {},
): Record<string, Record<string, ModelInfo>> {
	const clinePass = payload.clinePass ?? [];
	const models: Record<string, ModelInfo> = {};
	const clineModels: Record<string, ModelInfo> = {};
	const openRouterModels = providerModels.openrouter ?? {};
	const openRouterModelsByName = buildModelsNameMap(openRouterModels);
	const vercelModels = providerModels["vercel-ai-gateway"] ?? {};
	const vercelModelsByName = buildModelsNameMap(vercelModels);

	clinePass.forEach((entry) => {
		const capabilities =
			findModelBySlug(entry, openRouterModelsByName) ??
			findModelBySlug(entry, vercelModelsByName) ??
			CLINE_PASS_MODEL_DEFAULTS;

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
			openRouterModels[entry.id] ??
			findModelBySlug(entry, openRouterModelsByName) ??
			vercelModels[entry.id] ??
			findModelBySlug(entry, vercelModelsByName) ??
			CLINE_PASS_MODEL_DEFAULTS;
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

export async function fetchClineRecommendedProviderModels(
	fetcher: typeof fetch = fetch,
	providerModels: Record<string, Record<string, ModelInfo>>,
): Promise<Record<string, Record<string, ModelInfo>>> {
	const payload = await fetchClineRecommendedModelsPayload(fetcher);
	return normalizeClineRecommendedProviderModels(payload, providerModels);
}
