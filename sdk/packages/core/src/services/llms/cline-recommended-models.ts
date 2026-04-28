import { ProviderSettingsManager } from "../storage/provider-settings-manager";

export interface ClineRecommendedModel {
	id: string;
	name: string;
	description: string;
	tags: string[];
}

export interface ClineRecommendedModelsData {
	recommended: ClineRecommendedModel[];
	free: ClineRecommendedModel[];
}

export interface FetchClineRecommendedModelsOptions {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
	providerSettingsManager?: Pick<
		ProviderSettingsManager,
		"getProviderSettings"
	>;
	timeoutMs?: number;
}

const DEFAULT_API_BASE_URL = "https://api.cline.bot";
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
	const recommended = recommendedRaw
		.map(normalizeModel)
		.filter((model): model is ClineRecommendedModel => model !== null);
	const free = freeRaw
		.map(normalizeModel)
		.filter((model): model is ClineRecommendedModel => model !== null);
	if (recommended.length === 0 && free.length === 0) return null;
	return { recommended, free };
}

function getConfiguredApiBaseUrl(
	options: FetchClineRecommendedModelsOptions,
): string {
	const explicitBaseUrl = options.baseUrl?.trim();
	if (explicitBaseUrl) return explicitBaseUrl;

	try {
		const manager =
			options.providerSettingsManager ?? new ProviderSettingsManager();
		const settings = manager.getProviderSettings("cline");
		return settings?.baseUrl?.trim() || DEFAULT_API_BASE_URL;
	} catch {
		return DEFAULT_API_BASE_URL;
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

export async function fetchClineRecommendedModels(
	options: FetchClineRecommendedModelsOptions = {},
): Promise<ClineRecommendedModelsData> {
	try {
		const base = getConfiguredApiBaseUrl(options);
		const fetchImpl = options.fetchImpl ?? fetch;
		const resp = await fetchWithTimeout(
			fetchImpl,
			`${base}/api/v1/ai/cline/recommended-models`,
			options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const json: unknown = await resp.json();
		const data = normalizeResponse(json);
		if (data) return data;
	} catch {
		// Fall back to the bundled list when the remote source is unavailable.
	}

	return cloneRecommendedModels(FALLBACK_CLINE_RECOMMENDED_MODELS);
}
