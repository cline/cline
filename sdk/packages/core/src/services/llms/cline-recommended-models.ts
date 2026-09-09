import { VERCEL_OPENROUTER_MODEL_ID_ALIAS_RULES } from "@cline/llms";
import {
	getClineEnvironmentConfig,
	type ProviderModel,
	type ProviderModelFeaturedTier,
} from "@cline/shared";
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

const FEED_CACHE_TTL_MS = 5 * 60_000;

let feedCache: {
	data: ClineRecommendedModelsData;
	expiresAt: number;
} | null = null;
let feedInFlight: Promise<ClineRecommendedModelsData> | null = null;
let feedGeneration = 0;

/**
 * `fetchClineRecommendedModels` with a shared in-memory cache, for callers on
 * the model-list path (every picker open) where a per-call network round-trip
 * — or its 5s offline timeout — is unacceptable. The bundled offline fallback
 * is cached too: paying the timeout once per TTL beats paying it on every
 * model list while offline, and a recovered network is picked up within the
 * TTL.
 */
export async function getCachedClineRecommendedModels(
	options: FetchClineRecommendedModelsOptions = {},
): Promise<ClineRecommendedModelsData> {
	if (feedCache && feedCache.expiresAt > Date.now()) {
		return cloneRecommendedModels(feedCache.data);
	}
	if (feedInFlight) {
		return feedInFlight;
	}
	// A cache reset must orphan requests already in flight: without the
	// generation check their completion would repopulate the cache the reset
	// just cleared (test pollution; stale data after an intentional reset).
	const generation = feedGeneration;
	const request = fetchClineRecommendedModels(options)
		.then((data) => {
			if (generation === feedGeneration) {
				feedCache = { data, expiresAt: Date.now() + FEED_CACHE_TTL_MS };
			}
			return data;
		})
		.finally(() => {
			if (generation === feedGeneration) {
				feedInFlight = null;
			}
		});
	feedInFlight = request;
	return request;
}

/**
 * Synchronous, never-blocking view of the feed: the cached live data when
 * fresh, otherwise the bundled fallback. For callers that build model lists
 * eagerly and must not wait on the network (the provider catalog at startup),
 * so even a cold boot renders tiered sections instead of a flat list. The
 * async `getCachedClineRecommendedModels` path refreshes the cache, after
 * which peeks serve live data for the TTL.
 */
export function peekClineRecommendedModels(): ClineRecommendedModelsData {
	if (feedCache && feedCache.expiresAt > Date.now()) {
		return cloneRecommendedModels(feedCache.data);
	}
	return cloneRecommendedModels(FALLBACK_CLINE_RECOMMENDED_MODELS);
}

export function resetClineRecommendedModelsCacheForTests(): void {
	feedGeneration += 1;
	feedCache = null;
	feedInFlight = null;
}

const FEATURED_TIER_BUCKETS: Record<
	string,
	Array<{
		tier: ProviderModelFeaturedTier;
		select: (data: ClineRecommendedModelsData) => ClineRecommendedModel[];
	}>
> = {
	cline: [
		{ tier: "recommended", select: (data) => data.recommended },
		{ tier: "free", select: (data) => data.free },
	],
	// ClinePass surfaces its subscription models plus the free models (both
	// ride the same Cline API; free models bill $0 outside the quota).
	"cline-pass": [
		{ tier: "subscribed", select: (data) => data.clinePass },
		{ tier: "free", select: (data) => data.free },
	],
};

function idSlug(modelId: string): string {
	return modelId.split("/").at(-1) ?? modelId;
}

/**
 * Stamps recommended-feed tiers onto a provider's model list so clients can
 * render Recommended/Free/Subscribed sections straight off `ProviderModel`
 * instead of fetching and joining the feed themselves. Feed ids are matched
 * through the Vercel/OpenRouter alias rules (the feed can spell a model
 * differently from the catalog), with a fallback on the id's slug after "/"
 * when that slug is unambiguous — the feed and the catalog can carry
 * different vendor prefixes for the same model (`kwaipilot/kat-coder-pro`
 * vs `cline-free/kat-coder-pro`), most visibly when the bundled fallback
 * feed is stamped against a live-fetched catalog. Models the feed does not
 * mention are returned unchanged; unknown providers pass through untouched.
 */
export function applyClineFeaturedModels(
	providerId: string,
	models: ProviderModel[],
	data: ClineRecommendedModelsData,
): ProviderModel[] {
	const buckets = FEATURED_TIER_BUCKETS[providerId];
	if (!buckets) {
		return models;
	}
	type FeaturedMatch = {
		entry: ClineRecommendedModel;
		tier: ProviderModelFeaturedTier;
		rank: number;
	};
	const featuredById = new Map<string, FeaturedMatch>();
	// Slug keys are advisory: a slug shared by two different feed entries is
	// ambiguous and must not stamp anything.
	const featuredBySlug = new Map<string, FeaturedMatch | null>();
	for (const bucket of buckets) {
		bucket.select(data).forEach((entry, rank) => {
			const match: FeaturedMatch = { entry, tier: bucket.tier, rank };
			for (const lookupId of catalogLookupIds(entry.id)) {
				if (!featuredById.has(lookupId)) {
					featuredById.set(lookupId, match);
				}
			}
			const slug = idSlug(entry.id);
			const existing = featuredBySlug.get(slug);
			if (existing === undefined) {
				featuredBySlug.set(slug, match);
			} else if (existing !== null && existing.entry.id !== entry.id) {
				featuredBySlug.set(slug, null);
			}
		});
	}
	if (featuredById.size === 0) {
		return models;
	}
	// Two passes so the slug fallback cannot duplicate a tier: a feed entry
	// that matched a catalog model exactly (or via alias) is consumed, and a
	// remaining entry stamps at most one slug-matched model — otherwise a
	// catalog carrying both spellings (`kwaipilot/x` from OpenRouter plus
	// `cline-free/x` from the free overlay) would render the model twice
	// inside its tier.
	const matchedEntryIds = new Set<string>();
	for (const model of models) {
		const exact = featuredById.get(model.id);
		if (exact) {
			matchedEntryIds.add(exact.entry.id);
		}
	}
	const slugConsumed = new Set<string>();
	const resolveMatch = (model: ProviderModel): FeaturedMatch | undefined => {
		const exact = featuredById.get(model.id);
		if (exact) {
			return exact;
		}
		const bySlug = featuredBySlug.get(idSlug(model.id));
		if (
			!bySlug ||
			matchedEntryIds.has(bySlug.entry.id) ||
			slugConsumed.has(bySlug.entry.id)
		) {
			return undefined;
		}
		slugConsumed.add(bySlug.entry.id);
		return bySlug;
	};
	return models.map((model) => {
		const match = resolveMatch(model);
		if (!match) {
			return model;
		}
		return {
			...model,
			description: match.entry.description.trim() || model.description,
			featured: {
				tier: match.tier,
				rank: match.rank,
				tags: [...match.entry.tags],
			},
		};
	});
}
