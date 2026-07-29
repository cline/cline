/**
 * Rich live model sources.
 *
 * Per-provider fetchers that hit a provider's own models endpoint and parse
 * full `ModelInfo` (pricing incl. cache read/write, descriptions, image
 * support, thinking config, provider-specific metadata). These were ported
 * from the VS Code extension's per-provider refresh handlers
 * (`refreshOpenRouterModels` & co.) so that every client (CLI, extension,
 * desktop app) resolves model catalogs from the same source.
 *
 * Unlike `modelsSourceUrl` (Ollama/LM Studio semantics, where the live
 * response is the authoritative installed list and the curated catalog is
 * discarded), these sources are keyed by *generated catalog key* and are
 * merged field-wise on top of the curated catalog in `mergeKnownModels`:
 * live fields win, curated fields fill the gaps (release dates, reasoning
 * options, ...). Keying by catalog key means providers that share a catalog
 * (e.g. `cline` piggybacking on `openrouter` ids) share the live data too.
 */

import * as Llms from "@cline/llms";
import type { ModelInfo } from "./provider-settings";

const DEFAULT_LIVE_SOURCE_TIMEOUT_MS = 15_000;

/**
 * Placeholder thinking budget used to signal "this model supports thinking"
 * when the provider's models endpoint only exposes a boolean-ish reasoning
 * flag. Matches the extension's `ANTHROPIC_MAX_THINKING_BUDGET`.
 */
const DEFAULT_MAX_THINKING_BUDGET = 6_000;

const GEMINI_FLASH_MAX_OUTPUT_TOKENS = 8_192;

function isGeminiFlashModel(id: string): boolean {
	const modelId = id.toLowerCase();
	const isGooglePrefixedGemini = modelId.startsWith("google/gemini");
	const isDirectGemini = modelId.startsWith("gemini-");
	return (
		(isGooglePrefixedGemini || isDirectGemini) && modelId.includes("flash")
	);
}

/** Parse a per-token price string into a per-million-tokens number. */
function parsePricePerMillion(
	price: number | string | undefined | null,
): number | undefined {
	if (price === undefined || price === null || price === "") {
		return undefined;
	}
	const parsed = typeof price === "number" ? price : Number.parseFloat(price);
	if (!Number.isFinite(parsed)) {
		return undefined;
	}
	return parsed * 1_000_000;
}

type Capabilities = NonNullable<ModelInfo["capabilities"]>;

function addCapability(
	capabilities: Capabilities,
	capability: Capabilities[number],
	when = true,
): void {
	if (when && !capabilities.includes(capability)) {
		capabilities.push(capability);
	}
}

async function fetchJson(
	url: string,
	init: RequestInit,
	fetcher: typeof fetch,
	timeoutMs = DEFAULT_LIVE_SOURCE_TIMEOUT_MS,
): Promise<unknown> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetcher(url, {
			...init,
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`Model refresh failed: HTTP ${response.status} (${url})`);
		}
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}

function getCuratedModels(providerId: string): Record<string, ModelInfo> {
	return Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.models ?? {};
}

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

/**
 * Raw model information returned by the OpenRouter API.
 * @link https://openrouter.ai/docs/overview/models
 */
interface OpenRouterRawModelInfo {
	id?: string;
	name?: string;
	description?: string | null;
	context_length?: number | null;
	top_provider?: {
		max_completion_tokens?: number | null;
		context_length?: number | null;
	} | null;
	architecture?: {
		modality?: string[];
	} | null;
	pricing?: {
		prompt?: string;
		completion?: string;
		input_cache_read?: string;
		input_cache_write?: string;
	} | null;
	supports_global_endpoint?: boolean | null;
	tiers?: unknown[] | null;
	supported_parameters?: string[] | null;
}

interface MutableOpenRouterModel {
	maxTokens: number | undefined;
	contextWindow: number | undefined;
	inputPrice?: number;
	outputPrice?: number;
	cacheReadsPrice?: number;
	cacheWritesPrice?: number;
	supportsPromptCache: boolean;
}

/**
 * Curated per-model corrections layered on top of OpenRouter's raw payload:
 * Anthropic cache pricing (not reported by the endpoint), context-window and
 * max-token workarounds (kimi-k2, gpt-5 family, Gemini Flash), and pricing
 * fixes. Ported unchanged from the extension's `refreshOpenRouterModels`.
 */
