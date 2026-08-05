import { VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES } from "@cline/llms";
import { getClineEnvironmentConfig } from "@cline/shared";
import { ProviderSettingsManager } from "../storage/provider-settings-manager";
import { getLiveModelsCatalog } from "./provider-defaults";
import type { ModelInfo } from "./provider-settings";

export interface ClineRecommendedModel {
	id: string;
	/** Display-ready model name, resolved against the model catalog. */
	name: string;
	description: string;
	tags: string[];
}

export interface ClineRecommendedModelsData {
	recommended: ClineRecommendedModel[];
	free: ClineRecommendedModel[];
	clinePass: ClineRecommendedModel[];
}

type ModelsCatalog = Record<string, Record<string, ModelInfo>>;

export interface FetchClineRecommendedModelsOptions {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
	providerSettingsManager?: Pick<
		ProviderSettingsManager,
		"getProviderSettings"
	>;
	timeoutMs?: number;
	/**
	 * Loader for the live models catalog used to resolve display names.
	 * Defaults to the shared live-catalog cache; injectable for tests.
	 */
	catalogLoader?: () => Promise<ModelsCatalog>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

export const FALLBACK_CLINE_RECOMMENDED_MODELS: ClineRecommendedModelsData = {
	recommended: [
		{
			id: "anthropic/claude-opus-4.6",
			name: "Claude Opus 4.6",
			description: "Most intelligent model for agents and coding",
			tags: ["BEST"],
		},
		{
			id: "anthropic/claude-sonnet-4.6",
			name: "Claude Sonnet 4.6",
			description: "Strong coding and agent performance",
			tags: ["NEW"],
		},
		{
			id: "google/gemini-3.1-pro-preview",
			name: "Gemini 3.1 Pro Preview",
			description: "1M context window, strong coding performance",
			tags: ["NEW"],
		},
		{
			id: "openai/gpt-5.3-codex",
			name: "GPT-5.3 Codex",
			description: "OpenAI's latest with strong coding abilities",
			tags: ["NEW"],
		},
	],
	free: [
		{
			id: "kwaipilot/kat-coder-pro",
			name: "KwaiKAT Kat Coder Pro",
			description: "Advanced agentic coding model",
			tags: ["FREE"],
		},
		{
			id: "arcee-ai/trinity-large-preview:free",
			name: "Arcee AI Trinity Large Preview",
			description: "Advanced large preview model",
			tags: ["FREE"],
		},
	],
	clinePass: [],
};

function cloneRecommendedModels(
	data: ClineRecommendedModelsData,
): ClineRecommendedModelsData {
	return {
		recommended: data.recommended.map((model) => ({
			...model,
			tags: [...model.tags],
		})),
		free: data.free.map((model) => ({ ...model, tags: [...model.tags] })),
		clinePass: data.clinePass.map((model) => ({
			...model,
			tags: [...model.tags],
		})),
	};
}

function normalizeModel(raw: unknown): ClineRecommendedModel | null {
	if (!raw || typeof raw !== "object") return null;
	const data = raw as Record<string, unknown>;
	if (typeof data.id !== "string" || data.id.length === 0) return null;
	return {
		id: data.id,
		name:
			typeof data.name === "string" && data.name.length > 0
				? data.name
				: data.id,
		description: typeof data.description === "string" ? data.description : "",
		tags: Array.isArray(data.tags)
			? data.tags.filter((tag): tag is string => typeof tag === "string")
			: [],
	};
}

function normalizeResponse(raw: unknown): ClineRecommendedModelsData | null {
	if (!raw || typeof raw !== "object") return null;
	const data = raw as Record<string, unknown>;
	const recommendedRaw = Array.isArray(data.recommended)
		? data.recommended
		: [];
	const freeRaw = Array.isArray(data.free) ? data.free : [];
	const clinePassRaw = Array.isArray(data.clinePass) ? data.clinePass : [];
	const recommended = recommendedRaw
		.map(normalizeModel)
		.filter((model): model is ClineRecommendedModel => model !== null);
	const free = freeRaw
		.map(normalizeModel)
		.filter((model): model is ClineRecommendedModel => model !== null);
	const clinePass = clinePassRaw
		.map(normalizeModel)
		.filter((model): model is ClineRecommendedModel => model !== null);
	if (recommended.length === 0 && free.length === 0 && clinePass.length === 0) {
		return null;
	}

	return { recommended, free, clinePass };
}

function getConfiguredApiBaseUrl(
	options: FetchClineRecommendedModelsOptions,
): string {
	const explicitBaseUrl = options.baseUrl?.trim();
	if (explicitBaseUrl) return explicitBaseUrl;

	const fallbackBaseUrl = getClineEnvironmentConfig().apiBaseUrl;
	try {
		const manager =
			options.providerSettingsManager ?? new ProviderSettingsManager();
		const settings = manager.getProviderSettings("cline");
		return settings?.baseUrl?.trim() || fallbackBaseUrl;
	} catch {
		return fallbackBaseUrl;
	}
}

async function fetchWithTimeout(
	fetchImpl: typeof fetch,
	input: string,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetchImpl(input, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

// The featured pickers render these names next to their own FREE chips and
// section headers, so OpenRouter's free markers are redundant there.
function stripFreeMarkers(name: string): string {
	return name
		.replace(/\s*\(free\)\s*$/i, "")
		.replace(/:free$/i, "")
		.trim();
}

// The recommendation feed can use Vercel-style ids (e.g. "zai/glm-5.2") while
// the catalog keys the same model under its OpenRouter alias ("z-ai/glm-5.2"),
// so look up both spellings.
function catalogLookupIds(modelId: string): string[] {
	const ids = [modelId];
	for (const rule of VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES) {
		if (modelId.startsWith(rule.canonicalPrefix)) {
			ids.push(
				`${rule.aliasPrefix}${modelId.slice(rule.canonicalPrefix.length)}`,
			);
		} else if (modelId.startsWith(rule.aliasPrefix)) {
			ids.push(
				`${rule.canonicalPrefix}${modelId.slice(rule.aliasPrefix.length)}`,
			);
		}
	}
	return ids;
}

function resolveEntryDisplayName(
	entry: ClineRecommendedModel,
	catalogs: Array<Record<string, ModelInfo> | undefined>,
): string {
	for (const catalog of catalogs) {
		for (const lookupId of catalogLookupIds(entry.id)) {
			const catalogName = catalog?.[lookupId]?.name?.trim();
			if (catalogName) {
				return stripFreeMarkers(catalogName);
			}
		}
	}
	// The endpoint's own names are slug-like; still better than a full id.
	const endpointName = entry.name?.trim();
	if (endpointName && endpointName !== entry.id) {
		return stripFreeMarkers(endpointName);
	}
	const slug = entry.id.split("/").at(-1) ?? entry.id;
	return stripFreeMarkers(slug);
}

async function loadCatalogWithTimeout(
	catalogLoader: () => Promise<ModelsCatalog>,
	timeoutMs: number,
): Promise<ModelsCatalog | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// Race instead of abort: the shared live-catalog loader caches its
		// in-flight promise, so a slow fetch still completes and warms the
		// cache for the next call.
		return await Promise.race([
			catalogLoader(),
			new Promise<undefined>((resolve) => {
				timer = setTimeout(() => resolve(undefined), timeoutMs);
			}),
		]);
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Resolves display-ready names for every entry so consumers can render
 * `entry.name` directly instead of re-joining ids against the model catalog
 * in each picker. Preference order: catalog display name, endpoint-provided
 * name, id slug.
 */
async function resolveDisplayNames(
	data: ClineRecommendedModelsData,
	catalogLoader: () => Promise<ModelsCatalog>,
	timeoutMs: number,
): Promise<ClineRecommendedModelsData> {
	const catalog = await loadCatalogWithTimeout(catalogLoader, timeoutMs);
	const withNames = (
		models: ClineRecommendedModel[],
		catalogs: Array<Record<string, ModelInfo> | undefined>,
	) =>
		models.map((model) => ({
			...model,
			name: resolveEntryDisplayName(model, catalogs),
		}));

	return {
		recommended: withNames(data.recommended, [catalog?.openrouter]),
		free: withNames(data.free, [catalog?.cline, catalog?.openrouter]),
		clinePass: withNames(data.clinePass, [catalog?.["cline-pass"]]),
	};
}

export async function fetchClineRecommendedModels(
	options: FetchClineRecommendedModelsOptions = {},
): Promise<ClineRecommendedModelsData> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	// The feed request and the catalog lookup share one deadline so a slow
	// endpoint plus a cold catalog cannot stack two full timeout windows. An
	// already-cached catalog still applies with an exhausted budget: its
	// promise resolves on a microtask, ahead of the zero-delay timer.
	const deadline = Date.now() + timeoutMs;
	try {
		const base = getConfiguredApiBaseUrl(options);
		const fetchImpl = options.fetchImpl ?? fetch;
		const resp = await fetchWithTimeout(
			fetchImpl,
			`${base}/api/v1/ai/cline/recommended-models`,
			timeoutMs,
		);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const json: unknown = await resp.json();
		const data = normalizeResponse(json);
		if (data) {
			return await resolveDisplayNames(
				data,
				options.catalogLoader ?? getLiveModelsCatalog,
				Math.max(0, deadline - Date.now()),
			);
		}
	} catch {
		// Fall back to the bundled list when the remote source is unavailable.
	}

	// The bundled fallback already carries display names; it is intentionally
	// returned as-is so callers can detect it by equality with
	// FALLBACK_CLINE_RECOMMENDED_MODELS (e.g. to avoid caching a transient
	// failure).
	return cloneRecommendedModels(FALLBACK_CLINE_RECOMMENDED_MODELS);
}