function applyOpenRouterModelOverrides(
	modelId: string,
	model: MutableOpenRouterModel,
	pricing: OpenRouterRawModelInfo["pricing"],
): void {
	switch (modelId) {
		case "anthropic/claude-sonnet-4.6":
		case "anthropic/claude-4.6-sonnet":
		case "anthropic/claude-sonnet-4.5":
		case "anthropic/claude-4.5-sonnet":
		case "anthropic/claude-sonnet-4":
			// NOTE: OpenRouter reports the full 1m extended context window for
			// these models and we intentionally pass it through unchanged, so the
			// picker stays consistent with the rest of the catalog (task header,
			// auto-compaction).
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 3.75;
			model.cacheReadsPrice = 0.3;
			break;
		case "anthropic/claude-3-7-sonnet":
		case "anthropic/claude-3-7-sonnet:beta":
		case "anthropic/claude-3.7-sonnet":
		case "anthropic/claude-3.7-sonnet:beta":
		case "anthropic/claude-3.7-sonnet:thinking":
		case "anthropic/claude-3.5-sonnet":
		case "anthropic/claude-3.5-sonnet:beta":
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 3.75;
			model.cacheReadsPrice = 0.3;
			break;
		case "anthropic/claude-opus-4.6":
		case "anthropic/claude-opus-4.7":
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 6.25;
			model.cacheReadsPrice = 0.5;
			break;
		case "anthropic/claude-fable-5":
			model.supportsPromptCache = true;
			model.inputPrice = 10;
			model.outputPrice = 50;
			model.cacheWritesPrice = 12.5;
			model.cacheReadsPrice = 1;
			break;
		case "anthropic/claude-opus-4.5":
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 6.25;
			model.cacheReadsPrice = 0.5;
			break;
		case "anthropic/claude-opus-4.1":
		case "anthropic/claude-opus-4":
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 18.75;
			model.cacheReadsPrice = 1.5;
			break;
		case "anthropic/claude-3.5-sonnet-20240620":
		case "anthropic/claude-3.5-sonnet-20240620:beta":
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 3.75;
			model.cacheReadsPrice = 0.3;
			break;
		case "anthropic/claude-haiku-4.5":
		case "anthropic/claude-4.5-haiku":
		case "anthropic/claude-3-5-haiku":
		case "anthropic/claude-3-5-haiku:beta":
		case "anthropic/claude-3-5-haiku-20241022":
		case "anthropic/claude-3-5-haiku-20241022:beta":
		case "anthropic/claude-3.5-haiku":
		case "anthropic/claude-3.5-haiku:beta":
		case "anthropic/claude-3.5-haiku-20241022":
		case "anthropic/claude-3.5-haiku-20241022:beta":
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 1.25;
			model.cacheReadsPrice = 0.1;
			break;
		case "anthropic/claude-3-opus":
		case "anthropic/claude-3-opus:beta":
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 18.75;
			model.cacheReadsPrice = 1.5;
			break;
		case "anthropic/claude-3-haiku":
		case "anthropic/claude-3-haiku:beta":
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 0.3;
			model.cacheReadsPrice = 0.03;
			break;
		case "deepseek/deepseek-chat":
			model.supportsPromptCache = true;
			// DeepSeek-specific OpenRouter pricing override; the native DeepSeek
			// provider is sourced from the curated catalog.
			model.inputPrice = 0;
			model.cacheWritesPrice = 0.14;
			model.cacheReadsPrice = 0.014;
			break;
		case "x-ai/grok-3-beta":
			model.supportsPromptCache = true;
			model.cacheWritesPrice = 0.75;
			model.cacheReadsPrice = 0;
			break;
		case "moonshotai/kimi-k2":
			// Forcing kimi-k2 to use the together provider for full context and
			// best throughput.
			model.inputPrice = 1;
			model.outputPrice = 3;
			model.contextWindow = 131_000;
			break;
		case "openai/gpt-5":
		case "openai/gpt-5-chat":
		case "openai/gpt-5-mini":
		case "openai/gpt-5-nano":
			model.maxTokens = 8_192; // 128000 breaks context window truncation
			model.contextWindow = 272_000; // openrouter reports 400k but the input limit is actually 400k-128k
			break;
		case "x-ai/grok-code-fast-1":
			model.supportsPromptCache = true;
			model.cacheReadsPrice = 0.02;
			break;
		default:
			if (modelId.startsWith("openai/") || modelId.startsWith("google/")) {
				const cacheRead = parsePricePerMillion(pricing?.input_cache_read);
				if (cacheRead !== undefined && cacheRead !== 0) {
					model.supportsPromptCache = true;
					model.cacheReadsPrice = cacheRead;
					model.cacheWritesPrice = parsePricePerMillion(
						pricing?.input_cache_write,
					);
				}
			}
			break;
	}

	if (isGeminiFlashModel(modelId)) {
		model.maxTokens = Math.min(
			model.maxTokens || GEMINI_FLASH_MAX_OUTPUT_TOKENS,
			GEMINI_FLASH_MAX_OUTPUT_TOKENS,
		);
	}
}

/**
 * Stealth models are compatible with the OpenRouter API but not listed on the
 * OpenRouter website or API.
 */
const CLINE_STEALTH_MODELS: Record<string, ModelInfo> = {
	"stealth/giga-potato": {
		id: "stealth/giga-potato",
		name: "Giga Potato",
		maxTokens: 8192,
		contextWindow: 224_000,
		capabilities: ["streaming", "tools", "images", "prompt-cache"],
		pricing: { input: 0, output: 0 },
		description: "A stealth model for testing purposes. Not a real potato.",
	},
};

export async function fetchOpenRouterLiveModels(
	fetcher: typeof fetch = fetch,
): Promise<Record<string, ModelInfo>> {
	const payload = (await fetchJson(
		"https://openrouter.ai/api/v1/models",
		{ method: "GET", headers: { accept: "application/json" } },
		fetcher,
		30_000,
	)) as { data?: OpenRouterRawModelInfo[] };
	if (!Array.isArray(payload?.data)) {
		throw new Error("Invalid response data when fetching OpenRouter models");
	}

	const models: Record<string, ModelInfo> = {};
	for (const rawModel of payload.data) {
		const id = rawModel.id?.trim();
		if (!id) {
			continue;
		}

		const supportsThinking = Boolean(
			rawModel.supported_parameters?.some(
				(parameter) =>
					parameter === "include_reasoning" || parameter === "reasoning",
			),
		);
		const supportsImages = Boolean(
			rawModel.architecture?.modality?.includes("image"),
		);
		const supportsTools =
			!rawModel.supported_parameters ||
			rawModel.supported_parameters.includes("tools");

		// Missing token limits stay undefined so the catalog merge can fall
		// back to curated values instead of clobbering them with 0.
		const mutable: MutableOpenRouterModel = {
			maxTokens: rawModel.top_provider?.max_completion_tokens ?? undefined,
			contextWindow: rawModel.context_length ?? undefined,
			inputPrice: parsePricePerMillion(rawModel.pricing?.prompt) ?? 0,
			outputPrice: parsePricePerMillion(rawModel.pricing?.completion) ?? 0,
			cacheReadsPrice: parsePricePerMillion(rawModel.pricing?.input_cache_read),
			cacheWritesPrice: parsePricePerMillion(
				rawModel.pricing?.input_cache_write,
			),
			supportsPromptCache: false,
		};
		applyOpenRouterModelOverrides(id, mutable, rawModel.pricing);

		const capabilities: Capabilities = ["streaming"];
		addCapability(capabilities, "tools", supportsTools);
		addCapability(capabilities, "images", supportsImages);
		addCapability(capabilities, "reasoning", supportsThinking);
		addCapability(capabilities, "prompt-cache", mutable.supportsPromptCache);

		const metadata: NonNullable<ModelInfo["metadata"]> = {};
		if (rawModel.supports_global_endpoint != null) {
			metadata.supportsGlobalEndpoint = rawModel.supports_global_endpoint;
		}
		if (rawModel.tiers != null) {
			metadata.tiers = rawModel.tiers;
		}

		models[id] = {
			id,
			name: rawModel.name || id,
			description: rawModel.description ?? undefined,
			maxTokens: mutable.maxTokens,
			contextWindow: mutable.contextWindow,
			capabilities,
			pricing: {
				input: mutable.inputPrice,
				output: mutable.outputPrice,
				...(mutable.cacheReadsPrice !== undefined
					? { cacheRead: mutable.cacheReadsPrice }
					: {}),
				...(mutable.cacheWritesPrice !== undefined
					? { cacheWrite: mutable.cacheWritesPrice }
					: {}),
			},
			// Placeholder budget so clients know thinking is supported even
			// though OpenRouter only exposes a boolean reasoning flag.
			...(supportsThinking
				? { thinkingConfig: { maxBudget: DEFAULT_MAX_THINKING_BUDGET } }
				: {}),
			...(Object.keys(metadata).length > 0 ? { metadata } : {}),
		};
	}

	for (const [modelId, modelInfo] of Object.entries(CLINE_STEALTH_MODELS)) {
		models[modelId] ??= modelInfo;
	}

	return models;
}

// ---------------------------------------------------------------------------
// Vercel AI Gateway
// ---------------------------------------------------------------------------

interface VercelAiGatewayRawModelInfo {
	id?: string;
	name?: string;
	type?: string;
	description?: string | null;
	context_window?: number | null;
	max_tokens?: number | null;
	tags?: string[];
	pricing?: {
		input?: string;
		output?: string;
		input_cache_read?: string;
		input_cache_write?: string;
	} | null;
}

/**
 * The Vercel API only provides a "reasoning" tag to indicate support, so the
 * specific thinking configuration is derived from model-id patterns.
 */
function deriveVercelThinkingConfig(
	modelId: string,
	tags: string[] | undefined,
): ModelInfo["thinkingConfig"] {
	if (!tags?.includes("reasoning")) {
		return undefined;
	}
	if (modelId.startsWith("anthropic/claude")) {
		return { maxBudget: 8192 };
	}
	if (modelId.includes("gemini-3")) {
		return { maxBudget: 32767, thinkingLevel: "high" };
	}
	if (modelId.startsWith("deepseek/deepseek-r1")) {
		return { maxBudget: 8192 };
	}
	if (modelId.startsWith("openai/o1") || modelId.startsWith("openai/o3")) {
		return { maxBudget: 32000 };
	}
	if (modelId === "qwen/qwq-32b:free" || modelId === "qwen/qwq-32b") {
		return { maxBudget: 32000 };
	}
	return { maxBudget: 32000 };
}

/** Recommended temperature for specific model families. */
function deriveVercelTemperature(modelId: string): number | undefined {
	if (
		modelId.startsWith("deepseek/deepseek-r1") ||
		modelId === "perplexity/sonar-reasoning" ||
		modelId === "qwen/qwq-32b:free" ||
		modelId === "qwen/qwq-32b"
	) {
		return 0.7;
	}
	if (modelId.startsWith("google/gemini-3")) {
		return 1.0;
	}
	return undefined;
}

export async function fetchVercelAiGatewayLiveModels(
	fetcher: typeof fetch = fetch,
): Promise<Record<string, ModelInfo>> {
	const payload = (await fetchJson(
		"https://ai-gateway.vercel.sh/v1/models?include_mappings=true",
		{ method: "GET", headers: { accept: "application/json" } },
		fetcher,
	)) as { data?: VercelAiGatewayRawModelInfo[] };
	if (!Array.isArray(payload?.data)) {
		throw new Error("Invalid response from Vercel AI Gateway API");
	}

	const models: Record<string, ModelInfo> = {};
	for (const rawModel of payload.data) {
		const id = rawModel.id?.trim();
		if (!id || rawModel.type === "embedding") {
			continue;
		}

		const cacheRead = parsePricePerMillion(rawModel.pricing?.input_cache_read);
		const cacheWrite = parsePricePerMillion(
			rawModel.pricing?.input_cache_write,
		);
		const supportsPromptCache = Boolean(cacheRead && cacheWrite);
		const thinkingConfig = deriveVercelThinkingConfig(id, rawModel.tags);
		const temperature = deriveVercelTemperature(id);

		// Vercel doesn't expose image support, so assume all models accept
		// images (matches the extension's previous behavior).
		const capabilities: Capabilities = ["streaming", "tools", "images"];
		addCapability(capabilities, "prompt-cache", supportsPromptCache);
		addCapability(capabilities, "reasoning", Boolean(thinkingConfig));

		models[id] = {
			id,
			name: rawModel.name || id,
			description: rawModel.description ?? undefined,
			maxTokens: rawModel.max_tokens ?? undefined,
			contextWindow: rawModel.context_window ?? undefined,
			capabilities,
			pricing: {
				input: parsePricePerMillion(rawModel.pricing?.input) ?? 0,
				output: parsePricePerMillion(rawModel.pricing?.output) ?? 0,
				cacheRead: cacheRead ?? 0,
				cacheWrite: cacheWrite ?? 0,
			},
			...(thinkingConfig ? { thinkingConfig } : {}),
			...(temperature !== undefined ? { temperature } : {}),
		};
	}

	return models;
}

// ---------------------------------------------------------------------------
// Hugging Face
// ---------------------------------------------------------------------------

interface HuggingFaceRawModelInfo {
	id?: string;
	providers?: { provider?: string }[];
}

export async function fetchHuggingFaceLiveModels(
	fetcher: typeof fetch = fetch,
): Promise<Record<string, ModelInfo>> {
	const payload = (await fetchJson(
		"https://router.huggingface.co/v1/models",
		{ method: "GET", headers: { accept: "application/json" } },
		fetcher,
	)) as { data?: HuggingFaceRawModelInfo[] };
	if (!Array.isArray(payload?.data)) {
		throw new Error("Invalid response from Hugging Face API");
	}

	const curated = getCuratedModels("huggingface");
	const models: Record<string, ModelInfo> = {};
	for (const rawModel of payload.data) {
		const id = rawModel.id?.trim();
		if (!id) {
			continue;
		}
		const providersList = rawModel.providers
			?.map((provider) => provider.provider)
			.filter(Boolean)
			.join(", ");
		const providersDescription = `Available on providers: ${providersList || "unknown"}`;
		const staticInfo = curated[id];
		if (staticInfo) {
			// Curated metadata wins; the live endpoint only tells us the model
			// is currently routed and by whom.
			models[id] = {
				...staticInfo,
				description: staticInfo.description ?? providersDescription,
			};
			continue;
		}
		models[id] = {
			id,
			name: id,
			// The HF router endpoint doesn't provide token limits.
			maxTokens: 8192,
			contextWindow: 128_000,
			capabilities: ["streaming", "tools"],
			pricing: { input: 0, output: 0 },
			description: providersDescription,
		};
	}

	return models;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type RichLiveModelSourceFetcher = (
	fetcher?: typeof fetch,
) => Promise<Record<string, ModelInfo>>;

/**
 * Rich live model sources, keyed by *generated catalog key* (see
 * `resolveProviderModelCatalogKeys`), so runtime providers that share a
 * catalog (e.g. `cline` → `openrouter`) share the live data.
 */
export const RICH_LIVE_MODEL_SOURCES: Record<
	string,
	RichLiveModelSourceFetcher
> = {
	openrouter: fetchOpenRouterLiveModels,
	"vercel-ai-gateway": fetchVercelAiGatewayLiveModels,
	huggingface: fetchHuggingFaceLiveModels,
};

// ---------------------------------------------------------------------------
// Groq (private: requires an API key)
// ---------------------------------------------------------------------------

interface GroqRawModelInfo {
	id?: string;
	object?: string;
	active?: boolean;
	context_window?: number;
	max_completion_tokens?: number;
	owned_by?: string;
}

function isValidGroqChatModel(rawModel: GroqRawModelInfo): boolean {
	if (Object.hasOwn(rawModel, "active") && !rawModel.active) {
		return false;
	}
	const id = rawModel.id ?? "";
	if (
		id.includes("whisper") ||
		id.includes("tts") ||
		id.includes("guard") ||
		id.includes("embedding") ||
		id.includes("moderation") ||
		id.includes("allam")
	) {
		return false;
	}
	return rawModel.object === "model" && Boolean(id);
}

function detectGroqImageSupport(
	modelId: string,
	staticInfo: ModelInfo | undefined,
): boolean {
	if (staticInfo?.capabilities) {
		return staticInfo.capabilities.includes("images");
	}
	const id = modelId.toLowerCase();
	return (
		id.includes("vision") || id.includes("maverick") || id.includes("scout")
	);
}

function generateGroqModelDescription(
	rawModel: GroqRawModelInfo,
	staticInfo: ModelInfo | undefined,
): string {
	if (staticInfo?.description) {
		return staticInfo.description;
	}
	const modelId = rawModel.id ?? "";
	const contextWindow = rawModel.context_window || 8192;
	const ownedBy = rawModel.owned_by || "Unknown";
	if (modelId.includes("compound")) {
		return `${ownedBy}'s ${modelId} model with ${contextWindow.toLocaleString()} token context window - Advanced compound architecture`;
	}
	return `${ownedBy} model with ${contextWindow.toLocaleString()} token context window`;
}

/**
 * Live-fetches Groq's models endpoint (availability + live token limits) and
 * enriches each model with curated pricing/capabilities, since the endpoint
 * does not report pricing.
 */
export async function fetchGroqPrivateModels(
	token: string,
	fetcher: typeof fetch = fetch,
): Promise<Record<string, ModelInfo>> {
	const payload = (await fetchJson(
		"https://api.groq.com/openai/v1/models",
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${token.trim()}`,
				"Content-Type": "application/json",
			},
		},
		fetcher,
		10_000,
	)) as { data?: GroqRawModelInfo[] };
	if (!Array.isArray(payload?.data)) {
		throw new Error("Invalid response from Groq API");
	}

	const curated = getCuratedModels("groq");
	const models: Record<string, ModelInfo> = {};
	for (const rawModel of payload.data) {
		if (!isValidGroqChatModel(rawModel)) {
			continue;
		}
		const id = rawModel.id?.trim();
		if (!id) {
			continue;
		}
		const staticInfo = curated[id];
		const capabilities: Capabilities = staticInfo?.capabilities
			? [...staticInfo.capabilities]
			: ["streaming", "tools"];
		addCapability(
			capabilities,
			"images",
			detectGroqImageSupport(id, staticInfo),
		);

		models[id] = {
			...staticInfo,
			id,
			name: staticInfo?.name ?? id,
			maxTokens:
				rawModel.max_completion_tokens || staticInfo?.maxTokens || 8192,
			contextWindow:
				rawModel.context_window || staticInfo?.contextWindow || 8192,
			capabilities,
			pricing: staticInfo?.pricing ?? { input: 0, output: 0 },
			description: generateGroqModelDescription(rawModel, staticInfo),
		};
	}

	return models;
}

// ---------------------------------------------------------------------------
// Requesty (private: requires an API key; supports custom router base URLs)
// ---------------------------------------------------------------------------

interface RequestyRawModelInfo {
	id?: string;
	context_window?: number;
	max_output_tokens?: number;
	supports_vision?: boolean;
	supports_caching?: boolean;
	input_price?: number | string;
	output_price?: number | string;
	caching_price?: number | string;
	cached_price?: number | string;
	description?: string;
}

const REQUESTY_DEFAULT_BASE_URL = "https://router.requesty.ai/v1";

export async function fetchRequestyPrivateModels(
	token: string,
	baseUrl: string | undefined,
	fetcher: typeof fetch = fetch,
): Promise<Record<string, ModelInfo>> {
	const base = (baseUrl?.trim() || REQUESTY_DEFAULT_BASE_URL).replace(
		/\/+$/,
		"",
	);
	const payload = (await fetchJson(
		`${base}/models`,
		{
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				accept: "application/json",
			},
		},
		fetcher,
		10_000,
	)) as { data?: RequestyRawModelInfo[] };
	if (!Array.isArray(payload?.data)) {
		throw new Error("Invalid response from Requesty API");
	}

	const models: Record<string, ModelInfo> = {};
	for (const rawModel of payload.data) {
		const id = rawModel.id?.trim();
		if (!id) {
			continue;
		}
		const supportsPromptCache = Boolean(rawModel.supports_caching);
		const capabilities: Capabilities = ["streaming", "tools"];
		addCapability(capabilities, "images", Boolean(rawModel.supports_vision));
		addCapability(capabilities, "prompt-cache", supportsPromptCache);

		models[id] = {
			id,
			name: id,
			maxTokens: rawModel.max_output_tokens,
			contextWindow: rawModel.context_window,
			capabilities,
			pricing: {
				input: parsePricePerMillion(rawModel.input_price) ?? 0,
				output: parsePricePerMillion(rawModel.output_price) ?? 0,
				cacheWrite: parsePricePerMillion(rawModel.caching_price) ?? 0,
				cacheRead: parsePricePerMillion(rawModel.cached_price) ?? 0,
			},
			description: rawModel.description,
		};
	}

	return models;
}
